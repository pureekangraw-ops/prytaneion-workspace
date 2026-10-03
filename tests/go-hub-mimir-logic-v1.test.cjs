"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-mimir-logic-v1.mjs")).href;
let mimir;

test.before(async () => {
  mimir = await import(moduleUrl);
});

function observation(overrides = {}) {
  return mimir.createObservationEnvelope({
    observationId: "obs-001",
    source: {
      system: "notion",
      sourceRef: "https://app.notion.com/p/source-001",
      sourceType: "page",
      ownerRef: "source-owner://centre",
    },
    capturedAt: "2026-10-03T00:00:00.000Z",
    observedAt: "2026-10-03T00:00:00.000Z",
    schemaVersion: "source-v1",
    content: { title: "MIMIR Runtime Contract" },
    evidenceRefs: ["https://app.notion.com/p/source-001"],
    accessScope: {
      visibility: "internal",
      allowedConsumers: ["HERMES", "PIXIE", "SPECTRUM"],
      fields: ["title", "summary", "evidenceRefs"],
    },
    environment: { mode: "production", externalEffect: false },
    ...overrides,
  });
}

function currentRecord(overrides = {}) {
  const source = observation();
  const classification = mimir.classifyLifecycle({
    observedAt: source.observedAt,
    evidenceRefs: source.evidenceRefs,
    accessScope: source.accessScope,
    sourceAvailable: true,
    schemaValid: true,
    environment: source.environment,
  }, {
    now: "2026-10-03T00:01:00.000Z",
    freshnessPolicy: {
      freshnessPolicyRef: "policy://centre/test/v1",
      freshnessWindowMs: 86_400_000,
    },
  });
  return mimir.createCanonicalRecord({
    observation: source,
    classification,
    recordId: "record-001",
    canonicalKey: "mimir:runtime-contract",
    recordType: "knowledge",
    title: "MIMIR Runtime Contract",
    summary: "Read-only evidence contract",
    truthOwner: "source-owner://centre",
    identityConfidence: 1,
    accessScope: overrides.accessScope ?? source.accessScope,
    ...overrides,
  });
}

test("canonical schemas expose the v1 surfaces without runtime authorization", () => {
  assert.deepEqual(mimir.MIMIR_V1_SCHEMA.CanonicalRecord.slice(-4), [
    "canMutateSource",
    "routeHint",
    "routeEvidenceRefs",
    "routeDerivedByMimir",
  ]);
  assert.equal(mimir.MIMIR_LOGIC_VERSION, "MIMIR_LOGIC_V1");
});

test("first invariant: MIMIR organizes evidence without acquiring authority", () => {
  const record = currentRecord();
  assert.notEqual(record.truthOwner.toUpperCase(), "MIMIR");
  assert.equal(record.mimirRole, "derived_index");
  assert.equal(record.canMutateSource, false);
  assert.equal(record.routeDerivedByMimir, false);
  assert.equal(record.routeHint, null);
  assert.deepEqual(record.routeEvidenceRefs, []);
  assert.equal("truthConfidence" in record.confidence, false);
  assert.equal(mimir.assertMimirSafety(record), true);
});

test("route hints are source-derived only", () => {
  const record = currentRecord({ routeHint: "knowledge://notion", routeEvidenceRefs: ["https://app.notion.com/p/source-001"] });
  assert.equal(record.routeHint, "knowledge://notion");
  assert.deepEqual(record.routeEvidenceRefs, ["https://app.notion.com/p/source-001"]);
  assert.throws(() => currentRecord({ routeHint: "inferred://mimir" }), /routeHint requires routeEvidenceRefs/);
  assert.throws(() => currentRecord({ routeDerivedByMimir: true }), /cannot derive route/);
});

test("access scope only narrows when records are combined", () => {
  const scope = mimir.intersectAccessScopes([
    { visibility: "internal", allowedConsumers: ["HERMES", "PIXIE"], fields: ["title", "summary"] },
    { visibility: "restricted", allowedConsumers: ["HERMES"], fields: ["title"] },
  ]);
  assert.deepEqual(scope.allowedConsumers, ["HERMES"]);
  assert.deepEqual(scope.fields, ["title"]);
  assert.equal(scope.visibility, "restricted");
});

test("context packs narrow the combined source scope before consumer delivery", () => {
  const first = currentRecord({
    recordId: "record-a",
    accessScope: { visibility: "internal", allowedConsumers: ["HERMES", "PIXIE"], fields: ["title", "summary"] },
  });
  const second = currentRecord({
    recordId: "record-b",
    accessScope: { visibility: "restricted", allowedConsumers: ["HERMES"], fields: ["title"] },
  });
  const pack = mimir.createContextPack({
    contextPackId: "context-001",
    consumer: "HERMES",
    records: [first, second],
    generatedAt: "2026-10-03T00:02:00.000Z",
  });
  assert.deepEqual(pack.effectiveScope.allowedConsumers, ["HERMES"]);
  assert.deepEqual(pack.effectiveScope.fields, ["title"]);
  assert.equal(pack.effectiveScope.visibility, "restricted");
});

test("duplicate relation is explicit and does not choose a lifecycle winner", () => {
  assert.equal(mimir.relateDuplicate({ contentHash: "same" }, { contentHash: "same" }), "exact");
  assert.equal(mimir.relateDuplicate({ identityKey: "same" }, { identityKey: "same" }), "identity");
  assert.equal(mimir.relateDuplicate({ semanticKey: "same" }, { semanticKey: "same" }), "possible");
  assert.equal(mimir.relateDuplicate({ identityKey: "a" }, { identityKey: "b" }), "none");
});

test("lifecycle status and duplicate state remain independent", () => {
  const record = currentRecord({ duplicateState: "exact" });
  assert.equal(record.lifecycleStatus, "current");
  assert.equal(record.duplicateState, "exact");

  const smoke = currentRecord({ lifecycleStatus: "smoke", duplicateState: "identity" });
  assert.equal(smoke.lifecycleStatus, "smoke");
  assert.equal(smoke.duplicateState, "identity");
});

test("freshness policy is external and stale is computed from supplied policy", () => {
  const source = observation({ observedAt: "2026-09-01T00:00:00.000Z" });
  const result = mimir.classifyLifecycle({
    observedAt: source.observedAt,
    evidenceRefs: source.evidenceRefs,
    accessScope: source.accessScope,
    sourceAvailable: true,
    schemaValid: true,
    environment: source.environment,
  }, {
    now: "2026-10-03T00:00:00.000Z",
    freshnessPolicy: {
      freshnessPolicyRef: "policy://owner/custom-window/v1",
      freshnessWindowMs: 7 * 86_400_000,
    },
  });
  assert.equal(result.lifecycleStatus, "stale");
  assert.equal(result.freshnessPolicyRef, "policy://owner/custom-window/v1");
  assert.equal("ttl" in result, false);
});

test("conflicted cluster has candidates but never auto-selects a preferred record", () => {
  const left = currentRecord({ recordId: "record-a" });
  const right = currentRecord({ recordId: "record-b", lifecycleStatus: "conflict" });
  const cluster = mimir.buildTopicCluster({
    clusterId: "cluster-001",
    canonicalTopic: "MIMIR Runtime Contract",
    records: [left, right],
    ownerPreferredCandidateId: "record-a",
  });
  assert.deepEqual(cluster.currentCandidateIds, []);
  assert.equal(cluster.preferredCandidateId, null);
  assert.equal(cluster.selectionAuthority, "source_owner");
  assert.equal(cluster.autoCurrentSelection, false);
});

test("consumer projections are narrowed and never infer routes", () => {
  const record = currentRecord({
    accessScope: {
      visibility: "internal",
      allowedConsumers: ["HERMES"],
      fields: ["title", "summary", "evidenceRefs"],
    },
  });
  const hermes = mimir.projectForConsumer(record, "HERMES");
  const restricted = mimir.projectForConsumer(record, "PIXIE");
  assert.deepEqual(hermes.effectiveScope.allowedConsumers, ["HERMES"]);
  assert.equal(hermes.routeHint, null);
  assert.equal(hermes.routeDerivedByMimir, false);
  assert.equal(restricted.lifecycleStatus, "restricted");
  assert.deepEqual(restricted.sourceRefs, []);
});

test("archive preserves evidence and lineage instead of deleting the record", () => {
  const record = currentRecord({ contentHash: "sha256:record-001" });
  const manifest = mimir.createArchiveManifest({
    archiveRef: "archive-001",
    record,
    reason: "superseded_by_owner_record",
    contentHash: "sha256:record-001",
    supersededBy: "record-002",
    archivedAt: "2026-10-03T00:05:00.000Z",
  });
  const edge = mimir.createLineageEdge({
    edgeId: "edge-001",
    type: "SUPERSEDED_BY",
    fromId: record.recordId,
    toId: "record-002",
    evidenceRefs: manifest.evidenceRefs,
    createdAt: manifest.archivedAt,
  });
  assert.equal(manifest.restorable, true);
  assert.equal(manifest.sourceRef, record.sourceRefs[0]);
  assert.deepEqual(manifest.evidenceRefs, record.evidenceRefs);
  assert.equal(manifest.supersededBy, "record-002");
  assert.equal(edge.type, "SUPERSEDED_BY");
});

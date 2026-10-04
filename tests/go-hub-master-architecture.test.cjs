"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const masterUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-master-architecture.mjs")).href;
const protocolUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-universal-work-protocol.mjs")).href;

test("Master Architecture keeps Resume separate from New Work + lineage", async () => {
  const api = await import(masterUrl + "?lineage=" + Date.now());
  assert.equal(api.classifyWorkContinuation({ previousStatus:"WAIT", interrupted:true }).kind, "RESUME");
  assert.equal(api.classifyWorkContinuation({ previousStatus:"COMPLETE", requestedResultSame:true }).kind, "REOPEN");
  const derived = api.classifyWorkContinuation({ previousStatus:"COMPLETE", requestedResultSame:false });
  assert.equal(derived.kind, "NEW_WORK");
  assert.equal(derived.requiresLineage, true);
  assert.deepEqual(api.normalizeWorkLineage({ derivedFrom:"WORK-OLD", relatedTo:["WORK-OLD", "WORK-RELATED"] }), {
    continuedFrom:null,
    derivedFrom:"WORK-OLD",
    relatedTo:["WORK-OLD", "WORK-RELATED"],
  });
});

test("Master Architecture records complete interruption recovery without retry or rollback", async () => {
  const api = await import(masterUrl + "?recovery=" + Date.now());
  const recovery = api.createInterruptionRecovery({
    workId:"WORK-1",
    checkpointId:"CP-WORK-1",
    actor:"GO",
    lastSafePoint:"before-commit",
    lastAction:"prepare commit",
    lastLocation:"GITHUB",
    observedAt:"2026-10-04T18:00:00.000Z",
    evidenceRefs:["test://evidence"],
    receipt:{ id:"R-1" },
    repo:"org/repo",
    pr:"398",
    sha:"abc123",
    unknownGap:["effect-unknown"],
    interruptCause:"session lost",
  });
  assert.equal(recovery.custody, "HERMES");
  assert.equal(recovery.status, "HOLD");
  assert.equal(recovery.autoRetry, false);
  assert.equal(recovery.autoRollback, false);
  assert.equal(recovery.identity.workId, "WORK-1");
});

test("MIMIR reconciliation reports drops but does not choose a truth owner", async () => {
  const api = await import(masterUrl + "?reconcile=" + Date.now());
  const result = api.reconcileContinuityOrganization({
    movementRecords:[{ workId:"W1", checkpointId:"C1" }, { workId:"W2", checkpointId:"C2" }],
    indexedRecords:[{ workId:"W1", checkpointId:"C1" }, { workId:"W3", checkpointId:"C3" }],
  });
  assert.equal(result.status, "RECONCILIATION_REQUIRED");
  assert.deepEqual(result.missingFromIndex, ["W2:C2"]);
  assert.deepEqual(result.orphanIndex, ["W3:C3"]);
});

test("Universal protocol enforces ACK and interruption events without changing Work identity", async () => {
  const api = await import(protocolUrl + "?protocol=" + Date.now());
  let envelope = api.createWorkEnvelope({
    workId:"WORK-1",
    checkpointId:"CP-WORK-1",
    requestedResult:"result",
    owner:"CENTRE",
    origin:"GO",
    target:"HERMES",
  });
  for (const step of [
    ["create_tablet", "CREATE"],
    ["pickup_tablet", "RECEIVED"],
    ["acknowledge", "ACKNOWLEDGE"],
    ["resume", "RESUME"],
    ["update_tablet", "EXECUTE"],
    ["interrupt", "INTERRUPTED"],
    ["eject_tablet", "EJECTED"],
    ["resume", "RESUME"],
  ]) {
    envelope = api.applyActorAction(envelope, {
      actor:"HERMES",
      action:step[0],
      workId:"WORK-1",
      checkpointId:"CP-WORK-1",
      nextStatus:"IN_PROGRESS",
      reason:step[1],
    });
    assert.equal(envelope.lifecycle.lastEvent.event, step[1]);
  }
  assert.equal(envelope.identity.workId, "WORK-1");
  assert.equal(envelope.identity.checkpointId, "CP-WORK-1");
});

test("Master Architecture overview states all role boundaries", async () => {
  const api = await import(masterUrl + "?overview=" + Date.now());
  const overview = api.masterArchitectureOverview();
  assert.equal(overview.truthOwners.CENTRE, "LIFECYCLE");
  assert.equal(overview.truthOwners.HERMES, "CONTINUITY");
  assert.equal(overview.truthOwners.MIMIR, "ORGANIZATION");
  assert.equal(overview.truthOwners.SPECTRUM_PRIME, "OPERATIONS_INTELLIGENCE");
  assert.ok(overview.invariants.includes("SPECTRUM_DOES_NOT_EXECUTE_WORK"));
});

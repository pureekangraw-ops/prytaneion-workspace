"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const moduleUrl = name => pathToFileURL(path.join(root, name)).href;

const work = {
  workId: "WORK-FULL-SYSTEM-TEST",
  status: "ON PROCESS",
  holder: "GO",
  pass: {
    kind: "MAINTENANCE",
    state: "ACTIVE",
    allowedDestinations: ["ALL_GO_HUB_OWNED_AREAS"],
    audit: { ownerApproval: "BIG_APPROVED", repairScope: ["verification"] },
  },
};

const realityMap = {
  source: "GO_FIRST_REALITY_RUN",
  routes: [{
    id: "centre-factory",
    from: "centre",
    to: "factory",
    checkpoints: [
      { id: "centre-health", importantValue: "Centre is reachable", expected: true, source: "go-hub-centre-v4.js", probeAction: "read", mode: "READ", ownerSource: "GO Hub" },
      { id: "factory-health", importantValue: "Factory stages are present", expected: { contains: ["PLAN", "BUILD", "ASSEMBLY", "MERGE", "CHECK", "OUTPUT"] }, source: "go-hub-factory-v4.js", probeAction: "read", mode: "READ", ownerSource: "GO Hub" },
    ],
  }],
};

class MemoryStorage {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key); }
  async put(key, value) {
    if (key && typeof key === "object" && value === undefined) {
      for (const [name, current] of Object.entries(key)) this.map.set(name, structuredClone(current));
      return;
    }
    this.map.set(key, structuredClone(value));
  }
  async list({ prefix } = {}) {
    return new Map([...this.map.entries()].filter(([key]) => !prefix || key.startsWith(prefix)));
  }
}

test("full-system verification reads a verified registry record", async () => {
  const { createMimirCatalogSearchPort } = await import(moduleUrl("go-hub-mimir-destination.js") + "?full-registry=" + Date.now());
  const search = createMimirCatalogSearchPort({
    async readCatalog() {
      return [{
        "Registry ID": "MIR-101",
        "ชื่อ": "GO Hub Factory",
        "ประเภท": "Service",
        "Purpose": "Build and verify code product work packages",
        "Capability": "Design Production Piece QC Ready Gate Assembly Build Product QC",
        "Location": "GO Hub → Factory",
        "Route": "GO → GO Catalog → GO Hub Factory",
        "Owner": "GO",
        "Permission": "Allowed",
        "Operational Status": "Active",
        "Callable": "No",
        "Source ID": "factory-source-id",
        "Source URL": "https://source.test/factory",
        "Verification State": "Verified",
        "date:Verified Date:start": "2026-10-02",
        "Evidence": "repository checked",
        "Aliases": "Factory / GO Factory",
        "Tags": "factory, build, code, product",
        url: "https://notion.test/factory-record",
      }];
    },
  });
  const result = await search({ task: "Find the factory", requestedResult: "Verified factory route", lensReference: "lens://factory" });
  assert.equal(result.status, "PASS");
  assert.equal(result.records[0].verificationState, "Verified");
  assert.equal(result.records[0].operationalStatus, "Active");
  assert.equal(result.evidence.sourceId, "factory-source-id");
});

test("full-system verification proves the connection map is read-only and complete", async () => {
  const { createMaintenanceV4 } = await import(moduleUrl("go-hub-maintenance.js") + "?full-connection=" + Date.now());
  const service = createMaintenanceV4({
    readValue: async point => ({
      available: true,
      value: point.id === "centre-health" ? true : ["PLAN", "BUILD", "ASSEMBLY", "MERGE", "CHECK", "OUTPUT"],
      evidenceRef: "evidence://" + point.id,
    }),
    traceId: () => "TRACE-FULL-SYSTEM",
    now: () => "2026-10-02T08:00:00.000Z",
  });
  const response = await service.run({
    work,
    action: "run_system_check",
    map: realityMap,
    controlRoomTruth: {
      centre: { status: "OPEN" },
      projectStatus: { status: "OPEN" },
      board: { updatedAt: "2099-01-01T00:00:00.000Z" },
      github: { headSha: "abc123" },
      cloudflare: { deployment: { sourceSha: "abc123" } },
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "MAINTENANCE_CHECK_COMPLETE");
  assert.equal(body.routes[0].status, "PASS");
  assert.equal(body.routes[0].checkpoints.length, 2);
  assert.equal(body.autoRepair, false);
  assert.equal(body.traceId, "TRACE-FULL-SYSTEM");
});

test("full-system verification accepts only exact deployment provenance", async () => {
  const { verifyDeploymentReceipt } = await import(moduleUrl("go-hub-deployment-provenance.mjs") + "?full-deploy=" + Date.now());
  const sha = "a".repeat(40);
  const deployment = { id: "dep-1", versions: [{ versionId: "v-1", percentage: 100 }] };
  const receipt = { repository: "pureekangraw-ops/prytaneion-workspace", worker: "go-hub", workflowRunId: 7, sourceSha: sha, deploymentId: "dep-1", versions: [{ versionId: "v-1", percentage: 100 }] };
  assert.equal(verifyDeploymentReceipt({ receipt, deployment, run: { id: 7, head_sha: sha, name: "GO Hub Deploy" } }).status, "VERIFIED");
  assert.equal(verifyDeploymentReceipt({ receipt, deployment, run: { id: 7, head_sha: "b".repeat(40), name: "GO Hub Deploy" } }).status, "UNKNOWN");
});

test("full-system verification keeps audit evidence append-only and Work-bound", async () => {
  const { GoHubGlobalAuditLog } = await import(moduleUrl("go-hub-global-audit.mjs") + "?full-audit=" + Date.now());
  const audit = new GoHubGlobalAuditLog({ storage: new MemoryStorage() }, {});
  const append = event => audit.fetch(new Request("https://audit.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "append", event }),
  }));
  for (const type of ["LOGIN_SUCCESS", "REGISTRY_READ", "MAINTENANCE_CHECK"]) {
    const response = await append({ eventId: "EV-" + type, type, workId: work.workId, checkpointId: "CP-FULL", phase: type, details: {} });
    assert.equal(response.status, 200);
  }
  const historyResponse = await audit.fetch(new Request("https://audit.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "history", workId: work.workId, afterSequence: 0, limit: 20 }),
  }));
  const body = await historyResponse.json();
  assert.deepEqual(body.events.map(item => item.event.type), ["LOGIN_SUCCESS", "REGISTRY_READ", "MAINTENANCE_CHECK"]);
  assert.equal(body.events.every(item => item.event.workId === work.workId), true);
});

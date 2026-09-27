const test = require("node:test");
const assert = require("node:assert/strict");

async function mod() {
  return import("../go-hub-factory-v4.js");
}

const work = {
  workId: "W1",
  checkpointId: "CP-W1",
  command: "build",
  expectedResult: "artifact",
  status: "ON PROCESS",
  holder: "GO",
  pass: { state: "ACTIVE", allowedDestinations: ["FACTORY"] },
};

const form = {
  repository: "pureekangraw-ops/standard-",
  branch: "work/x",
  plan: "change x",
  expectedOutput: "file",
  outputType: "FILE",
  criticalChecklist: [{ id: "ci", label: "CI passes" }],
};

async function advanceToCheck(m) {
  let state = m.enterFactoryV4({ work, form });
  state = m.recordFactoryReality(state, {
    repository: form.repository,
    branch: form.branch,
    headSha: "abc",
    lastUpdated: "now",
  });
  state = m.advanceFactory(state);
  state = m.advanceFactory(state, { result: { built: true } });
  state = m.advanceFactory(state, { result: { assembled: true } });
  state = m.advanceFactory(state, { result: { pullRequest: 1, mergeReceiptRef: "github://merge/def" } });
  return state;
}

test("Factory accepts the canonical uppercase HERMES destination", async () => {
  const { enterFactoryV4 } = await mod();
  const state = enterFactoryV4({ work, form });
  assert.equal(state.stage, "PLAN");
});

test("Factory requires Centre Work Pass", async () => {
  const { enterFactoryV4 } = await mod();
  assert.throws(
    () => enterFactoryV4({ work: { ...work, pass: null }, form }),
    /ACTIVE Work Pass/,
  );
});

test("FOUNDRY keeps Factory route compatibility while exposing the new identity", async () => {
  const { enterFactoryV4 } = await mod();
  const state = enterFactoryV4({
    work,
    form: {
      ...form,
      inputReferences: ["forge://draft-1"],
      forgeHandoff: { packetId: "FORGE-PACKET-1" },
    },
  });
  assert.equal(state.displayName, "FOUNDRY");
  assert.equal(state.flowVersion, "FOUNDRY_V1");
  assert.equal(state.projectRef.type, "FACTORY");
  assert.equal(state.projectRef.destination, "destination://factory");
  assert.equal(state.projectRef.displayName, "FOUNDRY");
  assert.equal(state.intake.source, "FORGE_LAB");
  assert.equal(state.intake.continuity, "SAME_WORK");
  assert.equal(state.intake.workId, work.workId);
});

test("FOUNDRY preserves Factory stage compatibility and exposes the safer operator flow", async () => {
  const m = await mod();
  let state = m.enterFactoryV4({ work, form });
  state = m.recordFactoryReality(state, {
    repository: form.repository,
    branch: form.branch,
    headSha: "abc",
    lastUpdated: "now",
  });
  state = m.advanceFactory(state);
  assert.equal(state.stage, "BUILD");
  state = m.advanceFactory(state, { result: { built: true } });
  assert.equal(state.stage, "ASSEMBLY");
  state = m.advanceFactory(state, { result: { assembled: true } });
  assert.equal(state.stage, "MERGE");
  assert.equal(m.factoryBoardView(state).flowPhase, "WAIT_EXTERNAL_OWNER_GATE");
  assert.equal(m.factoryBoardView(state).ownerGate.authority, "GO_HUB_MERGE_OWNER_TRUTH");

  state = m.advanceFactory(state, {
    result: { pullRequest: 1, mergeReceiptRef: "github://merge/def" },
  });
  assert.equal(state.stage, "CHECK");

  state = m.updateCriticalCheck(state, {
    id: "ci",
    status: "PASS",
    evidence: { run: 2202, conclusion: "success", headSha: "def" },
  });
  state = m.advanceFactory(state);
  assert.equal(state.stage, "OUTPUT");
  assert.equal(m.factoryBoardView(state).flowPhase, "OUTPUT_READBACK");

  state = m.finishFactory(state, { file: "artifact.apk" });
  assert.equal(state.output.value, "artifact.apk");
  assert.equal(state.output.readbackRequired, true);
});

test("CHECK blocks UNKNOWN and checklist PASS without evidence", async () => {
  const m = await mod();
  let state = await advanceToCheck(m);

  assert.throws(
    () => m.updateCriticalCheck(state, { id: "ci", status: "PASS" }),
    /requires evidence/,
  );

  state = m.updateCriticalCheck(state, {
    id: "ci",
    status: "UNKNOWN",
    evidence: { reason: "CI receipt missing" },
  });
  assert.throws(() => m.advanceFactory(state), /Critical Checklist is not PASS/);
});

test("Plan change safe-stops to PLAN and records rollback source stage", async () => {
  const m = await mod();
  let state = m.enterFactoryV4({ work, form });
  state = m.recordFactoryReality(state, {
    repository: form.repository,
    branch: form.branch,
    headSha: "abc",
    lastUpdated: "now",
  });
  state = m.advanceFactory(state);
  state = m.safeStopToPlan(state, { reason: "rethink" });
  assert.equal(state.stage, "PLAN");
  assert.equal(state.rollback.status, "SAFE_STOPPED");
  assert.equal(state.rollback.fromStage, "BUILD");
});

test("durable Factory V4 service persists one project for the same Work", async () => {
  const { GoHubFactoryState } = await import("../go-hub-factory-state.mjs");
  const { createFactoryV4Service } = await import("../go-hub-factory-service.mjs");
  const stores = new Map();
  const binding = {
    getByName(name) {
      if (!stores.has(name)) {
        const values = new Map();
        const storage = {
          async get(key) { return structuredClone(values.get(key)); },
          async put(entries) {
            for (const [key, value] of Object.entries(entries)) {
              values.set(key, structuredClone(value));
            }
          },
        };
        stores.set(name, new GoHubFactoryState({ storage }, {}));
      }
      return stores.get(name);
    },
  };
  const service = createFactoryV4Service({ binding });
  const liveWork = { ...work, workId: "W-DURABLE", checkpointId: "CP-W-DURABLE" };

  let response = await service({
    action: "start",
    workId: liveWork.workId,
    work: liveWork,
    form: { ...form, projectId: "FACTORY-W-DURABLE" },
  });
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.stage, "PLAN");
  assert.equal(body.projectId, "FACTORY-W-DURABLE");
  assert.equal(body.board.displayName, "FOUNDRY");

  response = await service({
    action: "record_reality",
    workId: liveWork.workId,
    reality: {
      repository: form.repository,
      branch: form.branch,
      headSha: "abc",
      lastUpdated: new Date().toISOString(),
    },
  });
  assert.equal(response.status, 200);

  response = await service({ action: "inspect", workId: liveWork.workId });
  body = await response.json();
  assert.equal(body.task.reality.headSha, "abc");
  assert.equal(body.workId, "W-DURABLE");
});

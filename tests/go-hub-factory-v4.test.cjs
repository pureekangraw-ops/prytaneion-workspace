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
};

const form = {
  repository: "pureekangraw-ops/standard-",
  branch: "work/x",
  expectedOutput: "file",
  outputType: "FILE",
  pixieHandoff: {
    source: "PIXIE_LAB",
    station: "FORGE_BENCH",
    workId: "W1",
    checkpointId: "CP-W1",
    candidateRef: "artifact://candidate-1",
    evidenceRefs: ["evidence://pixie-1"],
  },
  preProductionInspection: {
    inspectionStatus: "PASS",
    sanitizationStatus: "PASS",
    evidence: { refs: ["evidence://preflight-1"] },
  },
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

test("GO WORKS accepts active Work without a redundant local Factory Pass", async () => {
  const { enterFactoryV4 } = await mod();
  const state = enterFactoryV4({ work: { ...work, pass: null }, form });
  assert.equal(state.stage, "PLAN");
  assert.equal(state.intake.source, "PIXIE_LAB");
});

test("GO WORKS requires direct PIXIE LAB handoff and preserves same Work continuity", async () => {
  const { enterFactoryV4 } = await mod();
  const state = enterFactoryV4({ work, form });
  assert.equal(state.displayName, "GO WORKS");
  assert.equal(state.flowVersion, "GO_WORKS_V2");
  assert.equal(state.projectRef.type, "FACTORY");
  assert.equal(state.projectRef.destination, "destination://factory");
  assert.equal(state.intake.source, "PIXIE_LAB");
  assert.equal(state.intake.station, "FORGE_BENCH");
  assert.equal(state.intake.continuity, "SAME_WORK");
  assert.equal(state.intake.workId, work.workId);
  assert.equal(state.intake.checkpointId, work.checkpointId);

  const fallback = enterFactoryV4({ work, form: { ...form, pixieHandoff: null } });
  assert.equal(fallback.intake.source, "DIRECT_GOVERNED_ENTRY");
  assert.equal(fallback.intake.continuity, "SAME_WORK");
});

test("GO WORKS rejects a PIXIE handoff that changes Work identity", async () => {
  const { enterFactoryV4 } = await mod();
  assert.throws(
    () => enterFactoryV4({
      work,
      form: { ...form, pixieHandoff: { ...form.pixieHandoff, workId: "W-OTHER" } },
    }),
    /PIXIE_LAB_WORK_MISMATCH/,
  );
});

test("pre-production inspection and sanitization replace planning before BUILD", async () => {
  const m = await mod();
  let state = m.enterFactoryV4({
    work,
    form: {
      ...form,
      preProductionInspection: {
        inspectionStatus: "UNKNOWN",
        sanitizationStatus: "PENDING",
      },
    },
  });
  state = m.recordFactoryReality(state, {
    repository: form.repository,
    branch: form.branch,
    headSha: "abc",
    lastUpdated: "now",
  });

  assert.equal(m.factoryBoardView(state).flowPhase, "PRE_PRODUCTION_INSPECTION");
  assert.throws(
    () => m.advanceFactory(state),
    /must PASS inspection and sanitization/,
  );

  state = m.setFactoryPreProductionInspection(state, {
    inspection: {
      inspectionStatus: "PASS",
      sanitizationStatus: "PASS",
      evidence: { refs: ["evidence://preflight-2"] },
      notes: "provenance clean; no critical unknowns",
    },
  });
  state = m.advanceFactory(state);
  assert.equal(state.stage, "BUILD");
});

test("pre-production PASS requires evidence", async () => {
  const m = await mod();
  let state = m.enterFactoryV4({
    work,
    form: {
      ...form,
      preProductionInspection: {
        inspectionStatus: "PENDING",
        sanitizationStatus: "PENDING",
      },
    },
  });
  assert.throws(
    () => m.setFactoryPreProductionInspection(state, {
      inspection: { inspectionStatus: "PASS", sanitizationStatus: "PASS" },
    }),
    /requires evidence/,
  );
});

test("GO WORKS exposes PIXIE LAB → inspection → production operator flow", async () => {
  const m = await mod();
  let state = m.enterFactoryV4({ work, form });
  let board = m.factoryBoardView(state);
  assert.deepEqual(board.flowPath, [
    "PIXIE_LAB_HANDOFF",
    "PRE_PRODUCTION_INSPECTION",
    "BUILD",
    "ASSEMBLY",
    "WAIT_EXTERNAL_OWNER_GATE",
    "POST_MERGE_VERIFY",
    "OUTPUT_READBACK",
  ]);

  state = m.recordFactoryReality(state, {
    repository: form.repository,
    branch: form.branch,
    headSha: "abc",
    lastUpdated: "now",
  });
  state = m.advanceFactory(state);
  state = m.advanceFactory(state, { result: { built: true } });
  state = m.advanceFactory(state, { result: { assembled: true } });
  assert.equal(state.stage, "MERGE");
  board = m.factoryBoardView(state);
  assert.equal(board.flowPhase, "WAIT_EXTERNAL_OWNER_GATE");
  assert.equal(board.ownerGate.authority, "GO_HUB_MERGE_OWNER_TRUTH");

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

test("safe stop returns to the pre-production inspection zone and records source stage", async () => {
  const m = await mod();
  let state = m.enterFactoryV4({ work, form });
  state = m.recordFactoryReality(state, {
    repository: form.repository,
    branch: form.branch,
    headSha: "abc",
    lastUpdated: "now",
  });
  state = m.advanceFactory(state);
  state = m.safeStopToPlan(state, { reason: "reinspect" });
  assert.equal(state.stage, "PLAN");
  assert.equal(m.factoryBoardView(state).flowPhase, "PRE_PRODUCTION_INSPECTION");
  assert.equal(state.rollback.status, "SAFE_STOPPED");
  assert.equal(state.rollback.fromStage, "BUILD");
});

test("durable Factory V4 service persists PIXIE intake and inspection for the same Work", async () => {
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
  const liveForm = {
    ...form,
    projectId: "FACTORY-W-DURABLE",
    pixieHandoff: {
      ...form.pixieHandoff,
      workId: liveWork.workId,
      checkpointId: liveWork.checkpointId,
    },
    preProductionInspection: {
      inspectionStatus: "PENDING",
      sanitizationStatus: "PENDING",
    },
  };

  let response = await service({
    action: "start",
    workId: liveWork.workId,
    work: liveWork,
    form: liveForm,
  });
  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(body.stage, "PLAN");
  assert.equal(body.projectId, "FACTORY-W-DURABLE");
  assert.equal(body.board.displayName, "GO WORKS");
  assert.equal(body.board.intake.source, "PIXIE_LAB");

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

  response = await service({
    action: "set_inspection",
    workId: liveWork.workId,
    inspection: {
      inspectionStatus: "PASS",
      sanitizationStatus: "PASS",
      evidence: { refs: ["evidence://durable-preflight"] },
    },
  });
  assert.equal(response.status, 200);

  response = await service({ action: "inspect", workId: liveWork.workId });
  body = await response.json();
  assert.equal(body.task.reality.headSha, "abc");
  assert.equal(body.task.preProductionInspection.inspectionStatus, "PASS");
  assert.equal(body.workId, "W-DURABLE");
});

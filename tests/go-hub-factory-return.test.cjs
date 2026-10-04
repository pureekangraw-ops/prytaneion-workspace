"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const centreUrl = pathToFileURL(path.join(root, "go-hub-centre.js")).href;
const factoryReturnUrl = pathToFileURL(path.join(root, "go-hub-factory-return.js")).href;
const codeModuleUrl = pathToFileURL(path.join(root, "go-hub-code-module.js")).href;

async function createFactoryAccess() {
  const nonce = `${Date.now()}-${Math.random()}`;
  const centreModule = await import(`${centreUrl}?centre=${nonce}`);
  const centre = centreModule.createCentrePassage();
  const ready = centre.fit(
    centre.review(
      centre.enter({ checkpointId: "CENTRE-001", workId: "WORK-A" }),
      {
        task: "Ship GO City roundtrip",
        requestedResult: "Return exact Factory reality evidence",
        authority: "BIG",
      },
    ),
    {
      personaId: "PERSONA-CITY",
      personaReference: "persona://city-roundtrip",
      workingView: "Preserve work identity and return real evidence",
    },
  );
  const away = centre.leave(ready, { destination: "destination://factory" }).work;
  const baseCapability = { id: "code", status: "ready" };
  const access = centreModule.admitDestination(away, {
    destination: "destination://factory",
    capability: baseCapability,
  });
  return { centreModule, centre, away, access };
}

const taskSnapshot = Object.freeze({
  id: "active-code-task",
  repository: "pureekangraw-ops/standard-",
  state: "CI_GREEN",
  nextAction: "merge",
  baseBranch: "main",
  baseSha: "base-sha",
  workBranch: "go-city-roundtrip-integration",
  headSha: "head-sha",
  blocker: null,
  pullRequest: { number: 51, headSha: "head-sha", url: "https://github.com/pureekangraw-ops/standard-/pull/51" },
  ci: { status: "success", headSha: "head-sha" },
  deployment: null,
  verification: null,
  factoryStage: "ASSEMBLY_QC",
  buildArtifact: null,
  pieceQc: { status: "pass", checkedHeadSha: "head-sha" },
  assemblyQc: { status: "pass", checkedHeadSha: "head-sha" },
  productQc: null,
  verificationScan: null,
  evidence: [
    { id: "EV-1", claim: "exact-head CI green", headSha: "head-sha" },
  ],
});

test("Factory work context binds the Code task to the exact Centre identity", async () => {
  const { access } = await createFactoryAccess();
  const { createFactoryWorkContext } = await import(`${factoryReturnUrl}?context=${Date.now()}`);

  const context = createFactoryWorkContext(access, taskSnapshot);

  assert.deepEqual(context, {
    workId: "WORK-A",
    checkpointId: "CENTRE-001",
    returnAddress: "CENTRE-001",
    destination: "destination://factory",
    task: "Ship GO City roundtrip",
    requestedResult: "Return exact Factory reality evidence",
    personaReference: "persona://city-roundtrip",
    repository: "pureekangraw-ops/standard-",
    factoryTaskId: "active-code-task",
  });
});

test("Factory reality return preserves Centre identity and returns real workbench truth", async () => {
  const { centre, away, access } = await createFactoryAccess();
  const { createFactoryRealityReturn } = await import(`${factoryReturnUrl}?return=${Date.now()}`);

  const packet = createFactoryRealityReturn(access, taskSnapshot);
  const returned = centre.return(away, packet);

  assert.equal(packet.workId, "WORK-A");
  assert.equal(packet.checkpointId, "CENTRE-001");
  assert.equal(packet.payload.kind, "FACTORY_REALITY_RETURN");
  assert.equal(packet.payload.status, "RETURNED");
  assert.equal(packet.payload.repository, "pureekangraw-ops/standard-");
  assert.equal(packet.payload.state, "CI_GREEN");
  assert.equal(packet.payload.nextAction, "merge");
  assert.equal(packet.payload.refs.headSha, "head-sha");
  assert.equal(packet.payload.pullRequest.number, 51);
  assert.equal(packet.payload.ci.status, "success");
  assert.equal(packet.payload.mergeReady, true);
  assert.equal(packet.payload.mergeLink, "https://github.com/pureekangraw-ops/standard-/pull/51");
  assert.equal(packet.payload.nextAction, "MERGE_READY");
  assert.deepEqual(packet.payload.evidence, taskSnapshot.evidence);
  assert.equal(JSON.stringify(packet.payload).includes("returned-by-operator"), false);
  assert.equal(returned.workId, "WORK-A");
  assert.equal(returned.checkpointId, "CENTRE-001");
});

test("Code capability can expose a Centre-bound work context without changing repository capability", async () => {
  const { access } = await createFactoryAccess();
  const { createFactoryWorkContext } = await import(`${factoryReturnUrl}?bind=${Date.now()}`);
  const { createCodeCapability } = await import(`${codeModuleUrl}?code=${Date.now()}`);
  const workspace = {
    repository: "pureekangraw-ops/standard-",
    listFiles() {}, readText() {}, inspect() {}, listTree() {}, writeText() {}, deletePath() {},
    createBranch() {}, compare() {}, openPullRequest() {}, getPullRequest() {}, getCI() {},
    rerunFailed() {}, mergePullRequest() {}, getWorkflowRuns() {}, factoryAction() {},
  };
  const context = createFactoryWorkContext(access, taskSnapshot);
  const capability = createCodeCapability({ workspace, task: taskSnapshot, workContext: context, controllerReady: true });

  assert.equal(capability.status, "ready");
  assert.equal(capability.repository, "pureekangraw-ops/standard-");
  assert.deepEqual(capability.workContext, context);
});


test("Factory reality return does not advertise merge-ready when CI is not exact-head green", async () => {
  const { access } = await createFactoryAccess();
  const { createFactoryRealityReturn } = await import(`${factoryReturnUrl}?notready=${Date.now()}`);
  const packet = createFactoryRealityReturn(access, {
    ...taskSnapshot,
    ci: { status: "success", headSha: "other-head" },
  });
  assert.equal(packet.payload.mergeReady, false);
  assert.equal(packet.payload.mergeLink, null);
  assert.notEqual(packet.payload.nextAction, "MERGE_READY");
});

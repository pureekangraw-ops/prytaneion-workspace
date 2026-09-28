"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const agentUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-agent-mission.mjs")).href;
const centreUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-centre-live.mjs")).href;

class MemoryStorage {
  constructor(map = new Map()) { this.map = map; }
  async get(key) { return this.map.get(key); }
  async put(key, value) { this.map.set(key, structuredClone(value)); }
}

function namespaceFor(GoHubCentreState) {
  const instances = new Map();
  return {
    instances,
    getByName(name) {
      if (!instances.has(name)) {
        instances.set(name, new GoHubCentreState({ storage:new MemoryStorage() }, {}));
      }
      const instance = instances.get(name);
      return { fetch: request => instance.fetch(request) };
    },
  };
}

async function body(response) {
  return response.json();
}

test("HERMES production flow uses existing Work Card, durable memory, LIGHT, first-open, mandatory return, and exit", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?flow=" + Date.now());
  const { GoHubCentreState, createCentreLiveService } = await import(centreUrl + "?flow=" + Date.now());
  const namespace = namespaceFor(GoHubCentreState);
  const centreLive = createCentreLiveService({ namespace });
  const counterDispatch = {
    async create(input) {
      return new Response(JSON.stringify({
        ok:true,
        counter:{ counterId:input.counterId },
        lightResult:{
          status:"ANSWERED",
          answer:"Factory source found",
          sources:["github://pureekangraw-ops/standard-/go-hub-factory-service.mjs"],
          evidence:[{ kind:"SOURCE", ref:"github://pureekangraw-ops/standard-/go-hub-factory-service.mjs" }],
          confidence:"HIGH",
          nextRoute:"GO",
        },
      }), { headers:{ "content-type":"application/json" } });
    },
  };
  const boardRead = async () => new Response(JSON.stringify({
    ok:true,
    pins:[{
      workId:"WORK-OLD-FACTORY",
      jobCode:"2709-OLD1",
      status:"DOING",
      title:"ซ่อมโรงงาน",
      detail:"Factory maintenance",
      updatedAt:"2026-09-27T01:00:00.000Z",
      card:{
        cardId:"CARD:2709-OLD1",
        workId:"WORK-OLD-FACTORY",
        jobCode:"2709-OLD1",
        status:"Resume",
        sourceStatus:"ON PROCESS",
        title:"ซ่อมโรงงาน",
        detail:"Factory maintenance",
      },
    }],
  }), { headers:{ "content-type":"application/json" } });

  let seq = 0;
  const service = createAgentMissionService({
    centreLive,
    counterDispatch,
    boardRead,
    createId: prefix => prefix + "-TEST-" + (++seq),
  });

  const found = await body(await service.action({ action:"find", mission:"มาซ่อมโรงงาน" }));
  assert.equal(found.ok, true);
  assert.equal(found.boardExposed, false);
  assert.equal(found.source, "HEIMDALL_PROJECT_INDEX");
  assert.equal(found.candidates[0].workId, "WORK-OLD-FACTORY");

  const reviewRequired = await service.action({
    action:"create",
    mission:"มาซ่อมโรงงาน HERMES",
    requestedResult:"Factory works and card returns with current reality",
    destinations:["destination://factory"],
    scope:["destination://factory"],
  });
  assert.equal(reviewRequired.status, 409);
  const review = await body(reviewRequired);
  assert.equal(review.code, "HERMES_SIMILAR_WORK_REVIEW_REQUIRED");
  assert.equal(review.decisionRequired, "CREATE_NEW_OR_REUSE");
  assert.equal(review.candidates[0].workId, "WORK-OLD-FACTORY");

  const callerOverride = await service.action({
    action:"create",
    mission:"มาซ่อมโรงงาน HERMES",
    requestedResult:"Factory works and card returns with current reality",
    workId:"WORK-CALLER-MUST-NOT-MINT-20260928-001",
    workKey:"HERMES-FACTORY-REPAIR",
    createDecision:"CREATE_NEW",
    destinations:["destination://factory"],
    scope:["destination://factory"],
  });
  assert.equal(callerOverride.status, 400);
  assert.equal((await body(callerOverride)).code, "HERMES_WORK_ID_CALLER_OVERRIDE_FORBIDDEN");

  const createdResponse = await service.action({
    action:"create",
    mission:"มาซ่อมโรงงาน HERMES",
    requestedResult:"Factory works and card returns with current reality",
    workKey:"HERMES-FACTORY-REPAIR",
    createDecision:"CREATE_NEW",
    destinations:["destination://factory"],
    scope:["destination://factory"],
  });
  assert.equal(createdResponse.status, 201);
  const created = await body(createdResponse);
  assert.match(created.card.cardId, /^CARD:\d{4}-[A-Z0-9]{4}$/);
  assert.match(created.workContext.workId, /^WORK-HERMES-FACTORY-REPAIR-\d{8}-001$/);
  assert.equal(created.workContext.checkpointId, "CP-" + created.workContext.workId);
  const workContext = created.workContext;

  const selected = await body(await service.action({
    action:"select_context",
    workContext,
    candidates:[
      { contextId:"CTX-KEEP", ref:"github://factory", summary:"current factory source" },
      { contextId:"CTX-DROP", ref:"notion://old", summary:"old note" },
    ],
    selectedIds:["CTX-KEEP"],
  }));
  assert.deepEqual(selected.mission.memory.contextRefs, ["github://factory"]);

  const light = await body(await service.action({
    action:"ask_light",
    workContext,
    question:"มีข้อมูลโรงงานล่าสุดอะไรเพิ่ม?",
  }));
  assert.equal(light.selectedAutomatically, false);
  assert.equal(light.candidates.length >= 1, true);
  assert.deepEqual(light.mission.memory.contextRefs, ["github://factory"], "LIGHT must not silently mutate selected context");

  const first = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  }));
  assert.equal(first.status, "OPENED");
  assert.equal(first.card.sourceStatus, "ON PROCESS");
  assert.equal(first.mission.memory.openedSpaces["destination://factory"].openedBy, "heimdall");

  const touched = await body(await service.action({
    action:"touch",
    workContext,
    station:"FACTORY",
  }));
  assert.equal(touched.card.cardId, created.card.cardId);
  assert.equal(touched.authorityCreated, false);
  assert.equal(touched.boardExposed, false);
  assert.deepEqual(touched.memory.contextRefs, ["github://factory"]);

  const blockedExit = await service.action({ action:"exit", workContext });
  assert.equal(blockedExit.status, 409);
  assert.equal((await body(blockedExit)).code, "HERMES_RETURN_REQUIRED_BEFORE_EXIT");

  const returned = await body(await service.action({
    action:"return",
    workContext,
    status:"ON PROCESS",
    result:{ summary:"patched but more work remains" },
    nextAction:"continue verification",
    evidence:[{ ref:"commit://abc" }],
    lastLocation:"destination://factory",
  }));
  assert.equal(returned.readbackVerified, true);
  assert.equal(returned.card.sourceStatus, "OPEN");
  assert.equal(returned.mission.session.status, "RETURNED");
  assert.equal(returned.mission.memory.latestReality.missionStatus, "ON PROCESS");

  const exited = await body(await service.action({ action:"exit", workContext }));
  assert.equal(exited.exited, true);
  assert.equal(exited.mission.session.status, "EXITED");

  const reentered = await body(await service.action({
    action:"enter",
    workContext,
    mission:"กลับมาซ่อมโรงงานต่อ",
  }));
  assert.equal(reentered.noGate, true);
  const secondOpen = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  }));
  assert.equal(secondOpen.status, "ALREADY_OPEN", "Heimdall first-open decision is not repeated for an already provisioned space");
  assert.equal(secondOpen.runtimePassOpened, true, "runtime access may be reopened automatically without making first-open a new gate");
});

test("Centre sidecar refuses fake first-open, fake return, and exit without owner return readback", async () => {
  const { GoHubCentreState } = await import(centreUrl + "?guards=" + Date.now());
  const instance = new GoHubCentreState({ storage:new MemoryStorage() }, {});
  async function call(input) {
    const response = await instance.fetch(new Request("https://centre.test/action", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify(input),
    }));
    return { status:response.status, body:await response.json() };
  }

  const workId = "WORK-HERMES-GUARD";
  const checkpointId = "CP-" + workId;
  assert.equal((await call({
    action:"v4_create",
    workId,
    work:{ name:"Hermes guard", command:"Hermes guard", expectedResult:"safe", requestedDestinations:["destination://factory"], scope:["destination://factory"] },
  })).status, 200);
  assert.equal((await call({
    action:"v4_mission_enter", workId, checkpointId,
    sessionId:"HERMES-GUARD-1", agentId:"GO", mission:"guard", requestedResult:"safe",
  })).status, 200);

  const fakeOpen = await call({
    action:"v4_mission_first_open", workId, checkpointId, destination:"destination://factory", firstOpen:true,
  });
  assert.equal(fakeOpen.status, 409);
  assert.equal(fakeOpen.body.code, "HERMES_ACTIVE_ACCESS_REQUIRED");

  const fakeReturn = await call({
    action:"v4_mission_return", workId, checkpointId, missionStatus:"WAIT",
  });
  assert.equal(fakeReturn.status, 200, "OPEN Work is already owner-returned / not active, so memory may record a return");

  const exited = await call({ action:"v4_mission_exit", workId, checkpointId });
  assert.equal(exited.status, 200);
  assert.equal(exited.body.mission.session.status, "EXITED");
});

test("active owner Work cannot be marked returned in HERMES until Centre return really happens", async () => {
  const { GoHubCentreState } = await import(centreUrl + "?return-guard=" + Date.now());
  const instance = new GoHubCentreState({ storage:new MemoryStorage() }, {});
  async function call(input) {
    const response = await instance.fetch(new Request("https://centre.test/action", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify(input),
    }));
    return { status:response.status, body:await response.json() };
  }

  const workId = "WORK-HERMES-ACTIVE";
  const checkpointId = "CP-" + workId;
  await call({ action:"v4_create", workId, work:{ name:"Active", command:"Active", expectedResult:"safe", requestedDestinations:["destination://factory"], scope:["destination://factory"] } });
  await call({ action:"v4_mission_enter", workId, checkpointId, sessionId:"S1", agentId:"GO", mission:"active" });
  await call({ action:"v4_claim", workId, checkpointId, actor:"GO" });
  await call({
    action:"v4_open_pass", workId, checkpointId, actor:"GO", kind:"WORK",
    destinations:["destination://factory"], scope:["destination://factory"], returnAddress:checkpointId, closeCondition:"RETURN",
  });
  const blocked = await call({ action:"v4_mission_return", workId, checkpointId, missionStatus:"WAIT" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "HERMES_OWNER_RETURN_READBACK_REQUIRED");

  const returned = await call({ action:"v4_return", workId, checkpointId, actor:"GO", status:"OPEN", result:{ ok:true }, evidence:[] });
  assert.equal(returned.status, 200);
  const recorded = await call({ action:"v4_mission_return", workId, checkpointId, missionStatus:"WAIT", nextAction:"resume later" });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.mission.session.status, "RETURNED");
});

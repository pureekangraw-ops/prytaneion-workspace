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

  const cardDraft = await body(await service.action({
    action:"prepare_card",
    workContext,
    accessScope:"WORK",
    toolAccess:["go_hub_factory_v4","go_hub_read_file"],
    destinations:["destination://factory"],
  }));
  assert.equal(cardDraft.issued, false);
  assert.equal(cardDraft.cardDraft.state, "DRAFT");

  const cardRejected = await service.action({ action:"confirm_card", workContext });
  assert.equal(cardRejected.status, 409);

  const cardIssued = await body(await service.action({
    action:"confirm_card",
    workContext,
    confirmation:"GO_CONFIRMED",
  }));
  assert.equal(cardIssued.issued, true);
  assert.equal(cardIssued.card.state, "CURRENT");
  assert.equal(cardIssued.card.workId, workContext.workId);
  assert.equal(cardIssued.card.checkpointId, workContext.checkpointId);

  const first = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  }));
  assert.equal(first.status, "OPENED");
  assert.equal(first.card.sourceStatus, "ON PROCESS");
  assert.equal(first.mission.memory.openedSpaces["destination://factory"].openedBy, "heimdall");

  const routeDraft = await body(await service.action({
    action:"prepare_route_change",
    workContext,
    toolAccess:["go_hub_factory_v4","go_hub_read_file","go_hub_notion_light"],
    destinations:["destination://notion"],
  }));
  assert.equal(routeDraft.routeChanged, false);
  assert.equal(routeDraft.replacementDraft.state, "DRAFT");
  assert.deepEqual(routeDraft.currentCard.destinations, ["destination://factory"]);

  const routeRejected = await service.action({ action:"confirm_route_change", workContext });
  assert.equal(routeRejected.status, 409);

  const routeChanged = await body(await service.action({
    action:"confirm_route_change",
    workContext,
    confirmation:"GO_CONFIRMED",
  }));
  assert.equal(routeChanged.replaced, true);
  assert.equal(routeChanged.routeOpened, false);
  assert.equal(routeChanged.card.workId, workContext.workId);
  assert.equal(routeChanged.card.checkpointId, workContext.checkpointId);
  assert.deepEqual(routeChanged.card.destinations, ["destination://factory","destination://notion"]);
  assert.equal(routeChanged.audit.event, "CARD_REPLACED");

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

  const updatePrompt = returned.prompt;
  assert.match(updatePrompt, /อัปเดตการ์ด/);
  const updated = await body(await service.action({ action:"update_card", workContext }));
  assert.equal(updated.updated, true);
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

  const blockedCardExit = await call({ action:"v4_mission_exit", workId, checkpointId });
  assert.equal(blockedCardExit.status, 409);
  assert.equal(blockedCardExit.body.code, "HERMES_CARD_UPDATE_REQUIRED_BEFORE_EXIT");
  const updatedCard = await call({ action:"v4_mission_card_update", workId, checkpointId });
  assert.equal(updatedCard.status, 200);
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


test("HERMES Factory card stops on uncertainty and requires GO final confirmation before issue", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?factory-card=" + Date.now());
  const work = {
    workId:"WORK-HERMES-CARD-TEST", checkpointId:"CP-WORK-HERMES-CARD-TEST", jobCode:"2809-TST1",
    status:"OPEN", name:"HERMES card test", command:"Prepare Factory card", expectedResult:"Factory receives complete verified form",
    requestedDestinations:["destination://factory"], scope:["factory"], pass:{ state:"CLOSED" },
  };
  const mission = { session:{ status:"ACTIVE" }, memory:{ mission:"Prepare Factory card", requestedResult:"Factory receives complete verified form", contextRefs:["ref://mission"] } };
  const centreLive = { async action(input) {
    if (input.action === "v4_mission_get") return new Response(JSON.stringify({ work, mission }), { headers:{"content-type":"application/json"} });
    if (input.action === "v4_inspect") return new Response(JSON.stringify({ work }), { headers:{"content-type":"application/json"} });
    throw new Error("unexpected centre action " + input.action);
  }};
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[] }), { headers:{"content-type":"application/json"} }),
  });
  const workContext = { workId:work.workId, checkpointId:work.checkpointId };

  const stopped = await service.action({ action:"prepare_factory_card", workContext });
  assert.equal(stopped.status, 409);
  const stoppedBody = await body(stopped);
  assert.equal(stoppedBody.status, "WAIT_GO_INPUT");
  assert.equal(stoppedBody.issued, false);
  assert.equal(stoppedBody.uncertainFields.includes("repository"), true);
  assert.equal(stoppedBody.uncertainFields.includes("branch"), true);
  assert.equal(stoppedBody.assistance.find(item => item.field === "repository").mode, "ASK_LIGHT_OR_GO");

  const assisted = await service.action({
    action:"prepare_factory_card", workContext,
    choices:{ repository:[{ value:"pureekangraw-ops/standard-", label:"standard-", source:"LIGHT" }] },
  });
  const assistedBody = await body(assisted);
  const repositoryHelp = assistedBody.assistance.find(item => item.field === "repository");
  assert.equal(repositoryHelp.mode, "GO_SELECT");
  assert.equal(repositoryHelp.choices[0].source, "LIGHT");
  assert.match(repositoryHelp.instruction, /GO/);

  const factory = {
    repository:"pureekangraw-ops/standard-",
    branch:"feat/hermes-card-test",
    outputType:"REF",
    inputReferences:["ref://mission"],
    preProductionInspection:{ inspectionStatus:"PENDING", sanitizationStatus:"PENDING" },
    criticalChecklist:[{ id:"truth", label:"Use verified values only" }],
  };
  const review = await body(await service.action({ action:"prepare_factory_card", workContext, factory }));
  assert.equal(review.status, "WAIT_GO_CONFIRMATION");
  assert.equal(review.issued, false);
  assert.equal(review.uncertainFields.length, 0);
  assert.match(review.prompt, /ยืนยัน/);

  const blocked = await service.action({ action:"confirm_factory_card", workContext, factory });
  assert.equal(blocked.status, 409);
  assert.equal((await body(blocked)).code, "HERMES_GO_FINAL_CONFIRMATION_REQUIRED");

  const issued = await body(await service.action({ action:"confirm_factory_card", workContext, factory, confirmation:"GO_CONFIRMED" }));
  assert.equal(issued.status, "ISSUED");
  assert.equal(issued.issued, true);
  assert.equal(issued.acceptedBy, "GO");
  assert.equal(issued.factoryForm.repository, factory.repository);
});

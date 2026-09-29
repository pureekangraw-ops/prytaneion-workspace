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

  const callerOverride = await service.action({
    action:"create",
    mission:"มาซ่อมโรงงาน HERMES",
    requestedResult:"Factory works and card returns with current reality",
    workId:"WORK-CALLER-MUST-NOT-MINT-20260928-001",
    workKey:"HERMES-FACTORY-REPAIR",
    createDecision:"CREATE_NEW",
    destinations:["destination://factory"],
    scope:["destination://factory"],
    recommendedTools:["go_hub_factory_v4","go_hub_read_file"],
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
    recommendedTools:["go_hub_factory_v4","go_hub_read_file"],
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

  const foundForCard = await body(await service.action({ action:"find", mission:"มาซ่อมโรงงาน HERMES", limit:5 }));
  assert.equal(Array.isArray(foundForCard.recommendedTools), true);
  const cardResponse = await service.action({
    action:"issue_card",
    workContext,
    destinations:["destination://factory"],
  });
  assert.equal(cardResponse.status, 200);
  const cardIssued = await body(cardResponse);
  assert.equal(cardIssued.issued, true);
  assert.equal(cardIssued.card.state, "CURRENT");
  assert.equal(cardIssued.card.workId, workContext.workId);
  assert.equal(cardIssued.card.checkpointId, workContext.checkpointId);

  const blockedFirst = await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  });
  assert.equal(blockedFirst.status, 409);
  assert.equal((await body(blockedFirst)).code, "HERMES_ACTIVE_PASS_REQUIRED");
  await body(await centreLive.action({
    action:"v4_open_pass",
    ...workContext,
    actor:"GO",
    kind:"WORK",
    destinations:["destination://factory"],
    scope:["destination://factory"],
    closeCondition:"RETURN",
    returnAddress:workContext.checkpointId,
    reason:"TEST_EXPLICIT_AUTHORITY",
  }));
  const first = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  }));
  assert.equal(first.status, "OPENED");
  assert.equal(first.runtimePassOpened, false);
  assert.equal(first.card.sourceStatus, "ON PROCESS");
  assert.equal(first.mission.memory.openedSpaces["destination://factory"].openedBy, "heimdall");
  assert.equal(first.readout.kind, "HERMES_MISSION_READOUT");
  assert.equal(first.readout.mode, "READ_ONLY");
  assert.equal(first.readout.work.ownerSource, "CENTRE_DURABLE_STORE");
  assert.deepEqual(first.readout.currentRoute, ["destination://factory"]);
  assert.equal(first.readout.warpDoors[0].destination, "destination://factory");
  assert.equal(first.readout.warpDoors[0].active, true);
  assert.equal(first.readout.warpDoors[0].returnAddress, workContext.checkpointId);

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
  assert.deepEqual(routeChanged.readout.currentRoute, ["destination://factory","destination://notion"]);
  assert.equal(routeChanged.readout.warpDoors.length, 2);
  assert.equal(routeChanged.readout.warpDoors.find(item => item.destination === "destination://notion").active, false);

  await body(await centreLive.action({
    action:"v4_return",
    ...workContext,
    actor:"GO",
    status:"OPEN",
    result:{ summary:"switch explicit authority to notion" },
    evidence:[],
  }));
  await body(await centreLive.action({ action:"v4_claim", ...workContext, actor:"GO" }));
  await body(await centreLive.action({
    action:"v4_open_pass",
    ...workContext,
    actor:"GO",
    kind:"WORK",
    destinations:["destination://notion"],
    scope:["destination://notion"],
    closeCondition:"RETURN",
    returnAddress:workContext.checkpointId,
    reason:"TEST_EXPLICIT_AUTHORITY",
  }));
  const notionOpened = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://notion",
    workspace:"notion",
  }));
  assert.equal(notionOpened.status, "OPENED");
  assert.equal(notionOpened.readout.warpDoors.find(item => item.destination === "destination://notion").active, true);
  assert.equal(notionOpened.readout.currentRoute.includes("destination://notion"), true);

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

  assert.equal(returned.cardUpdateRequired, false);
  assert.match(returned.prompt, /พร้อมออกจาก Mission/);
  assert.equal(returned.readout.resume.mode, "RETURNED_OPEN");
  assert.equal(returned.readout.resume.resumable, true);
  const exited = await body(await service.action({ action:"exit", workContext }));
  assert.equal(exited.exited, true);
  assert.equal(exited.mission.session.status, "EXITED");

  const reentered = await body(await service.action({
    action:"enter",
    workContext,
    mission:"กลับมาซ่อมโรงงานต่อ",
  }));
  assert.equal(reentered.noGate, true);
  assert.equal(reentered.readout.kind, "HERMES_MISSION_READOUT");
  assert.equal(reentered.readout.resume.mode, "RETURNED_OPEN");
  assert.equal(reentered.readout.resume.resumable, true);
  const blockedSecondOpen = await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  });
  assert.equal(blockedSecondOpen.status, 409);
  assert.equal((await body(blockedSecondOpen)).code, "HERMES_ACTIVE_PASS_REQUIRED");
  await body(await centreLive.action({
    action:"v4_claim",
    ...workContext,
    actor:"GO",
  }));
  await body(await centreLive.action({
    action:"v4_open_pass",
    ...workContext,
    actor:"GO",
    kind:"WORK",
    destinations:["destination://factory"],
    scope:["destination://factory"],
    closeCondition:"RETURN",
    returnAddress:workContext.checkpointId,
    reason:"TEST_EXPLICIT_AUTHORITY",
  }));
  const secondOpen = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"standard",
  }));
  assert.equal(secondOpen.status, "OPENED", "a new mission session may reopen an already provisioned space");
  assert.equal(secondOpen.runtimePassOpened, false, "HERMES must never mint runtime authority during first-open");
});

test("HERMES derives bounded GitHub tool access from an existing destination instead of blocking on tool recommendation", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?github-route-tools=" + Date.now());
  const workContext = { workId:"WORK-HUB-DREAM-ROUTE", checkpointId:"CP-WORK-HUB-DREAM-ROUTE" };
  const work = {
    ...workContext,
    workType:"NORMAL",
    status:"OPEN",
    command:"Improve GO Hub",
    name:"Improve GO Hub",
    expectedResult:"Open a reviewable GitHub revision",
    requestedDestinations:["github://pureekangraw-ops/prytaneion-workspace"],
    scope:["github://pureekangraw-ops/prytaneion-workspace"],
    pass:null,
  };
  let prepared = null;
  const centreLive = {
    async action(input) {
      if (input.action === "v4_mission_get") {
        return new Response(JSON.stringify({
          ok:true,
          work,
          mission:{ session:{ status:"ENTERED" }, memory:{ mission:work.command, recommendedTools:[], selectedContext:[] } },
        }), { headers:{ "content-type":"application/json" } });
      }
      if (input.action === "v4_inspect") {
        return new Response(JSON.stringify({ ok:true, work }), { headers:{ "content-type":"application/json" } });
      }
      if (input.action === "v4_mission_card_prepare") {
        prepared = structuredClone(input);
        return new Response(JSON.stringify({ ok:true, mission:{ memory:{ cardMachine:{ draft:{ state:"DRAFT" } } } } }), { headers:{ "content-type":"application/json" } });
      }
      if (input.action === "v4_mission_card_issue") {
        return new Response(JSON.stringify({
          ok:true,
          mission:{ memory:{ cardMachine:{ current:{
            state:"CURRENT",
            workId:workContext.workId,
            checkpointId:workContext.checkpointId,
            destinations:prepared.destinations,
            access_scope:prepared.accessScope,
            tool_access:prepared.toolAccess,
          } } } },
        }), { headers:{ "content-type":"application/json" } });
      }
      throw new Error("unexpected centre action " + input.action);
    },
  };
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[] }), { headers:{ "content-type":"application/json" } }),
  });

  const response = await service.action({ action:"issue_card", workContext });
  assert.equal(response.status, 200);
  const issued = await body(response);
  assert.equal(issued.issued, true);
  assert.ok(prepared.toolAccess.includes("go_hub_inspect_repository"));
  assert.ok(prepared.toolAccess.includes("go_hub_read_file"));
  assert.ok(prepared.toolAccess.includes("go_hub_create_branch"));
  assert.ok(prepared.toolAccess.includes("go_hub_put_file"));
  assert.ok(prepared.toolAccess.includes("go_hub_open_pull_request"));
  assert.ok(prepared.toolAccess.includes("go_hub_get_ci"));
  assert.equal(prepared.toolAccess.includes("go_hub_delete_file"), false);
  assert.equal(prepared.toolAccess.includes("go_hub_merge_pull_request"), false);
});

test("HERMES first-open never widens the Work route behind GO's back", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?route-no-widen=" + Date.now());
  const workContext = { workId:"WORK-HERMES-NO-WIDEN", checkpointId:"CP-WORK-HERMES-NO-WIDEN" };
  const work = {
    ...workContext,
    workType:"NORMAL",
    status:"OPEN",
    holder:null,
    command:"Factory-only mission",
    name:"Factory-only mission",
    expectedResult:"Stay inside the confirmed route",
    requestedDestinations:["destination://factory"],
    scope:["destination://factory"],
    pass:null,
  };
  const actions = [];
  const centreLive = {
    async action(input) {
      actions.push(input.action);
      if (input.action === "v4_mission_get") {
        return new Response(JSON.stringify({
          ok:true,
          work,
          mission:{ session:{ status:"ENTERED" }, memory:{ openedSpaces:{} } },
        }), { headers:{ "content-type":"application/json" } });
      }
      if (input.action === "v4_inspect") {
        return new Response(JSON.stringify({ ok:true, work }), { headers:{ "content-type":"application/json" } });
      }
      throw new Error("unexpected centre action " + input.action);
    },
  };
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[] }), { headers:{ "content-type":"application/json" } }),
  });

  const response = await service.action({
    action:"first_open",
    workContext,
    destination:"destination://notion",
  });
  assert.equal(response.status, 409);
  const result = await body(response);
  assert.equal(result.code, "HERMES_ROUTE_CHANGE_REQUIRED");
  assert.deepEqual(result.cause.requestedDestinations, ["destination://factory"]);
  assert.equal(actions.includes("v4_update_destinations"), false);
  assert.equal(actions.includes("v4_claim"), false);
  assert.equal(actions.includes("v4_open_pass"), false);
});

test("Centre sidecar refuses fake first-open but lets verified returned Work exit without an extra card-update ritual", async () => {
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
  assert.equal(Date.parse(exited.body.mission.memory.cardMachine.lastCardUpdateAt) >= Date.parse(exited.body.mission.session.returnedAt), true);
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
  const exited = await call({ action:"v4_mission_exit", workId, checkpointId });
  assert.equal(exited.status, 200);
  assert.equal(exited.body.mission.session.status, "EXITED");
});


test("HERMES reopens COMPLETE Work on the same identity without minting a new Work", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?reopen=" + Date.now());
  const { GoHubCentreState, createCentreLiveService } = await import(centreUrl + "?reopen=" + Date.now());
  const namespace = namespaceFor(GoHubCentreState);
  const centreLive = createCentreLiveService({ namespace });
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[] }), { headers:{ "content-type":"application/json" } }),
    createId:prefix => prefix + "-REOPEN",
  });

  const created = await body(await service.action({
    action:"create",
    mission:"แก้งานเดิมหลังปิดงาน",
    requestedResult:"แก้ไขโดยใช้ Work เดิม",
    workKey:"REOPEN-SAME-WORK",
    createDecision:"CREATE_NEW",
    destinations:["destination://factory"],
    scope:["destination://factory"],
  }));
  const workContext = created.workContext;
  const originalWorkId = workContext.workId;
  const originalCheckpointId = workContext.checkpointId;

  const issued = await body(await service.action({ action:"issue_card", workContext }));
  assert.equal(issued.issued, true);
  await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"factory",
  }));
  const completed = await body(await service.action({
    action:"return",
    workContext,
    status:"COMPLETE",
    result:{ summary:"first completion" },
    evidence:[{ ref:"commit://first-completion" }],
    lastLocation:"destination://factory",
  }));
  assert.equal(completed.card.sourceStatus, "COMPLETE");
  await body(await service.action({ action:"exit", workContext }));

  const reopened = await body(await service.action({
    action:"reopen",
    workContext,
    mission:"แก้ไขงานเดิมต่อ",
  }));
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.sameWork, true);
  assert.equal(reopened.workContext.workId, originalWorkId);
  assert.equal(reopened.workContext.checkpointId, originalCheckpointId);
  assert.equal(reopened.card.sourceStatus, "ON PROCESS");
  assert.equal(reopened.card.holder, "GO");
  assert.equal(reopened.readout.resume.mode, "GO_ACTIVE");
  assert.equal(reopened.readout.work.workId, originalWorkId);

  const blockedReopenedSpace = await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"factory",
  });
  assert.equal(blockedReopenedSpace.status, 409);
  assert.equal((await body(blockedReopenedSpace)).code, "HERMES_ACTIVE_PASS_REQUIRED");
  await body(await centreLive.action({
    action:"v4_open_pass",
    ...workContext,
    actor:"GO",
    kind:"WORK",
    destinations:["destination://factory"],
    scope:["destination://factory"],
    closeCondition:"RETURN",
    returnAddress:workContext.checkpointId,
    reason:"TEST_EXPLICIT_AUTHORITY",
  }));
  const reopenedSpace = await body(await service.action({
    action:"first_open",
    workContext,
    destination:"destination://factory",
    workspace:"factory",
  }));
  assert.equal(reopenedSpace.status, "OPENED");
  assert.equal(reopenedSpace.runtimePassOpened, false, "HERMES must use explicit authority without minting a Pass");
  assert.equal(reopenedSpace.card.sourceStatus, "ON PROCESS");
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


test("HERMES reconciles indexed checkpoint pointers against Centre owner truth", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?pointer-drift=" + Date.now());
  const workId = "WORK-POINTER-DRIFT";
  const ownerCheckpoint = "CP-GO-HUB-SYSTEM-CHECK-001";
  const centreLive = {
    async action(input) {
      if (input.action === "v4_inspect") {
        return new Response(JSON.stringify({ ok:true, v4:true, work:{ workId, checkpointId:ownerCheckpoint } }), { headers:{ "content-type":"application/json" } });
      }
      throw new Error("unexpected Centre action " + input.action);
    },
  };
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[{
      workId,
      title:"GO Hub system check",
      detail:"inspect current system",
      updatedAt:"2026-09-29T08:00:00.000Z",
      card:{ checkpointId:"CP-WORK-GO-HUB-SYSTEM-CHECK-20260924-001", title:"GO Hub system check", detail:"inspect current system" },
    }] }), { headers:{ "content-type":"application/json" } }),
  });
  const response = await service.action({ action:"find", mission:"GO Hub system check" });
  const result = await response.json();
  assert.equal(result.candidates[0].checkpointId, ownerCheckpoint);
  assert.equal(result.candidates[0].checkpointStatus, "OWNER_CORRECTED");
  assert.equal(result.candidates[0].checkpointDrift, true);
});


test("HERMES issues a maintenance card from Maintenance pass context, not stale recommendations", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?maintenance-scope=" + Date.now());
  const workContext = { workId:"WORK-MAINTENANCE-SCOPE", checkpointId:"CP-MAINTENANCE-SCOPE" };
  const work = {
    ...workContext,
    workType:"NORMAL",
    command:"Inspect GO Hub maintenance",
    name:"Inspect GO Hub maintenance",
    expectedResult:"Maintenance inspection",
    requestedDestinations:["destination://maintenance"],
    pass:{ kind:"MAINTENANCE", state:"ACTIVE", allowedDestinations:["ALL_GO_HUB_OWNED_AREAS"] },
  };
  const prepared = [];
  const centreLive = {
    async action(input) {
      if (input.action === "v4_mission_get") return new Response(JSON.stringify({ ok:true, work, mission:{ session:{ status:"ENTERED" }, memory:{ mission:work.command, recommendedTools:["PIXIE_VISUAL_WORKBENCH"], selectedContext:[] } } }), { headers:{ "content-type":"application/json" } });
      if (input.action === "v4_mission_card_prepare") { prepared.push(input); return new Response(JSON.stringify({ ok:true, mission:{} }), { headers:{ "content-type":"application/json" } }); }
      if (input.action === "v4_mission_card_issue") return new Response(JSON.stringify({ ok:true, mission:{ memory:{ cardMachine:{ current:{ access_scope:"MAINTENANCE", tool_access:[] } } } } }), { headers:{ "content-type":"application/json" } });
      throw new Error("unexpected Centre action " + input.action);
    },
  };
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[] }), { headers:{ "content-type":"application/json" } }),
  });
  const response = await service.action({ action:"issue_card", workContext });
  assert.equal(response.status, 200);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].accessScope, "MAINTENANCE");
  assert.deepEqual(prepared[0].toolAccess, ["go_hub_maintenance"]);
});

test("HERMES exact Work and repository lookup does not suggest unrelated Work", async () => {
  const { rankMissionCandidates, createAgentMissionService } = await import(agentUrl + "?exact-search=" + Date.now());
  const pins = [
    { workId:"WORK-PIXIE-20260929-001", title:"PIXIE LAB", detail:"visual workbench", status:"DOING", card:{ tool_access:["PIXIE_VISUAL_WORKBENCH"] } },
    { workId:"WORK-OLYMPUS-20260929-001", title:"OLYMPUS release", repository:"pureekangraw-ops/Olympus", status:"OPEN" },
  ];
  assert.deepEqual(rankMissionCandidates("WORK-MISSING-20260929-001", pins), []);
  assert.deepEqual(rankMissionCandidates("pureekangraw-ops/Other", pins), []);
  assert.equal(rankMissionCandidates("WORK-OLYMPUS-20260929-001", pins)[0].source, "WORK_ID");
  assert.equal(rankMissionCandidates("https://github.com/pureekangraw-ops/Olympus", pins)[0].workId, "WORK-OLYMPUS-20260929-001");

  const service = createAgentMissionService({
    centreLive:{ async action(){ throw new Error("no candidate should be inspected"); } },
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[pins[0]] }), { headers:{ "content-type":"application/json" } }),
  });
  const missing = await body(await service.action({ action:"find", mission:"WORK-MISSING-20260929-001", threshold:0 }));
  assert.equal(missing.noMatch, true);
  assert.deepEqual(missing.candidates, []);
  assert.deepEqual(missing.recommendedTools, []);
  const unrelated = await body(await service.action({ action:"find", mission:"OLYMPUS version registry release governance LIGHT app update", threshold:0 }));
  assert.deepEqual(unrelated.candidates, []);
  assert.deepEqual(unrelated.recommendedTools, []);
});


test("HERMES gives GO manual continue and emergency in-out buttons instead of trapping GO in lifecycle errors", async () => {
  const { createAgentMissionService } = await import(agentUrl + "?manual-buttons=" + Date.now());
  const { GoHubCentreState, createCentreLiveService } = await import(centreUrl + "?manual-buttons=" + Date.now());
  const namespace = namespaceFor(GoHubCentreState);
  const centreLive = createCentreLiveService({ namespace });
  const service = createAgentMissionService({
    centreLive,
    counterDispatch:{ async create(){ throw new Error("unused"); } },
    boardRead:async () => new Response(JSON.stringify({ ok:true, pins:[] }), { headers:{ "content-type":"application/json" } }),
    createId:prefix => prefix + "-MANUAL",
  });

  const created = await body(await service.action({
    action:"create",
    mission:"manual rescue test",
    requestedResult:"GO can continue or escape without a ritual deadlock",
    workKey:"MANUAL-RESCUE",
    createDecision:"CREATE_NEW",
    destinations:["destination://factory"],
    scope:["destination://factory"],
  }));
  const workContext = created.workContext;

  const initial = await body(await service.action({ action:"inspect", workContext }));
  assert.deepEqual(
    initial.readout.manualControls.map(item => item.action),
    ["manual_continue","emergency_enter","emergency_exit"],
  );

  const continued = await body(await service.action({ action:"manual_continue", workContext }));
  assert.equal(continued.continued, true);
  assert.equal(continued.explicitOwnerAction, true);
  assert.equal(continued.card.sourceStatus, "ON PROCESS");
  assert.equal(continued.card.holder, "GO");
  assert.equal(continued.readout.access.passState, null, "manual continue must not open a Destination Pass");

  const blockedExit = await service.action({ action:"exit", workContext });
  assert.equal(blockedExit.status, 409);
  const blocked = await body(blockedExit);
  assert.equal(blocked.code, "HERMES_RETURN_REQUIRED_BEFORE_EXIT");
  assert.deepEqual(
    blocked.manualControls.map(item => item.action),
    ["manual_continue","emergency_enter","emergency_exit"],
  );

  const escaped = await body(await service.action({ action:"emergency_exit", workContext }));
  assert.equal(escaped.emergency, true);
  assert.equal(escaped.exited, true);
  assert.equal(escaped.card.sourceStatus, "OPEN");
  assert.equal(escaped.card.holder, null);
  assert.equal(escaped.readout.identity.sessionStatus, "EXITED");
  assert.equal(escaped.readout.access.passState, null);

  const emergencyEntered = await body(await service.action({ action:"emergency_enter", workContext }));
  assert.equal(emergencyEntered.emergency, true);
  assert.equal(emergencyEntered.destinationOpened, false);
  assert.equal(emergencyEntered.authorityExpanded, false);
  assert.equal(emergencyEntered.card.sourceStatus, "ON PROCESS");
  assert.equal(emergencyEntered.card.holder, "GO");
  assert.equal(emergencyEntered.readout.identity.sessionStatus, "ENTERED");
  assert.equal(emergencyEntered.readout.access.passState, null);

  const escapedAgain = await body(await service.action({ action:"emergency_exit", workContext }));
  assert.equal(escapedAgain.card.sourceStatus, "OPEN");
  const continuedAgain = await body(await service.action({ action:"manual_continue", workContext }));
  assert.equal(continuedAgain.card.sourceStatus, "ON PROCESS");
  assert.equal(continuedAgain.readout.resume.mode, "GO_ACTIVE");
});

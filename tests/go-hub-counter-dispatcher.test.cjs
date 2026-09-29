"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-counter-dispatcher.mjs")).href;

function storage(initial = null) {
  const values = new Map();
  if (initial) values.set("dispatch", structuredClone(initial));
  return {
    alarms:[],
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async setAlarm(value) { this.alarms.push(value); },
  };
}
function openInput(overrides = {}) {
  return {
    counterId:"COUNTER-0099",
    workId:"WORK-GO-LIGHT",
    checkpointId:"CP-GO-LIGHT",
    request:"LIGHT, find the governed source",
    context:{ purpose:"dispatcher-smoke" },
    sourceHints:["Notion"],
    doNotChange:["Do not mutate Centre"],
    hubOrigin:"https://hub.example",
    ...overrides,
  };
}
function notionNamespace({ calls = [] } = {}) {
  const body = {
    ok:true,
    workspaceId:"workspace-1",
    tool:"notion-ai-search",
    status:"ANSWERED",
    answer:"1. Counter Contract — Projects / GO Hub",
    sources:["https://notion.so/page-1"],
    evidence:[{ kind:"notion_ai_search_result", rank:1, title:"Counter Contract", position:"Projects / GO Hub", source:"https://notion.so/page-1" }],
    confidence:"NOTION_AI_SEARCH",
    nextRoute:"GO",
    resultCount:1,
  };
  return {
    getByName() {
      return {
        async fetch(request) {
          const input = JSON.parse(await request.text());
          calls.push(input.action);
          if (input.action === "search") {
            return new Response(JSON.stringify(body), {
              status:200,
              headers:{ "content-type":"application/json" },
            });
          }
          return new Response(JSON.stringify({ ok:false, code:"UNEXPECTED_ACTION" }), { status:500 });
        },
      };
    },
  };
}

test("SEARCH waits for recipient pickup and never calls Notion-Light directly", async () => {
  const { GoHubCounterDispatchState } = await import(moduleUrl + "?search-pickup=" + Date.now());
  const calls = [];
  const stateStorage = storage();
  const dispatch = new GoHubCounterDispatchState(
    { storage:stateStorage },
    { GO_HUB_NOTION_LIGHT_STATE:notionNamespace({ calls }) },
  );
  const result = await dispatch.enqueueOpen(openInput({ mode:"SEARCH" }));
  assert.equal(result.dispatch.legs.LIGHT.status, "WAITING_PICKUP");
  assert.equal(result.dispatch.legs.LIGHT.attempts, 0);
  assert.equal(result.dispatch.legs.LIGHT.nextAttemptAt, null);
  assert.equal(result.transport, "COUNTER_INBOX");
  assert.equal(result.mode, "SEARCH");
  assert.equal(result.pickupRequired, true);
  assert.equal(stateStorage.alarms.length, 0);
  assert.deepEqual(calls, []);
});

test("HANDOFF waits for recipient pickup on the same canonical Counter route", async () => {
  const { GoHubCounterDispatchState } = await import(moduleUrl + "?handoff-pickup=" + Date.now());
  const calls = [];
  const dispatch = new GoHubCounterDispatchState(
    { storage:storage() },
    { GO_HUB_NOTION_LIGHT_STATE:notionNamespace({ calls }) },
  );
  const result = await dispatch.enqueueOpen(openInput({ mode:"HANDOFF", requestedResult:"Evidence-backed answer" }));
  assert.equal(result.dispatch.legs.LIGHT.status, "WAITING_PICKUP");
  assert.equal(result.transport, "COUNTER_INBOX");
  assert.equal(result.mode, "HANDOFF");
  assert.equal(result.pickupRequired, true);
  assert.deepEqual(calls, []);
});

test("legacy WAITING_TARGET timestamp is reconciled once", async () => {
  const { createCounterDispatchCore } = await import(moduleUrl + "?legacy-waiting=" + Date.now());
  const core = createCounterDispatchCore({ now:() => Date.parse("2026-09-19T16:55:00.000Z") });
  let state = core.enqueueOpen(openInput()).dispatch;
  state = core.waitingTarget({ target:"LIGHT" }, state).dispatch;
  state.legs.LIGHT.nextAttemptAt = "2026-09-19T16:50:28.457Z";
  const reconciled = core.waitingTarget({ target:"LIGHT" }, state);
  assert.equal(reconciled.dispatch.legs.LIGHT.nextAttemptAt, null);
  assert.equal(reconciled.dispatch.events.at(-1).type, "WAITING_TARGET_RECONCILED");
  const stable = core.waitingTarget({ target:"LIGHT" }, reconciled.dispatch);
  assert.equal(stable.idempotent, true);
});

test("legacy delivered Notion SEARCH can still recover its old result", async () => {
  const { createCounterDispatchCore, GoHubCounterDispatchState } = await import(moduleUrl + "?legacy-search-recovery=" + Date.now());
  const core = createCounterDispatchCore();
  const legacy = core.enqueueOpen(openInput({ mode:"SEARCH" })).dispatch;
  legacy.legs.LIGHT.status = "DELIVERED";
  legacy.legs.LIGHT.attempts = 1;
  legacy.legs.LIGHT.receipt = { tool:"notion-ai-search", receiptId:"notion-ai-search" };
  legacy.lightResult = null;

  const calls = [];
  const dispatch = new GoHubCounterDispatchState(
    { storage:storage(legacy) },
    { GO_HUB_NOTION_LIGHT_STATE:notionNamespace({ calls }) },
  );
  const result = await dispatch.enqueueOpen(openInput({ mode:"SEARCH" }));
  assert.equal(result.recovered, true);
  assert.equal(result.lightAnswer.status, "ANSWERED");
  assert.deepEqual(result.lightAnswer.sources, ["https://notion.so/page-1"]);
  assert.deepEqual(calls, ["search"]);
});

test("GO return leg remains compatible with its wake endpoint after canonical pickup", async () => {
  const originalFetch = globalThis.fetch;
  const outgoing = [];
  globalThis.fetch = async (url, init) => {
    outgoing.push({ url:String(url), body:JSON.parse(init.body) });
    return new Response(JSON.stringify({ receiptId:"go-1" }), {
      status:200,
      headers:{ "content-type":"application/json" },
    });
  };
  try {
    const { GoHubCounterDispatchState } = await import(moduleUrl + "?go-return=" + Date.now());
    const dispatch = new GoHubCounterDispatchState(
      { storage:storage() },
      { GO_WAKE_URL:"https://go.example/wake" },
    );
    const opened = await dispatch.enqueueOpen(openInput({ mode:"SEARCH" }));
    assert.equal(opened.dispatch.legs.LIGHT.status, "WAITING_PICKUP");
    const answered = await dispatch.enqueueAnswer({
      counterId:"COUNTER-0099",
      workId:"WORK-GO-LIGHT",
      checkpointId:"CP-GO-LIGHT",
      status:"ANSWERED",
      answer:"Found the page.",
      sources:["https://notion.so/page-1"],
      evidence:[{ kind:"notion_page", source:"https://notion.so/page-1" }],
      confidence:"VERIFIED",
      nextRoute:"GO",
    });
    assert.equal(answered.dispatch.legs.GO.status, "DELIVERED");
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].url, "https://go.example/wake");
    assert.equal(outgoing[0].body.target, "GO");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

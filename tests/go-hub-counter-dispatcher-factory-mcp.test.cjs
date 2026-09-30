"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, "..", "go-hub-factory-mcp-worker.mjs"),
).href;

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json" },
  });
}
function counterState(overrides = {}) {
  return {
    counterId:"COUNTER-FMCP-1",
    workId:"WORK-1",
    checkpointId:"CP-1",
    request:"Find in Notion AI Search",
    context:{ purpose:"factory-mcp" },
    sourceHints:["Notion AI Search"],
    doNotChange:["Do not use MIMIR"],
    currentState:"OPEN",
    answer:null,
    sources:[],
    evidence:[],
    confidence:null,
    nextRoute:null,
    ...overrides,
  };
}

test("Factory MCP counter create surfaces Notion OAuth URL while LIGHT waits for authorization", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?auth=" + Date.now());
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      create:async () => response({ ok:true, counter:counterState(), created:true }),
      get:async () => response({ ok:true, counter:counterState() }),
      seen:async () => response({ code:"unused" }, 500),
      answer:async () => response({ code:"unused" }, 500),
    },
    dispatch:{
      async open(input) {
        return response({
          ok:true,
          dispatch:{
            counterId:input.counterId,
            workId:input.workId,
            checkpointId:input.checkpointId,
            legs:{ LIGHT:{ status:"WAITING_AUTH" }, GO:{ status:"IDLE" } },
          },
          authRequired:true,
          authorizationUrl:"https://notion.example/oauth",
        });
      },
      async get() { return response({ code:"DISPATCH_NOT_FOUND" }, 404); },
      async answer() { return response({ code:"unused" }, 500); },
    },
  });
  const result = await lifecycle.create({});
  const payload = await result.json();
  assert.equal(result.status, 200);
  assert.equal(payload.counter.currentState, "OPEN");
  assert.equal(payload.dispatch.legs.LIGHT.status, "WAITING_AUTH");
  assert.equal(payload.lightAuthRequired, true);
  assert.equal(payload.lightAuthorizationUrl, "https://notion.example/oauth");
});

test("Factory MCP lifecycle prepares Notion OAuth when Dispatcher only reports WAITING_AUTH", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?auth-fallback=" + Date.now());
  const prepareCalls = [];
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      create:async () => response({ ok:true, counter:counterState(), created:true }),
      get:async () => response({ ok:true, counter:counterState() }),
      seen:async () => response({ code:"unused" }, 500),
      answer:async () => response({ code:"unused" }, 500),
    },
    dispatch:{
      async open(input) {
        return response({
          ok:true,
          dispatch:{
            counterId:input.counterId,
            workId:input.workId,
            checkpointId:input.checkpointId,
            legs:{ LIGHT:{ status:"WAITING_AUTH" }, GO:{ status:"IDLE" } },
          },
          authRequired:true,
          authorizationUrl:null,
        });
      },
      async get() { return response({ code:"DISPATCH_NOT_FOUND" }, 404); },
      async answer() { return response({ code:"unused" }, 500); },
    },
    notionLight:{
      async prepare(input) {
        prepareCalls.push(input);
        return response({ ok:true, authorizationUrl:"https://mcp.notion.com/authorize?state=fresh" });
      },
    },
    hubOrigin:"https://go-hub.example",
  });
  const result = await lifecycle.create({});
  const payload = await result.json();
  assert.equal(result.status, 200);
  assert.equal(payload.lightAuthRequired, true);
  assert.equal(payload.lightAuthorizationUrl, "https://mcp.notion.com/authorize?state=fresh");
  assert.deepEqual(prepareCalls, [{ hubOrigin:"https://go-hub.example" }]);
});

test("Factory MCP lifecycle surfaces Notion OAuth prepare failure instead of null-only auth", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?auth-fallback-error=" + Date.now());
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      create:async () => response({ ok:true, counter:counterState(), created:true }),
      get:async () => response({ ok:true, counter:counterState() }),
      seen:async () => response({ code:"unused" }, 500),
      answer:async () => response({ code:"unused" }, 500),
    },
    dispatch:{
      async open(input) {
        return response({
          ok:true,
          dispatch:{
            counterId:input.counterId,
            workId:input.workId,
            checkpointId:input.checkpointId,
            legs:{ LIGHT:{ status:"WAITING_AUTH" }, GO:{ status:"IDLE" } },
          },
          authRequired:true,
        });
      },
      async get() { return response({ code:"DISPATCH_NOT_FOUND" }, 404); },
      async answer() { return response({ code:"unused" }, 500); },
    },
    notionLight:{
      async prepare() {
        return response({ ok:false, code:"NOTION_MCP_CLIENT_REGISTRATION_FAILED" }, 502);
      },
    },
    hubOrigin:"https://go-hub.example",
  });
  const result = await lifecycle.create({});
  const payload = await result.json();
  assert.equal(result.status, 200);
  assert.equal(payload.lightAuthRequired, true);
  assert.equal(payload.lightAuthorizationUrl, null);
  assert.equal(payload.lightAuthPrepareCode, "NOTION_MCP_CLIENT_REGISTRATION_FAILED");
  assert.equal(payload.lightAuthPrepareStatus, 502);
});

test("Factory MCP writes SEEN and ANSWERED when Dispatcher returns Notion AI Search result", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?answer=" + Date.now());
  const calls = [];
  const open = counterState();
  const seen = counterState({ currentState:"SEEN" });
  const answered = counterState({
    currentState:"ANSWERED",
    answer:"1. Counter Contract — Projects / GO Hub",
    sources:["https://notion.so/page-1"],
    evidence:[{ kind:"notion_ai_search_result", source:"https://notion.so/page-1" }],
    confidence:"NOTION_AI_SEARCH",
    nextRoute:"GO",
  });
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      async create() { calls.push("create"); return response({ ok:true, counter:open, created:true }); },
      async get() { return response({ ok:true, counter:answered }); },
      async seen(input) {
        calls.push(["seen",input]);
        return response({ ok:true, counter:seen });
      },
      async answer(input) {
        calls.push(["answer",input]);
        return response({ ok:true, counter:answered });
      },
    },
    dispatch:{
      async open() {
        return response({
          ok:true,
          dispatch:{
            counterId:"COUNTER-FMCP-1",
            workId:"WORK-1",
            checkpointId:"CP-1",
            legs:{ LIGHT:{ status:"DELIVERED" }, GO:{ status:"IDLE" } },
          },
          lightAnswer:{
            status:"ANSWERED",
            answer:"1. Counter Contract — Projects / GO Hub",
            sources:["https://notion.so/page-1"],
            evidence:[{ kind:"notion_ai_search_result", source:"https://notion.so/page-1" }],
            confidence:"NOTION_AI_SEARCH",
            nextRoute:"GO",
          },
        });
      },
      async get() { return response({ code:"unused" }, 500); },
      async answer() { return response({ code:"unused" }, 500); },
    },
  });
  const result = await lifecycle.create({});
  const payload = await result.json();
  assert.equal(payload.counter.currentState, "ANSWERED");
  assert.equal(payload.lightResult.status, "ANSWERED");
  assert.equal(calls[0], "create");
  assert.equal(calls[1][0], "seen");
  assert.equal(calls[2][0], "answer");
  assert.equal(calls[2][1].answer, "1. Counter Contract — Projects / GO Hub");
});

test("Factory MCP counter get exposes Dispatcher state without mutating Counter", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?get=" + Date.now());
  let counterGets = 0;
  let dispatchGets = 0;
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      async create() { return response({ code:"unused" }, 500); },
      async get() {
        counterGets += 1;
        return response({ ok:true, counter:counterState() });
      },
      async seen() { return response({ code:"unused" }, 500); },
      async answer() { return response({ code:"unused" }, 500); },
    },
    dispatch:{
      async open() { return response({ code:"unused" }, 500); },
      async get(input) {
        dispatchGets += 1;
        return response({
          ok:true,
          dispatch:{
            counterId:input.counterId,
            workId:input.workId,
            checkpointId:input.checkpointId,
            legs:{ LIGHT:{ status:"WAITING_AUTH" }, GO:{ status:"IDLE" } },
          },
        });
      },
      async answer() { return response({ code:"unused" }, 500); },
    },
  });
  const result = await lifecycle.get({});
  const payload = await result.json();
  assert.equal(counterGets, 1);
  assert.equal(dispatchGets, 1);
  assert.equal(payload.dispatch.legs.LIGHT.status, "WAITING_AUTH");
});

test("Factory MCP SEARCH answer uses Counter inbox return transport", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?search-inbox=" + Date.now());
  const answered = counterState({
    mode:"SEARCH",
    currentState:"ANSWERED",
    answer:"Found it",
    sources:["https://notion.so/page-1"],
    evidence:[{ kind:"notion_page", source:"https://notion.so/page-1" }],
    confidence:"VERIFIED",
    nextRoute:"GO readback",
  });
  let returnInput = null;
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      async create() { return response({ code:"unused" }, 500); },
      async get() { return response({ code:"unused" }, 500); },
      async seen() { return response({ code:"unused" }, 500); },
      async answer() { return response({ ok:true, counter:answered }); },
    },
    dispatch:{
      async open() { return response({ code:"unused" }, 500); },
      async get() { return response({ code:"unused" }, 500); },
      async answer() { return response({ code:"unexpected-route" }, 500); },
      async returnInline(input) {
        returnInput = input;
        return response({
          ok:true,
          dispatch:{
            counterId:input.counterId,
            workId:input.workId,
            checkpointId:input.checkpointId,
            legs:{ LIGHT:{ status:"WAITING_PICKUP" }, GO:{ status:"DELIVERED", receipt:{ transport:input.transport } } },
          },
        });
      },
    },
  });
  const result = await lifecycle.answer({});
  const payload = await result.json();
  assert.equal(result.status, 200);
  assert.equal(returnInput.transport, "COUNTER_INBOX");
  assert.equal(returnInput.receiptId, "go-counter-inbox");
  assert.equal(payload.dispatch.legs.GO.status, "DELIVERED");
  assert.equal(payload.dispatch.legs.GO.receipt.transport, "COUNTER_INBOX");
});


test("Factory MCP HANDOFF answer uses Counter inbox return transport", async () => {
  const { createCounterDispatchLifecycle } = await import(moduleUrl + "?handoff-inbox=" + Date.now());
  const answered = counterState({
    mode:"HANDOFF",
    currentState:"ANSWERED",
    answer:"MIRROR_RING_OK",
    sources:["counter://COUNTER-FMCP-1"],
    evidence:[{ kind:"LIGHT_PICKUP" }],
    nextRoute:"GO readback",
  });
  let returnInput = null;
  const lifecycle = createCounterDispatchLifecycle({
    counter:{
      async create() { return response({ code:"unused" }, 500); },
      async get() { return response({ code:"unused" }, 500); },
      async seen() { return response({ code:"unused" }, 500); },
      async answer() { return response({ ok:true, counter:answered }); },
    },
    dispatch:{
      async open() { return response({ code:"unused" }, 500); },
      async get() { return response({ code:"unused" }, 500); },
      async answer() { return response({ code:"unexpected-route" }, 500); },
      async returnInline(input) {
        returnInput = input;
        return response({
          ok:true,
          dispatch:{
            counterId:input.counterId,
            workId:input.workId,
            checkpointId:input.checkpointId,
            legs:{ LIGHT:{ status:"WAITING_PICKUP" }, GO:{ status:"DELIVERED", receipt:{ transport:input.transport } } },
          },
        });
      },
    },
  });

  const result = await lifecycle.answer({});
  const payload = await result.json();
  assert.equal(result.status, 200);
  assert.equal(returnInput.transport, "COUNTER_INBOX");
  assert.equal(returnInput.receiptId, "go-counter-inbox");
  assert.equal(payload.dispatch.legs.GO.status, "DELIVERED");
  assert.equal(payload.dispatch.legs.GO.receipt.transport, "COUNTER_INBOX");
});

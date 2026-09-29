"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const counterUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-counter.mjs")).href;
const dispatcherUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-counter-dispatcher.mjs")).href;
const workerUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-factory-mcp-worker.mjs")).href;
const oauthUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-oauth.mjs")).href;

function namespace(factory) {
  const instances = new Map();
  return {
    getByName(name) {
      if (!instances.has(name)) instances.set(name, factory(name));
      const instance = instances.get(name);
      return { fetch: request => instance.fetch(request) };
    },
  };
}

function storage() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async setAlarm() {},
  };
}

const workContext = {
  workId:"WORK-GO-LIGHT-COUNTER-20260919-001",
  checkpointId:"CP-GO-LIGHT-COUNTER-001",
};

async function accessToken(subject, scope, resource) {
  const { createAccessToken } = await import(oauthUrl + "?token=" + subject + Date.now());
  return createAccessToken({
    issuer: "https://hub.example",
    signingKey: "master-secret",
    resource,
    subject,
    scope,
    ttlSeconds: 3600,
  });
}

async function callMcp(worker, env, token, pathname, name, args, id) {
  const headers = {
    authorization: "Bearer " + token,
    "content-type": "application/json",
  };
  if (pathname === "/mcp") headers.origin = "https://www.notion.so";
  const response = await worker.fetch(new Request("https://hub.example" + pathname, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.error, undefined, JSON.stringify(payload));
  return payload.result.structuredContent;
}

async function runtime() {
  const { GoHubCounterState, GoHubCounterInboxState } = await import(counterUrl + "?runtime=" + Date.now());
  const { GoHubCounterDispatchState } = await import(dispatcherUrl + "?runtime=" + Date.now());
  const { createFactoryMcpWorker } = await import(workerUrl + "?runtime=" + Date.now());

  const counterNamespace = namespace(() => new GoHubCounterState({ storage: storage() }, {}));
  const inboxNamespace = namespace(() => new GoHubCounterInboxState({ storage: storage() }, {}));
  const dispatchNamespace = namespace(() => new GoHubCounterDispatchState({ storage: storage() }, {}));
  const centreCalls = [];
  const auditCalls = [];
  const centreNamespace = namespace(() => ({
    async fetch(request) {
      const input = await request.json();
      centreCalls.push(input);
      if (input.action === "v4_inspect") return new Response(JSON.stringify({
        code:"unsupported Centre live action",
      }), { status:400, headers:{ "content-type":"application/json" } });
      if (input.action === "inspect") return new Response(JSON.stringify({
        ok: true,
        workId: workContext.workId,
        checkpointId: workContext.checkpointId,
        ownership: {
          enforced: true,
          active: true,
          ownerId:"GO",
          leaseId:"lease-live-22",
          revision:22,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    },
  }));
  const auditNamespace = namespace(() => ({
    async fetch(request) {
      const input = await request.json();
      auditCalls.push(input);
      return new Response(JSON.stringify({ ok: true, sequence: auditCalls.length }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  }));

  const worker = createFactoryMcpWorker({ fetchImpl: async () => new Response("unused", { status: 500 }) });
  const env = {
    GITHUB_TOKEN: "github-token",
    GOHUB_MASTER_KEY: "master-secret",
    GOHUB_OWNER_PASSCODE: "owner-passcode",
    GO_HUB_COUNTER_STATE: counterNamespace,
    GO_HUB_COUNTER_INBOX: inboxNamespace,
    GO_HUB_COUNTER_DISPATCH_STATE: dispatchNamespace,
    GO_HUB_CENTRE_STATE: centreNamespace,
    GO_HUB_GLOBAL_AUDIT: auditNamespace,
  };
  const goToken = await accessToken("big", "go-hub", "https://hub.example/mcp");
  const lightToken = await accessToken("light", "go-hub-light", "https://hub.example/mcp");
  return { worker, env, goToken, lightToken, centreCalls, auditCalls };
}

test("GO -> LIGHT HANDOFF uses recipient inbox and enforced LIGHT mutations", async () => {
  const { worker, env, goToken, lightToken, centreCalls, auditCalls } = await runtime();

  const created = await callMcp(worker, env, goToken, "/mcp", "go_hub_counter_create", {
    counterId: "COUNTER-BIDIR-GO-LIGHT-001",
    mode: "HANDOFF",
    request: "Inspect the governed source and report evidence.",
    requestedResult: "Evidence-backed answer.",
    authority: "BIG",
    target: "pureekangraw-ops/standard-",
    projectRef: "GO Hub",
    context: { direction: "GO_TO_LIGHT" },
    sourceHints: ["GitHub"],
    doNotChange: ["Do not merge or delete"],
    workContext,
  }, 1);
  assert.equal(created.counter.from, "GO");
  assert.equal(created.counter.to, "LIGHT");
  assert.equal(created.dispatch.fromActor, "GO");
  assert.equal(created.dispatch.toActor, "LIGHT");
  assert.equal(created.dispatch.legs.LIGHT.status, "WAITING_PICKUP");

  const inbox = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_inbox", {
    workContext, limit: 10,
  }, 2);
  assert.equal(inbox.inbox.count, 1);
  assert.equal(inbox.inbox.tickets[0].counterId, "COUNTER-BIDIR-GO-LIGHT-001");
  assert.equal(inbox.inbox.tickets[0].from, "GO");
  assert.equal(inbox.inbox.tickets[0].to, "LIGHT");

  assert.deepEqual(workContext, {
    workId:"WORK-GO-LIGHT-COUNTER-20260919-001",
    checkpointId:"CP-GO-LIGHT-COUNTER-001",
  });

  const pickedUp = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_pickup", {
    counterId: "COUNTER-BIDIR-GO-LIGHT-001", workContext,
  }, 5);
  assert.equal(pickedUp.counter.currentState, "SEEN");
  assert.equal(pickedUp.counter.events.at(-1).actor, "LIGHT");

  const legacySeen = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_seen", {
    counterId: "COUNTER-BIDIR-GO-LIGHT-001", workContext,
  }, 51);
  assert.equal(legacySeen.idempotent, true);
  assert.equal(legacySeen.counter.currentState, "SEEN");

  const answered = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_answer", {
    counterId: "COUNTER-BIDIR-GO-LIGHT-001",
    status: "ANSWERED",
    answer: "Source inspected.",
    sources: ["https://github.com/pureekangraw-ops/standard-"],
    evidence: [{ kind: "runtime-test", direction: "GO_TO_LIGHT" }],
    confidence: "verified",
    nextRoute: "GO",
    workContext,
  }, 6);
  assert.equal(answered.counter.currentState, "ANSWERED");
  assert.equal(answered.counter.events.at(-1).actor, "LIGHT");

  const empty = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_inbox", {
    workContext, limit: 10,
  }, 7);
  assert.equal(empty.inbox.count, 0);
  assert.ok(centreCalls.length >= 4);
  assert.ok(auditCalls.length >= 6);
});

test("LIGHT -> GO HANDOFF is explicit, HANDOFF-only, and supports GO answer plus LIGHT readback", async () => {
  const { worker, env, goToken, lightToken } = await runtime();

  const blockedSearch = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_create", {
    counterId: "COUNTER-BIDIR-LIGHT-SEARCH-BLOCKED",
    mode: "SEARCH",
    request: "Do not allow LIGHT to self-route Search.",
    workContext,
  }, 20);
  assert.equal(blockedSearch.code, "LIGHT_COUNTER_CREATE_HANDOFF_ONLY");

  const created = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_create", {
    counterId: "COUNTER-BIDIR-LIGHT-GO-001",
    mode: "HANDOFF",
    request: "GO, please review the monitor finding.",
    requestedResult: "GO decision with evidence.",
    authority: "LIGHT raises; GO decides.",
    target: "GO Hub",
    projectRef: "GO Hub",
    context: { direction: "LIGHT_TO_GO", finding: "monitor-drift" },
    sourceHints: ["Centre monitor"],
    doNotChange: ["Do not self-merge", "Do not mutate Centre"],
    workContext,
  }, 21);
  assert.equal(created.counter.from, "LIGHT");
  assert.equal(created.counter.to, "GO");
  assert.equal(created.dispatch.fromActor, "LIGHT");
  assert.equal(created.dispatch.toActor, "GO");
  assert.equal(created.dispatch.legs.GO.status, "WAITING_PICKUP");

  const goInbox = await callMcp(worker, env, goToken, "/mcp", "go_hub_counter_inbox", {
    workContext, limit: 10,
  }, 22);
  assert.equal(goInbox.inbox.count, 1);
  assert.equal(goInbox.inbox.tickets[0].counterId, "COUNTER-BIDIR-LIGHT-GO-001");
  assert.equal(goInbox.inbox.tickets[0].from, "LIGHT");
  assert.equal(goInbox.inbox.tickets[0].to, "GO");

  const pickedUp = await callMcp(worker, env, goToken, "/mcp", "go_hub_counter_pickup", {
    counterId: "COUNTER-BIDIR-LIGHT-GO-001", workContext,
  }, 23);
  assert.equal(pickedUp.counter.currentState, "SEEN");
  assert.equal(pickedUp.counter.events.at(-1).actor, "GO");

  const answered = await callMcp(worker, env, goToken, "/mcp", "go_hub_counter_answer", {
    counterId: "COUNTER-BIDIR-LIGHT-GO-001",
    status: "ANSWERED",
    answer: "Reviewed; keep the finding attached to this Work.",
    sources: ["centre://WORK-GO-LIGHT-COUNTER-20260919-001"],
    evidence: [{ kind: "go-review", direction: "LIGHT_TO_GO" }],
    confidence: "verified",
    nextRoute: "LIGHT",
    workContext,
  }, 24);
  assert.equal(answered.counter.currentState, "ANSWERED");
  assert.equal(answered.counter.events.at(-1).actor, "GO");

  const lightRead = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_get", {
    counterId: "COUNTER-BIDIR-LIGHT-GO-001", workContext,
  }, 25);
  assert.equal(lightRead.counter.answer, "Reviewed; keep the finding attached to this Work.");
  assert.equal(lightRead.counter.from, "LIGHT");
  assert.equal(lightRead.counter.to, "GO");

  const readback = await callMcp(worker, env, lightToken, "/mcp", "go_hub_counter_readback", {
    counterId: "COUNTER-BIDIR-LIGHT-GO-001",
    evidence: { kind: "light-readback", accepted: true },
    workContext,
  }, 26);
  assert.equal(readback.counter.currentState, "CLOSED");
  assert.equal(readback.counter.events.at(-2).type, "READBACK");
  assert.equal(readback.counter.events.at(-2).actor, "LIGHT");

  const goInboxAfter = await callMcp(worker, env, goToken, "/mcp", "go_hub_counter_inbox", {
    workContext, limit: 10,
  }, 27);
  assert.equal(goInboxAfter.inbox.count, 0);
});

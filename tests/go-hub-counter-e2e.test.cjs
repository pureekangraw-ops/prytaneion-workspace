"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workerUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-factory-mcp-worker.mjs")).href;
const oauthUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-oauth.mjs")).href;
const counterUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-counter.mjs")).href;
const dispatchUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-counter-dispatcher.mjs")).href;

const HUB_ORIGIN = "https://hub.example";
const SIGNING_KEY = "counter-e2e-secret";
const OWNER_PASSCODE = "counter-e2e-owner";
const BASE_ENV = {
  GITHUB_TOKEN: "test-github-token",
  GOHUB_MASTER_KEY: SIGNING_KEY,
  GOHUB_OWNER_PASSCODE: OWNER_PASSCODE,
};

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function makeStorage() {
  const values = new Map();
  return {
    async get(key) { return clone(values.get(key)); },
    async put(key, value) { values.set(key, clone(value)); },
    async setAlarm() {},
  };
}

function makeNamespace(StateClass, env = {}) {
  const states = new Map();
  return {
    getByName(name) {
      if (!states.has(name)) states.set(name, new StateClass({ storage: makeStorage() }, env));
      const state = states.get(name);
      return { fetch: request => state.fetch(request) };
    },
  };
}

async function makeEnv() {
  const [{ GoHubCounterState, GoHubCounterInboxState }, { GoHubCounterDispatchState }] = await Promise.all([
    import(counterUrl + "?e2e=" + Date.now()),
    import(dispatchUrl + "?e2e=" + Date.now()),
  ]);
  return {
    ...BASE_ENV,
    GO_HUB_COUNTER_STATE: makeNamespace(GoHubCounterState),
    GO_HUB_COUNTER_INBOX: makeNamespace(GoHubCounterInboxState),
    GO_HUB_COUNTER_DISPATCH_STATE: makeNamespace(GoHubCounterDispatchState),
  };
}

async function token(subject, scope, resource) {
  const { createAccessToken } = await import(oauthUrl + "?token=" + Date.now());
  return createAccessToken({
    issuer: HUB_ORIGIN,
    signingKey: SIGNING_KEY,
    subject,
    scope,
    resource,
    ttlSeconds: 3600,
  });
}

async function callTool(worker, env, pathname, accessToken, id, name, args) {
  const headers = {
    authorization: "Bearer " + accessToken,
    "content-type": "application/json",
  };
  if (pathname === "/mcp") headers.origin = "https://www.notion.so";
  const response = await worker.fetch(new Request(HUB_ORIGIN + pathname, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  }), env);
  assert.equal(response.status, 200);
  const envelope = await response.json();
  assert.equal(envelope.error, undefined, JSON.stringify(envelope));
  return JSON.parse(envelope.result.content[0].text);
}

function workContext(suffix) {
  return {
    workId:"WORK-COUNTER-E2E-" + suffix,
    checkpointId:"CP-COUNTER-E2E-" + suffix,
  };
}

test("public Counter create reaches WAITING_PICKUP inbox, then LIGHT answers with evidence", async () => {
  const [{ createFactoryMcpWorker }] = await Promise.all([
    import(workerUrl + "?handoff-e2e=" + Date.now()),
  ]);
  const worker = createFactoryMcpWorker();
  const env = await makeEnv();
  const publicToken = await token("big", "go-hub", HUB_ORIGIN + "/mcp");
  const lightToken = await token("light", "go-hub-light", HUB_ORIGIN + "/mcp");
  const context = workContext("HANDOFF");

  const created = await callTool(worker, env, "/mcp", publicToken, 1, "go_hub_counter_create", {
    counterId: "COUNTER-E2E-HANDOFF",
    mode: "HANDOFF",
    request: "Find the governed source",
    requestedResult: "Evidence-backed answer",
    authority: "BIG",
    target: "LIGHT",
    projectRef: "project://go-hub",
    context: { purpose: "runtime E2E" },
    sourceHints: ["Notion"],
    doNotChange: ["Do not mutate Centre or Project"],
    workContext: context,
  });
  assert.equal(created.counter.currentState, "OPEN");
  assert.equal(created.dispatch.legs.LIGHT.status, "WAITING_PICKUP");

  const inbox = await callTool(worker, env, "/mcp", lightToken, 2, "go_hub_counter_inbox", {
    limit: 10,
    workContext: context,
  });
  assert.equal(inbox.inbox.status, "WAITING_PICKUP");
  assert.equal(inbox.inbox.count, 1);
  assert.equal(inbox.inbox.tickets[0].counterId, "COUNTER-E2E-HANDOFF");

  const seen = await callTool(worker, env, "/mcp", lightToken, 3, "go_hub_counter_seen", {
    counterId: "COUNTER-E2E-HANDOFF",
    workContext: context,
  });
  assert.equal(seen.counter.currentState, "SEEN");

  const answered = await callTool(worker, env, "/mcp", lightToken, 4, "go_hub_counter_answer", {
    counterId: "COUNTER-E2E-HANDOFF",
    status: "ANSWERED",
    answer: "Found the governed source.",
    sources: ["notion://go-hub/source"],
    evidence: [{ kind: "notion-page", reference: "notion://go-hub/source" }],
    confidence: "verified",
    nextRoute: "GO",
    workContext: context,
  });
  assert.equal(answered.counter.currentState, "ANSWERED");
  assert.deepEqual(answered.counter.sources, ["notion://go-hub/source"]);
  assert.deepEqual(answered.counter.evidence, [{ kind: "notion-page", reference: "notion://go-hub/source" }]);

  const finalInbox = await callTool(worker, env, "/mcp", lightToken, 5, "go_hub_counter_inbox", {
    limit: 10,
    workContext: context,
  });
  assert.equal(finalInbox.inbox.count, 0, "answered handoff leaves the pending inbox");
});

test("SEARCH Counter stores only the two-key public work identity", async () => {
  const [{ createFactoryMcpWorker }] = await Promise.all([
    import(workerUrl + "?search-e2e=" + Date.now()),
  ]);
  const worker = createFactoryMcpWorker();
  const env = await makeEnv();
  const publicToken = await token("big", "go-hub", HUB_ORIGIN + "/mcp");
  const lightToken = await token("light", "go-hub-light", HUB_ORIGIN + "/mcp");
  const context = workContext("SEARCH");

  const created = await callTool(worker, env, "/mcp", publicToken, 10, "go_hub_counter_create", {
    counterId: "COUNTER-E2E-SEARCH",
    mode: "SEARCH",
    request: "Read the current Counter state",
    context: { purpose: "backward compatibility" },
    workContext: context,
  });
  assert.equal(created.counter.currentState, "OPEN");

  const read = await callTool(worker, env, "/mcp", lightToken, 11, "go_hub_counter_get", {
    counterId: "COUNTER-E2E-SEARCH",
    workContext: context,
  });
  assert.equal(read.counter.currentState, "OPEN");
  assert.deepEqual(read.counter.workContext, {
    workId:context.workId,
    checkpointId:context.checkpointId,
  });
});

test("governed mutations resolve active Centre ownership internally", async () => {
  const [{ createGovernedMutationRunner }] = await Promise.all([
    import(workerUrl + "?ownership=" + Date.now()),
  ]);
  const context = workContext("OWNERSHIP");
  let enforced = false;
  let active = true;
  let executed = 0;
  let resolved = null;
  const runner = createGovernedMutationRunner({
    centreLive: {
      async action() {
        return new Response(JSON.stringify({
          ok:true,
          workId:context.workId,
          checkpointId:context.checkpointId,
          returnAddress:context.checkpointId,
          work:{ workId:context.workId, checkpointId:context.checkpointId, task:"Counter E2E", requestedResult:"Verified" },
          ownership:enforced
            ? { enforced:true, active, ownerId:"owner-1", leaseId:"lease-1", revision:4 }
            : { enforced:false },
        }));
      },
    },
    globalAudit: { async append() { return new Response(JSON.stringify({ ok:true })); } },
  });

  const run = () => runner("counter.test", { workContext:{ ...context } }, async input => {
    executed += 1;
    resolved = input.workContext;
    return new Response(JSON.stringify({ ok:true }));
  });

  const unenforced = await run();
  assert.equal(unenforced.status, 200);
  assert.equal(executed, 1);
  assert.equal(resolved.ownerId, undefined);

  enforced = true;
  const governed = await run();
  assert.equal(governed.status, 200);
  assert.equal(executed, 2);
  assert.equal(resolved.ownerId, "owner-1");
  assert.equal(resolved.leaseId, "lease-1");
  assert.equal(resolved.ownershipRevision, 4);

  active = false;
  const blocked = await run();
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), { code:"CENTRE_WORK_LEASE_INACTIVE" });
  assert.equal(executed, 2);
});

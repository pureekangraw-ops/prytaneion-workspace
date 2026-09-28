"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const serviceUrl = pathToFileURL(path.join(root, "go-hub-factory-service.mjs")).href;
const workspaceUrl = pathToFileURL(path.join(root, "go-hub-github-workspace.js")).href;
const registryUrl = pathToFileURL(path.join(root, "go-hub-mcp-registry.mjs")).href;
const repository = "pureekangraw-ops/standard-";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("Factory action service binds one owner-scoped task to one Durable Object stub", async () => {
  const { createFactoryActionService } = await import(serviceUrl + "?factory-service=" + Date.now());
  const names = [];
  let stored = null;
  const binding = {
    getByName(name) {
      names.push(name);
      return {
        async load() { return stored; },
        async save(input) {
          stored = { revision: 1, task: structuredClone(input.task), receipts: [input.receipt], audit: [input.auditEvent] };
          return { revision: 1, task: structuredClone(input.task), receipt: structuredClone(input.receipt) };
        },
      };
    },
  };
  const lifecycle = {
    inspect: async () => jsonResponse({ repository, defaultBranch: "main", branch: "main", baseSha: "base-1", headSha: "base-1", tree: [] }),
  };
  const service = createFactoryActionService({ lifecycle, binding, now: () => "now", createId: () => "r-1" });
  const response = await service({
    taskId: "pureekangraw-ops:bridge-1",
    action: "inspect",
    input: { repository, intent: "bridge", branch: "main" },
    expectedRevision: 0,
    workContext: { workId: "WORK-84", checkpointId: "CENTRE-84", returnAddress: "CENTRE-84", destination: "destination://factory", task: "govern Factory action", requestedResult: "durable task authority", lensReference: "factory://unified" },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.revision, 1);
  assert.equal(payload.receipt.action, "inspect");
  assert.deepEqual(names, ["pureekangraw-ops:bridge-1"]);

  await assert.rejects(service({
    taskId: "other-owner:bridge-1",
    action: "inspect",
    input: { repository, intent: "bridge" },
    expectedRevision: 0,
  }), /invalid Factory task ID/);
});

test("Factory action service prefers Durable Object fetch transport over RPC-shaped methods", async () => {
  const { createFactoryActionService } = await import(serviceUrl + "?factory-fetch=" + Date.now());
  const calls = [];
  let stored = null;
  const binding = {
    getByName() {
      return {
        async fetch(request) {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.pathname}`);
          if (request.method === "GET" && url.pathname === "/load") {
            return jsonResponse(stored);
          }
          if (request.method === "POST" && url.pathname === "/save") {
            const input = await request.json();
            stored = {
              revision: 1,
              task: structuredClone(input.task),
              receipts: [structuredClone(input.receipt)],
              audit: [structuredClone(input.auditEvent)],
            };
            return jsonResponse({
              revision: stored.revision,
              task: structuredClone(stored.task),
              receipt: structuredClone(input.receipt),
            });
          }
          return jsonResponse({ code: "NOT_FOUND" }, 404);
        },
        async load() { throw new Error("RPC load must not be used"); },
        async save() { throw new Error("RPC save must not be used"); },
      };
    },
  };
  const lifecycle = {
    inspect: async () => jsonResponse({ repository, defaultBranch: "main", branch: "main", baseSha: "base-1", headSha: "base-1", tree: [] }),
  };
  const service = createFactoryActionService({ lifecycle, binding, now: () => "now", createId: () => "r-fetch" });
  const response = await service({
    taskId: "pureekangraw-ops:fetch-transport",
    action: "inspect",
    input: { repository, intent: "fetch transport", branch: "main" },
    expectedRevision: 0,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["GET /load", "POST /save"]);
});

test("MCP registry publishes durable Factory V4 and quarantines legacy Factory mutation tools", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?factory-tool=" + Date.now());
  const calls = [];
  const lifecycle = new Proxy({}, {
    get: (_, name) => async input => {
      calls.push({ name, input });
      return jsonResponse({ ok: true });
    },
  });
  const registry = createMcpRegistry({ lifecycle });
  const tools = registry.listTools();
  const tool = tools.find(item => item.name === "go_hub_factory_v4");
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.deepEqual(tool.inputSchema.properties.action.enum, [
    "start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish",
  ]);
  for (const legacy of ["go_hub_factory_action", "go_hub_factory_auto", "go_hub_factory_ready_gate", "go_hub_factory_foreman"]) {
    assert.equal(tools.some(item => item.name === legacy), false);
  }
  await registry.callTool("go_hub_factory_v4", {
    action:"inspect",
    workContext:{ workId:"WORK-84", checkpointId:"CENTRE-84" },
  });
  assert.equal(calls.at(-1).name, "factoryV4");
});

test("browser workspace calls Factory action through same-origin gateway without Authorization", async () => {
  const { createGitHubWorkspace } = await import(workspaceUrl + "?factory-action=" + Date.now());
  const calls = [];
  const workspace = createGitHubWorkspace({
    gatewayBase: "/hub/api/github-workspace",
    repository,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ status: "OK", revision: 1 });
    },
  });
  const result = await workspace.factoryAction({
    taskId: "pureekangraw-ops:bridge-1",
    action: "inspect",
    input: { repository, intent: "bridge" },
    expectedRevision: 0,
    workContext: { workId: "WORK-84", checkpointId: "CENTRE-84", returnAddress: "CENTRE-84", destination: "destination://factory", task: "govern Factory action", requestedResult: "durable task authority", lensReference: "factory://unified" },
  });
  assert.equal(result.revision, 1);
  assert.equal(calls[0].url, "/hub/api/github-workspace/factory-action");
  assert.equal(calls[0].init.method, "POST");
  assert.equal("authorization" in Object.fromEntries(Object.entries(calls[0].init.headers || {}).map(([k,v]) => [k.toLowerCase(),v])), false);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    taskId: "pureekangraw-ops:bridge-1",
    action: "inspect",
    input: { repository, intent: "bridge" },
    expectedRevision: 0,
    workContext: { workId: "WORK-84", checkpointId: "CENTRE-84", returnAddress: "CENTRE-84", destination: "destination://factory", task: "govern Factory action", requestedResult: "durable task authority", lensReference: "factory://unified" },
  });
});

test("current edge quarantines legacy Factory route while V4 keeps the existing durable binding", () => {
  const fs = require("node:fs");
  const edge = fs.readFileSync(path.join(root, "go-hub-edge-worker.mjs"), "utf8");
  const worker = fs.readFileSync(path.join(root, "go-hub-factory-mcp-worker.mjs"), "utf8");
  const service = fs.readFileSync(path.join(root, "go-hub-factory-service.mjs"), "utf8");
  const wrangler = fs.readFileSync(path.join(root, "wrangler.go-hub.jsonc"), "utf8");
  assert.match(edge, /FACTORY_ACTION_PATH = "\/hub\/api\/github-workspace\/factory-action"/);
  assert.match(edge, /FACTORY_LEGACY_ROUTE_QUARANTINED/);
  assert.match(edge, /nextTool:"go_hub_factory_v4"/);
  assert.match(worker, /createFactoryV4Service/);
  assert.match(service, /export function createFactoryV4Service/);
  assert.match(wrangler, /"name": "GO_HUB_FACTORY_STATE"/);
  assert.match(wrangler, /"class_name": "GoHubFactoryState"/);
  assert.match(wrangler, /"tag": "v2-factory-task-state"/);
});

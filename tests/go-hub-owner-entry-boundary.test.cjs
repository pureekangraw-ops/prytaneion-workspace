"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const workerUrl = pathToFileURL(path.join(root, "go-hub-edge-worker.mjs")).href;

function browserResponse() {
  return new Response(JSON.stringify({ success: true, result: { markdown: "# secret browser state" } }), {
    headers: { "content-type": "application/json" },
  });
}

async function loadWorker(tag) {
  return import(`${workerUrl}?owner-entry-boundary=${tag}-${Date.now()}-${Math.random()}`);
}

function request({ method = "POST", pathname = "/hub/api/browser/read", passcode, body = { url: "https://shop.example.com/product/new" } } = {}) {
  const headers = { "content-type": "application/json" };
  if (passcode !== undefined) headers["x-go-owner-passcode"] = passcode;
  return new Request(`https://hub.example${pathname}`, {
    method,
    headers,
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function protectedEnv(browser, ownerPasscode = "owner-secret") {
  return {
    BROWSER: browser,
    BROWSER_POLICY: {
      allowedHostnames: ["shop.example.com"],
      requireOwnerPasscode: true,
    },
    ...(ownerPasscode === null ? {} : { GOHUB_OWNER_PASSCODE: ownerPasscode }),
  };
}

test("owner auth runs before body parsing and browser execution", async () => {
  let calls = 0;
  const browser = { async quickAction() { calls += 1; return browserResponse(); } };
  const { createEdgeWorkerHandler } = await loadWorker("auth-before-body");
  const response = await createEdgeWorkerHandler().fetch(
    request({ passcode: "wrong-secret", body: "not-json" }),
    protectedEnv(browser),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: "BROWSER_OWNER_AUTH_FAILED" });
  assert.equal(calls, 0);
});

test("unconfigured owner auth fails closed without leaking browser or work state", async () => {
  let calls = 0;
  const browser = { async quickAction() { calls += 1; return browserResponse(); } };
  const { createEdgeWorkerHandler } = await loadWorker("auth-not-configured");
  const response = await createEdgeWorkerHandler().fetch(
    request({ passcode: "owner-secret" }),
    protectedEnv(browser, null),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "BROWSER_OWNER_AUTH_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("alternate browser paths cannot bypass the canonical entry route", async () => {
  let calls = 0;
  const browser = { async quickAction() { calls += 1; return browserResponse(); } };
  const { createEdgeWorkerHandler } = await loadWorker("alternate-path");
  const handler = createEdgeWorkerHandler();

  const responses = await Promise.all([
    handler.fetch(request({ method: "GET", pathname: "/hub/api/browser/read", passcode: "owner-secret" }), protectedEnv(browser)),
    handler.fetch(request({ pathname: "/hub/api/browser/read/alternate", passcode: "owner-secret" }), protectedEnv(browser)),
    handler.fetch(request({ pathname: "/hub/api/browser", passcode: "owner-secret" }), protectedEnv(browser)),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { code: "NOT_FOUND" });
  }
  assert.equal(calls, 0);
});

test("legacy factory action route is quarantined instead of becoming a bypass", async () => {
  const { createEdgeWorkerHandler } = await loadWorker("legacy-factory-route");
  const response = await createEdgeWorkerHandler().fetch(
    request({ pathname: "/hub/api/github-workspace/factory-action", passcode: "owner-secret" }),
    protectedEnv({ async quickAction() { throw new Error("must not run"); } }),
  );

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    code: "FACTORY_LEGACY_ROUTE_QUARANTINED",
    compatibility: "SOURCE_ONLY",
    nextTool: "go_hub_factory_v4",
  });
});

test("invalid JSON cannot bypass owner auth through the canonical route", async () => {
  const { createEdgeWorkerHandler } = await loadWorker("invalid-json");
  const response = await createEdgeWorkerHandler().fetch(
    request({ passcode: "wrong-secret", body: "{" }),
    protectedEnv({ async quickAction() { throw new Error("must not run"); } }),
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: "BROWSER_OWNER_AUTH_FAILED" });
});

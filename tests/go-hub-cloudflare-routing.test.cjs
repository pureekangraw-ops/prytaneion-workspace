"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function loadWranglerConfig() {
  const filePath = path.resolve(__dirname, "../wrangler.go-hub.jsonc");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("GO Hub API routes run the edge Worker before SPA asset fallback", () => {
  const config = loadWranglerConfig();
  assert.equal(config.main, "go-hub-edge-worker.mjs");
  assert.deepEqual(config.browser, { binding: "BROWSER" });
  assert.deepEqual(config.vars?.BROWSER_POLICY, {
    allowedHostnames: ["gumroad.com", "*.gumroad.com"],
    requireOwnerPasscode: true,
  });
  assert.deepEqual(config.assets?.run_worker_first, [
    "/",
    "/office",
    "/office/*",
    "/hub/api/centre/*",
    "/hub/api/counter/*",
    "/hub/api/lighthouse-control-port/*",
    "/hub/lighthouse",
    "/hub/prism/pairing",
    "/hub/api/browser/*",
    "/hub/api/factory-eye/*",
    "/hub/api/github-workspace/*",
    "/hub/api/notion-light/*",
    "/hub/observer",
    "/hub/light-mcp",
    "/mcp",
    "/mcp/*",
    "/oauth/*",
    "/.well-known/*",
    "/internal/*"
  ]);
});

test("Counter Ask is direct read-only Notion search while HANDOFF keeps Centre identity", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../go-hub-edge-worker.mjs"), "utf8");
  assert.match(source, /COUNTER_API_ROOT = "\/hub\/api\/counter"/);

  const askStart = source.indexOf('url.pathname === `${COUNTER_API_ROOT}/ask`');
  const inboxStart = source.indexOf('url.pathname === `${COUNTER_API_ROOT}/inbox`', askStart);
  const handoffStart = source.indexOf('url.pathname === `${COUNTER_API_ROOT}/handoff`');
  assert.ok(askStart >= 0 && inboxStart > askStart && handoffStart > inboxStart);

  const ask = source.slice(askStart, inboxStart);
  const handoff = source.slice(handoffStart, source.indexOf('if (request.method === "GET" && url.pathname === "/hub/observer")', handoffStart));

  assert.match(ask, /createNotionLightService/);
  assert.match(ask, /\.search\(\{ query:question \}\)/);
  assert.doesNotMatch(ask, /v4_inspect|createCounterDispatchLifecycle|workId|checkpointId/);

  assert.match(handoff, /action:"v4_inspect", workId/);
  assert.match(handoff, /createCounterDispatchLifecycle/);
  assert.match(handoff, /mode:"HANDOFF"/);
  assert.doesNotMatch(source, /COUNTER_API_ROOT}\/mirror|bellType:"MIRROR_REFRESH"/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const workerUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-edge-worker.mjs")).href;

test("Edge intercepts /office before delegate and fails closed without Office session", async () => {
  let delegated = 0;
  const delegate = { async fetch() { delegated += 1; return new Response("delegate"); } };
  const factoryMcp = { async fetch() { return new Response("mcp"); } };
  const { createEdgeWorkerHandler } = await import(workerUrl + "?office-boundary=" + Date.now());
  const handler = createEdgeWorkerHandler({ delegate, factoryMcp });
  const response = await handler.fetch(
    new Request("https://office.example/office/api/work"),
    {
      GOHUB_OFFICE_PASSCODE:"office-secret",
      GOHUB_OFFICE_SESSION_KEY:"0123456789abcdef0123456789abcdef",
      GOHUB_OFFICE_SESSION_EPOCH:"1",
    },
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code:"OFFICE_AUTH_REQUIRED" });
  assert.equal(delegated, 0);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("Unknown /office route is denied before delegate", async () => {
  let delegated = 0;
  const delegate = { async fetch() { delegated += 1; return new Response("delegate"); } };
  const factoryMcp = { async fetch() { return new Response("mcp"); } };
  const { createEdgeWorkerHandler } = await import(workerUrl + "?office-deny=" + Date.now());
  const handler = createEdgeWorkerHandler({ delegate, factoryMcp });
  const response = await handler.fetch(
    new Request("https://office.example/office/internal/debug"),
    {
      GOHUB_OFFICE_PASSCODE:"office-secret",
      GOHUB_OFFICE_SESSION_KEY:"0123456789abcdef0123456789abcdef",
    },
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code:"OFFICE_ROUTE_DENIED" });
  assert.equal(delegated, 0);
});


test("office.yggmetro.com root enters Office Gate instead of delegating GO Hub index", async () => {
  let delegated = 0;
  const delegate = { async fetch() { delegated += 1; return new Response("delegate"); } };
  const factoryMcp = { async fetch() { return new Response("mcp"); } };
  const { createEdgeWorkerHandler } = await import(workerUrl + "?office-host-root=" + Date.now());
  const handler = createEdgeWorkerHandler({ delegate, factoryMcp });
  const response = await handler.fetch(
    new Request("https://office.yggmetro.com/"),
    {
      GOHUB_OFFICE_PASSCODE:"office-secret",
      GOHUB_OFFICE_SESSION_KEY:"0123456789abcdef0123456789abcdef",
      GOHUB_OFFICE_SESSION_EPOCH:"1",
    },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /YGG METRO/);
  assert.equal(delegated, 0);
});


test("non-Office root still serves the existing asset surface when root is worker-first", async () => {
  let delegated = 0;
  let assets = 0;
  const delegate = { async fetch() { delegated += 1; return new Response("delegate"); } };
  const factoryMcp = { async fetch() { return new Response("mcp"); } };
  const { createEdgeWorkerHandler } = await import(workerUrl + "?non-office-root=" + Date.now());
  const handler = createEdgeWorkerHandler({ delegate, factoryMcp });
  const response = await handler.fetch(
    new Request("https://go-hub.example/"),
    {
      ASSETS:{ async fetch() { assets += 1; return new Response("GO Hub asset"); } },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "GO Hub asset");
  assert.equal(assets, 1);
  assert.equal(delegated, 0);
});


test("Office static assets bypass the app delegate and read the deployed Assets binding", async () => {
  let delegated = 0;
  let assets = 0;
  const delegate = { async fetch() { delegated += 1; return new Response("<!doctype html><html>fallback</html>", { headers:{ "content-type":"text/html" } }); } };
  const factoryMcp = { async fetch() { return new Response("mcp"); } };
  const { createEdgeWorkerHandler } = await import(workerUrl + "?office-static-assets=" + Date.now());
  const handler = createEdgeWorkerHandler({ delegate, factoryMcp });

  for (const pathName of [
    "/go-hub-office-surface.css",
    "/go-hub-office-surface.js",
    "/go-hub-office-login.js",
  ]) {
    const response = await handler.fetch(
      new Request("https://go-hub.example" + pathName),
      {
        ASSETS:{ async fetch(request) {
          assets += 1;
          const path = new URL(request.url).pathname;
          const type = path.endsWith(".css") ? "text/css" : "application/javascript";
          return new Response("/* office asset */", { headers:{ "content-type":type } });
        } },
      },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), pathName.endsWith(".css") ? /text\/css/ : /javascript/);
  }

  assert.equal(assets, 3);
  assert.equal(delegated, 0);
});

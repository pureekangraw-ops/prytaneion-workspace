"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const serviceUrl = pathToFileURL(path.join(root, "go-hub-cloudflare-service.mjs")).href;
const registryUrl = pathToFileURL(path.join(root, "go-hub-mcp-registry.mjs")).href;
const workerUrl = pathToFileURL(path.join(root, "go-hub-factory-mcp-worker.mjs")).href;
const oauthUrl = pathToFileURL(path.join(root, "go-hub-oauth.mjs")).href;
const endpoint = "https://hub.example/mcp";

function rpc(token, name, args = {}) {
  return new Request(endpoint, {
    method:"POST",
    headers:{
      authorization:"Bearer " + token,
      "content-type":"application/json",
      accept:"application/json, text/event-stream",
    },
    body:JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name, arguments:args } }),
  });
}

test("Cloudflare service fails closed without runtime credentials", async () => {
  const { createCloudflareService } = await import(serviceUrl + "?missing=" + Date.now());
  let calls = 0;
  const service = createCloudflareService({ fetchImpl: async () => { calls += 1; } });
  const response = await service.health();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code:"CLOUDFLARE_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("Cloudflare worker inspection returns names and types but never secret values", async () => {
  const { createCloudflareService } = await import(serviceUrl + "?sanitize=" + Date.now());
  const secret = "do-not-return-this";
  const fetchImpl = async url => {
    const current = String(url);
    if (current.endsWith("/settings")) {
      return new Response(JSON.stringify({ success:true, result:{
        bindings:[
          { name:"SECRET_ONE", type:"secret_text", text:secret },
          { name:"PLAIN_ONE", type:"plain_text", text:"visible-but-not-needed" },
        ],
        compatibility_date:"2026-09-14",
      }}), { headers:{ "content-type":"application/json" } });
    }
    if (current.endsWith("/deployments")) {
      return new Response(JSON.stringify({ success:true, result:{ deployments:[
        { id:"dep-1", created_on:"2026-09-25T00:00:00Z", source:"api" },
      ]}}), { headers:{ "content-type":"application/json" } });
    }
    throw new Error("unexpected upstream " + current);
  };
  const service = createCloudflareService({ fetchImpl, token:"runtime-token", accountId:"account-a" });
  const response = await service.inspectWorker({ scriptName:"go-hub" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.worker.bindings, [
    { name:"SECRET_ONE", type:"secret_text" },
    { name:"PLAIN_ONE", type:"plain_text" },
  ]);
  assert.equal(body.secretValuesExposed, false);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(body), /visible-but-not-needed/);
});

test("registry publishes four Cloudflare read-only tools", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?registry=" + Date.now());
  const lifecycle = new Proxy({}, {
    get: (_, name) => async input => new Response(JSON.stringify({ operation:name, input }), {
      headers:{ "content-type":"application/json" },
    }),
  });
  const registry = createMcpRegistry({ lifecycle });
  const tools = registry.listTools().filter(tool => tool.name.startsWith("go_hub_cloudflare_"));
  assert.deepEqual(tools.map(tool => tool.name), [
    "go_hub_cloudflare_capabilities",
    "go_hub_cloudflare_health",
    "go_hub_cloudflare_list_workers",
    "go_hub_cloudflare_inspect_worker",
  ]);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === true));
});

test("Factory MCP Cloudflare health uses runtime token server-side", async () => {
  const { createFactoryMcpWorker } = await import(workerUrl + "?worker=" + Date.now());
  const { createTestAccessToken } = await import(oauthUrl + "?token=" + Date.now());
  const signingKey = "test-signing-key-with-enough-entropy";
  const accessToken = await createTestAccessToken({ issuer:"https://hub.example", signingKey });
  let auth = null;
  const fetchImpl = async (url, init = {}) => {
    if (!String(url).endsWith("/accounts/account-a/workers/scripts")) throw new Error("unexpected upstream");
    auth = init.headers.authorization;
    return new Response(JSON.stringify({ success:true, result:[{ id:"go-hub" }] }), {
      headers:{ "content-type":"application/json" },
    });
  };
  const worker = createFactoryMcpWorker({ fetchImpl });
  const response = await worker.fetch(rpc(accessToken, "go_hub_cloudflare_health"), {
    GITHUB_TOKEN:"github-token",
    GOHUB_MASTER_KEY:signingKey,
    GOHUB_OWNER_PASSCODE:"owner-passcode",
    CLOUDFLARE_RUNTIME_API_TOKEN:"runtime-secret",
    CLOUDFLARE_ACCOUNT_ID:"account-a",
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.structuredContent.upstream, "PASS");
  assert.equal(payload.result.structuredContent.workerCount, 1);
  assert.equal(auth, "Bearer runtime-secret");
  assert.doesNotMatch(JSON.stringify(payload), /runtime-secret/);
});

test("Cloudflare inspection preserves bounded deployment version identity without inventing source SHA", async () => {
  const { createCloudflareService } = await import(serviceUrl + "?versions=" + Date.now());
  const fetchImpl = async url => {
    const current = String(url);
    if (current.endsWith("/settings")) return new Response(JSON.stringify({ success:true, result:{ bindings:[] } }));
    if (current.endsWith("/deployments")) return new Response(JSON.stringify({ success:true, result:{ deployments:[
      { id:"dep-1", created_on:"2026-09-28T00:00:00Z", versions:[
        { version_id:"version-a", percentage:75, secret:"must-not-leak" },
        { version_id:"version-b", percentage:25 },
      ] },
    ] } }));
    throw new Error("unexpected upstream");
  };
  const body = await (await createCloudflareService({ fetchImpl, token:"runtime-token", accountId:"account-a" }).inspectWorker({ scriptName:"go-hub" })).json();
  assert.deepEqual(body.deployments[0].versions, [
    { versionId:"version-a", percentage:75 },
    { versionId:"version-b", percentage:25 },
  ]);
  assert.equal(body.deployments[0].sourceSha, undefined);
  assert.doesNotMatch(JSON.stringify(body), /must-not-leak/);
});

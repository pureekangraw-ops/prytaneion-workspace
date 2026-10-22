import test from "node:test";
import assert from "node:assert/strict";
import worker, { exploreLegacy, probePantheon, probeGoogleDrive } from "./worker.mjs";

const call = (path, opts = {}, env = {}) => worker.fetch(new Request("https://explorer.invalid" + path, opts), env);
test("original GO Hub route and authority modules are executed", () => {
  const r = exploreLegacy();
  assert.equal(r.sample.githubDestination, "github");
  assert.equal(r.sample.workIdentityOwner, "centre");
  assert.ok(r.destinations.some(d => d.id === "maintenance"));
  assert.equal(r.taskExecutionEnabled, false);
  assert.equal(r.legacyRuntimeFullyRestored, false);
});
test("live PANTHEON owner RPC operation is fixed to read-only factory_health", async () => {
  let args;
  const r = await probePantheon({ PANTHEON_OWNER: { ownerCall: async x => {
    args = x;
    return { ok: true, upstream_status: 200, result: { factory: { connection: "CONNECTED" } } };
  } } });
  assert.deepEqual(args, { operation: "factory_health" });
  assert.equal(r.status, "CONNECTED");
  assert.equal(JSON.stringify(r).includes("secret"), false);
});
test("unconfigured binding fails closed", async () => {
  assert.equal((await probePantheon({})).status, "NOT_CONNECTED");
});
test("all mutation attempts are blocked", async () => {
  for (const path of ["/", "/api/explore", "/api/bridge-health", "/mcp"]) {
    const r = await call(path, { method: "POST", body: "anything" });
    assert.equal(r.status, 405);
  }
});
test("maintenance entrance works without calling protected RPC", async () => {
  let calls = 0;
  const env = { PANTHEON_OWNER: { ownerCall: async () => { calls++; throw new Error(); } } };
  const root = await call("/", {}, env);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /UNDER MAINTENANCE/);
  const routes = await call("/api/explore", {}, env);
  assert.equal((await routes.json()).mode, "READ_ONLY_EXPLORATION");
  assert.equal(calls, 0);
  const absent = await call("/random");
  assert.equal(absent.status, 404);
});

test("PANTHEON LIGHT service binding can power Google root read without exposing files", async () => {
  let args;
  const r = await probeGoogleDrive({ PANTHEON_LIGHT: { lightCall: async x => {
    args = x;
    return {ok:true,result:{source:"google_drive",read_only:true,roots:[{id:"private",name:"Do not reveal"}]}};
  }}});
  assert.deepEqual(args, {operation:"pantheon.drive.read",name:"light_drive_roots",args:{}});
  assert.equal(r.status,"CONNECTED");
  assert.equal(JSON.stringify(r).includes("Do not reveal"),false);
});
test("original repository read API only accepts allowlisted public source", async () => {
  let called=0;
  const src="export const testing = true;";
  const fixture={type:"file",encoding:"base64",content:btoa(src),sha:"a".repeat(40)};
  const { githubLegacyRoute } = await import("./read-service.mjs");
  const ok=await githubLegacyRoute(new URL("https://hub.invalid/hub/api/github-workspace/file?repository=pureekangraw-ops%2Fprytaneion-workspace&path=go-hub-authority-map.js"), async () => {
    called++;
    return new Response(JSON.stringify(fixture),{status:200,headers:{"content-type":"application/json"}});
  });
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).content,src);
  const forbidden=await githubLegacyRoute(new URL("https://hub.invalid/hub/api/github-workspace/file?repository=pureekangraw-ops%2Fprytaneion-workspace&path=.env"), async () => {called++;throw Error("unexpected")});
  assert.equal(forbidden.status,403);
  assert.equal(called,1);
});
test("GET root exposes working live source browser but no private provider data", async () => {
  const page=await call("/");
  const html=await page.text();
  assert.match(html,/GitHub Workspace/);
  assert.match(html,/UNDER MAINTENANCE/);
  assert.match(html,/\/ui.js/);
  const script=await call("/ui.js");
  assert.equal(script.status,200);
  assert.match(await script.text(),/api\/connections/);
});

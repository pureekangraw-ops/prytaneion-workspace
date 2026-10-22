import test from "node:test";
import assert from "node:assert/strict";
import worker, { exploreLegacy, probePantheon } from "./worker.mjs";

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

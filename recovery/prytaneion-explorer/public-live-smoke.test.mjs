import test from "node:test";
import assert from "node:assert/strict";

// Runs against the actual public maintenance entrance with NO secrets.
// Fixed destination prevents a CI variable from turning this into an SSRF probe.
const BASE = "https://prytaneion-explorer.pureekangraw.workers.dev";
async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(BASE + path, {
      ...options,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
async function json(path, options = {}) {
  const response = await request(path, options);
  const raw = await response.text();
  // Never echo an upstream body (including unexpected private data) to CI logs.
  assert.ok(raw.length <= 16000, "unexpected oversized public response");
  let data;
  try { data = JSON.parse(raw); }
  catch { assert.fail("expected JSON from " + path + " (HTTP " + response.status + ")"); }
  return { status: response.status, data };
}

test("LIVE public entrance remains maintenance-only", async () => {
  const health = await json("/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.readOnly, true);
  assert.equal(health.data.status, "UNDER_MAINTENANCE");

  const routes = await json("/api/explore");
  assert.equal(routes.status, 200);
  assert.equal(routes.data.mode, "READ_ONLY_EXPLORATION");
  assert.equal(routes.data.taskExecutionEnabled, false);

  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  const body = await page.text();
  assert.match(body, /UNDER MAINTENANCE/);
});

test("LIVE public HTTP cannot trigger credential probes, RPC or writes", async () => {
  const cold = await json("/api/direct-connections");
  assert.equal(cold.status, 200);
  assert.equal(cold.data.snapshotOnly, true);
  assert.equal(cold.data.readOnly, true);
  assert.equal(cold.data.privateDataReturned, false);

  const refresh = await json("/api/direct-connections?refresh=1", {
    headers: { authorization: "Bearer FAKE_TEST_ONLY", "x-trusted-caller": "fake" }
  });
  assert.equal(refresh.status, 403);
  assert.equal(refresh.data.code, "DIRECT_REFRESH_PROTECTED_ACTIVATION_PENDING");

  const post = await json("/api/direct-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "write" })
  });
  assert.equal(post.status, 405);
  assert.equal(post.data.code, "READ_ONLY_MAINTENANCE");

  const fakeRpc = await json("/HubDirectRead/probe");
  assert.equal(fakeRpc.status, 404);
  assert.equal(fakeRpc.data.code, "NOT_FOUND");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Use a caller-supplied installed Miniflare for local verification; no dependency
// or lockfile changes are required by this candidate.
const { Miniflare, Log, LogLevel } = await import(process.env.GO_HUB_TEST_MINIFLARE || "miniflare");
const root = fileURLToPath(new URL("../../", import.meta.url));
const paths = ["recovery/prytaneion-explorer/direct-entrypoint.mjs", "recovery/prytaneion-explorer/worker.mjs", "recovery/prytaneion-explorer/read-service.mjs", "recovery/prytaneion-explorer/hub-ui.mjs", "go-hub-route-contract.js", "go-hub-authority-map.js"];
test("native named entrypoint invokes fixed reads; public HTTP cannot invoke probes", async () => {
  let calls = 0;
  const fixtures = {
    "api.github.com": { id: 1, login: "PRIVATE" },
    "api.cloudflare.com": { success: true, result: { status: "active", id: "PRIVATE" } },
    "api.notion.com": { object: "user", type: "bot", id: "PRIVATE" },
    "www.googleapis.com": { kind: "drive#fileList", files: [{ name: "PRIVATE" }] }
  };
  const outboundService = async request => {
    calls++;
    if (new URL(request.url).hostname === "oauth2.googleapis.com") {
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), null);
      const form = new URLSearchParams(await request.text());
      assert.equal(form.get("grant_type"), "refresh_token");
      for (const field of ["client_id", "client_secret", "refresh_token"])
        assert.equal(form.get(field), "SYNTHETIC_TEST_ONLY");
      return Response.json({ access_token: "SYNTHETIC_TEST_ONLY", expires_in: 3600 });
    }
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("authorization"), "Bearer SYNTHETIC_TEST_ONLY");
    const fixture = fixtures[new URL(request.url).hostname];
    assert.ok(fixture);
    return Response.json(fixture);
  };
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), workers: [
    { name: "test-caller", modules: true, compatibilityDate: "2026-08-06",
      serviceBindings: { HUB: { name: "hub", entrypoint: "HubDirectRead" }, PUBLIC: "hub" },
      script: `export default {async fetch(request, env) {
        const p = new URL(request.url).pathname;
        if (p === '/probe') return Response.json(await env.HUB.probe());
        if (p === '/invalid') return Response.json(await env.HUB.probe({operation:'write',url:'https://evil.invalid'}));
        return env.PUBLIC.fetch(request);
      }};` },
    { name: "hub", compatibilityDate: "2026-08-06", modulesRoot: root,
      modules: paths.map(path => ({ type: "ESModule", path: root + path, contents: readFileSync(root + path, "utf8") })),
      bindings: Object.fromEntries(["GITHUB_TOKEN","CLOUDFLARE_TOKEN","NOTION_TOKEN","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REFRESH_TOKEN"].map(key => ["GO_HUB_DIRECT_" + key, "SYNTHETIC_TEST_ONLY"])),
      outboundService }
  ] });
  try {
    assert.equal((await mf.dispatchFetch("http://test/api/direct-connections?refresh=1")).status, 403);
    assert.equal((await (await mf.dispatchFetch("http://test/api/direct-connections")).json()).freshness, "UNOBSERVED");
    assert.equal((await (await mf.dispatchFetch("http://test/invalid")).json()).status, "INVALID_INPUT");
    assert.equal(calls, 0);
    const data = await (await mf.dispatchFetch("http://test/probe")).json();
    assert.equal(calls, 5);
    assert.equal(data.freshness, "FRESH");
    assert.ok(data.expiresAt > data.observedAt);
    assert.ok(Object.values(data.connections).every(v => v.status === "CONNECTED"));
    assert.doesNotMatch(JSON.stringify(data), /PRIVATE|SYNTHETIC_TEST_ONLY|https:/);
    await mf.dispatchFetch("http://test/probe");
    const snapshot = await (await mf.dispatchFetch("http://test/api/direct-connections")).json();
    assert.equal(snapshot.snapshotOnly, true);
    assert.equal((await mf.dispatchFetch("http://test/api/direct-connections?refresh=1")).status, 403);
    assert.equal((await mf.dispatchFetch("http://test/api/direct-connections", { method: "POST" })).status, 405);
    assert.equal((await mf.dispatchFetch("http://test/HubDirectRead/probe")).status, 404);
    assert.equal(calls, 5);
    assert.equal((await mf.dispatchFetch("http://test/health")).status, 200);
  } finally { await mf.dispose(); }
});

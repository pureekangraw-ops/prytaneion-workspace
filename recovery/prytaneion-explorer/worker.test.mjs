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

test("metadata rate limit falls back to verified GitHub source blob", async () => {
  const { inspectLegacy } = await import("./read-service.mjs");
  let requests=[];
  const answer=await inspectLegacy(async url=>{
    requests.push(url);
    if (url.endsWith("/prytaneion-workspace"))
      return new Response("{}",{status:403});
    return new Response(JSON.stringify({
      type:"file",encoding:"base64",content:btoa("export const value=1;"),sha:"f".repeat(40)
    }),{status:200,headers:{"content-type":"application/json"}});
  });
  assert.equal(answer.source,"GITHUB_VERIFIED_FILE_FALLBACK");
  assert.equal(answer.sha,"f".repeat(40));
  assert.equal(requests.length,2);
});

test("LIGHT named Service Binding returns sanitized Notion probe without source manifest",async()=>{
  const { probeLightProvider } = await import("./worker.mjs");
  let argument;
  const result=await probeLightProvider({LIGHT_LEGACY:{probe:async x=>{
    argument=x;return {status:"CONNECTED",connected:true,secret:"DO_NOT_LEAK",pages:[{title:"PRIVATE"}]};
  }}},"notion");
  assert.equal(argument,"notion");
  assert.equal(result.connected,true);
  assert.equal(result.notionAiEnabled,false);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|DO_NOT_LEAK/);
});
test("arbitrary LIGHT operation is never forwarded",async()=>{
  const { probeLightProvider } = await import("./worker.mjs");
  const r=await probeLightProvider({LIGHT_LEGACY:{probe:async()=>{throw Error("should not be called");}}},"delete_all");
  assert.equal(r.status,"UNSUPPORTED_CAPABILITY");
});

// Direct probes are status-only and never borrow a binding's principal.
import { probeDirectProvider, inspectDirectProviders } from "./read-service.mjs";
import { inspectDirectConnections, inspectConnections } from "./worker.mjs";
import { readFileSync } from "node:fs";
const directFixtures = {
  github: ["GO_HUB_DIRECT_GITHUB_TOKEN", "https://api.github.com/user", { id: 1, login: "PRIVATE" }],
  cloudflare: ["GO_HUB_DIRECT_CLOUDFLARE_TOKEN", "https://api.cloudflare.com/client/v4/user/tokens/verify", { success: true, result: { status: "active", id: "PRIVATE" } }],
  notion: ["GO_HUB_DIRECT_NOTION_TOKEN", "https://api.notion.com/v1/users/me", { object: "user", type: "bot", id: "PRIVATE" }],
  google: ["GO_HUB_DIRECT_GOOGLE_ACCESS_TOKEN", "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=kind", { kind: "drive#fileList", files: [{ name: "PRIVATE" }] }]
};
const mockToken = "FAKE_TEST_TOKEN";
const allDirect = Object.fromEntries(Object.values(directFixtures).map(([key]) => [key, mockToken]));
const reply = payload => new Response(JSON.stringify(payload));

test("each direct provider is independently disabled without its own credential", async () => {
  let calls = 0;
  const empty = await inspectDirectProviders({}, async () => { calls++; throw Error(); });
  assert.equal(calls, 0);
  for (const item of Object.values(empty.connections)) assert.equal(item.status, "NOT_CONFIGURED");
  const partial = await inspectDirectProviders({ GO_HUB_DIRECT_GITHUB_TOKEN: mockToken }, async () => {
    calls++; return reply(directFixtures.github[2]);
  });
  assert.equal(calls, 1);
  assert.equal(partial.connections.github.connected, true);
  assert.equal(partial.connections.google.status, "NOT_CONFIGURED");
});

test("fixed direct GET probes use only Hub credentials and discard private response data", async () => {
  for (const [provider, [key, endpoint, fixture]] of Object.entries(directFixtures)) {
    let calls = 0;
    const result = await probeDirectProvider({ [key]: mockToken }, provider, async (url, init) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers.authorization, "Bearer " + mockToken);
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(init.body, undefined);
      return reply({ ...fixture, secret: mockToken, url: "https://private.invalid/?token=" + mockToken });
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "CONNECTED");
    assert.equal(result.via, "DIRECT");
    assert.equal(result.credentialSource, "GO_HUB_ONLY");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|FAKE_TEST_TOKEN|https:/);
  }
});

test("401/403/429 and redirects never retry, follow redirects, or invoke bindings", async () => {
  for (const provider of Object.keys(directFixtures)) {
    for (const [status, expected] of [[401,"UNAUTHORIZED"],[403,"FORBIDDEN"],[429,"RATE_LIMITED"],[302,"REDIRECT_BLOCKED"],[500,"UPSTREAM_UNAVAILABLE"]]) {
      let calls = 0;
      const forbidden = () => { assert.fail("binding fallback"); };
      const result = await probeDirectProvider({ ...allDirect,
        PANTHEON_OWNER: { ownerCall: forbidden }, PANTHEON_LIGHT: { lightCall: forbidden }, LIGHT_LEGACY: { probe: forbidden }
      }, provider, async () => {
        calls++;
        return new Response("PRIVATE " + mockToken, { status, headers: { location: "https://private.invalid/?token=" + mockToken, "retry-after": "0" } });
      });
      assert.equal(calls, 1);
      assert.equal(result.status, expected);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE|FAKE_TEST_TOKEN|https:/);
    }
  }
});

test("untrusted operations, credentials, malformed responses and errors are bounded and redacted", async () => {
  for (const name of ["__proto__", "constructor", "delete_all", "https://evil.invalid"]) {
    assert.equal((await probeDirectProvider({ ...allDirect }, name, () => assert.fail())).status, "UNSUPPORTED_CAPABILITY");
  }
  assert.equal((await probeDirectProvider({ GO_HUB_DIRECT_GITHUB_TOKEN: "bad\nheader" }, "github", () => assert.fail())).status, "INVALID_CREDENTIAL_FORMAT");
  for (const fetchImpl of [async () => { throw Error("PRIVATE " + mockToken); }, async () => new Response("invalid PRIVATE"), async () => reply({ private: mockToken })]) {
    const result = await probeDirectProvider({ ...allDirect }, "github", fetchImpl);
    assert.equal(result.connected, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|FAKE_TEST_TOKEN/);
  }
  for (const headers of [{}, {"content-length":"16385"}]) {
    const result = await probeDirectProvider({ ...allDirect }, "github", async () => new Response("x".repeat(16385), { headers }));
    assert.equal(result.status, "RESPONSE_TOO_LARGE");
  }
});

test("fetch and body stalls have an eight-second deadline with no retry", async () => {
  const signals = [];
  let calls = 0;
  const results = await Promise.all([
    probeDirectProvider({ ...allDirect }, "google", async (_url, init) => { calls++; signals.push(init.signal); return new Promise(() => {}); }),
    probeDirectProvider({ ...allDirect }, "notion", async (_url, init) => { calls++; signals.push(init.signal); return new Response(new ReadableStream({ start() {} })); })
  ]);
  assert.equal(calls, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.deepEqual(results.map(r => r.status), ["TIMEOUT", "TIMEOUT"]);
});

test("direct cache coalesces requests, bounds refresh, and isolates environments", async () => {
  const env = { ...allDirect };
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    return reply(Object.values(directFixtures).find(([,endpoint]) => endpoint === url)[2]);
  };
  const [first, second] = await Promise.all([inspectDirectConnections(env, fetchImpl), inspectDirectConnections(env, fetchImpl)]);
  assert.deepEqual(first, second);
  await inspectDirectConnections(env, fetchImpl, { force: true });
  assert.equal(calls, 4);
  const empty = await inspectDirectConnections({}, () => assert.fail());
  assert.equal(empty.connections.github.status, "NOT_CONFIGURED");
});

test("direct route is status-only, ignores arbitrary destinations, and rejects writes", async () => {
  const env = { LIGHT_LEGACY: { probe: () => assert.fail("direct must not invoke binding") } };
  const response = await call("/api/direct-connections?url=https://evil.invalid&operation=delete_all", {}, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.evidence, "DIRECT_PROVIDER_READ");
  assert.equal(body.privateDataReturned, false);
  assert.equal(body.status, "PROTECTED_ACTIVATION_PENDING");
  assert.deepEqual(body.connections, {});
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
    assert.equal((await call("/api/direct-connections", { method }, env)).status, 405);
  }
});

test("existing binding and public probes still work without direct credentials", async () => {
  const operations = [];
  const env = {
    PANTHEON_OWNER: { ownerCall: async x => { operations.push(x.operation); return { ok: true, upstream_status: 200, result: { factory: { connection: "CONNECTED" } } }; } },
    PANTHEON_LIGHT: { lightCall: async x => { operations.push(x.operation); return { ok: true, result: { source: "google_drive", read_only: true } }; } },
    LIGHT_LEGACY: { probe: async x => { operations.push(x); return { status: "CONNECTED", connected: true }; } }
  };
  const result = await inspectConnections(env, async (_url, init) => {
    assert.equal(init.headers.authorization, undefined);
    return reply({ full_name: "pureekangraw-ops/prytaneion-workspace", private: false });
  });
  assert.equal(result.connections.github.method, "PUBLIC_REPOSITORY_REST");
  assert.equal(result.connections.googlePantheon.connected, true);
  assert.equal(result.connections.googleLight.connected, true);
  assert.equal(result.connections.notion.connected, true);
  assert.equal(result.connections.cloudflare.connected, true);
  assert.deepEqual(operations.sort(), ["factory_health","pantheon.drive.read","notion","cloudflare","google"].sort());
  const config = JSON.parse(readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.services, [
    { binding: "PANTHEON_OWNER", service: "phatheon-workhub", entrypoint: "OwnerBridge" },
    { binding: "PANTHEON_LIGHT", service: "phatheon-workhub", entrypoint: "LightBridge" },
    { binding: "LIGHT_LEGACY", service: "light-bookmark", entrypoint: "LegacyExplorerRead" }
  ]);
});

test("anonymous cold, cached and expired status reads never activate credentialed requests", async () => {
  const env = { ...allDirect };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  const start = originalNow();
  try {
    globalThis.fetch = async () => { calls++; throw Error("HTTP must not fetch"); };
    for (const query of ["?refresh=1", "?refresh=0", "?refresh=", "?refresh=1&provider=github"]) {
      const r = await call("/api/direct-connections" + query, { headers: { authorization: "Bearer fake", "x-trusted-caller": "true" } }, env);
      assert.equal(r.status, 403);
    }
    assert.equal((await (await call("/api/direct-connections", {}, env)).json()).status, "PROTECTED_ACTIVATION_PENDING");
    await inspectDirectConnections(env, async url => reply(Object.values(directFixtures).find(([,endpoint]) => endpoint === url)[2]));
    Date.now = () => start + 60 * 60 * 1000;
    const snapshot = await (await call("/api/direct-connections", {}, env)).json();
    assert.equal(snapshot.snapshotOnly, true);
    assert.equal(snapshot.connections.github.status, "STALE");
    assert.equal(snapshot.connections.github.lastStatus, "CONNECTED");
    assert.equal(snapshot.connections.github.connected, false);
    assert.equal(snapshot.freshness, "EXPIRED");
    assert.ok(snapshot.observedAt <= start + 1000);
    assert.ok(snapshot.expiresAt < Date.now());
    assert.equal((await call("/api/direct-connections?refresh=1", {}, env)).status, 403);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
});

test("internal refresh cannot bypass per-provider 429 cooldown; no scheduled retry", async () => {
  const originalNow = Date.now;
  const start = originalNow();
  let now = start;
  Date.now = () => now;
  const env = { ...allDirect };
  const calls = { github: 0, cloudflare: 0, notion: 0, google: 0 };
  const fetchImpl = async url => {
    const [provider, fixture] = Object.entries(directFixtures).find(([,v]) => v[1] === url);
    calls[provider]++;
    return provider === "github" ? new Response("PRIVATE", { status: 429, headers: { "retry-after": "120" } }) : reply(fixture[2]);
  };
  try {
    await inspectDirectConnections(env, fetchImpl);
    now += 31000;
    const r = await inspectDirectConnections(env, fetchImpl, { force: true });
    assert.equal(r.connections.github.status, "RATE_LIMITED");
    assert.deepEqual(calls, { github: 1, cloudflare: 2, notion: 2, google: 2 });
    assert.doesNotMatch(JSON.stringify(r), /retry-after|PRIVATE|120/);
    now = start + 121000;
    assert.equal(calls.github, 1); // Advancing time does not schedule a request.
    await inspectDirectConnections(env, fetchImpl, { force: true });
    assert.equal(calls.github, 2);
  } finally { Date.now = originalNow; }
});

test("Retry-After dates, malformed input, and extreme values are sanitized and bounded", async () => {
  const originalNow = Date.now;
  const start = Date.UTC(2026, 9, 23);
  let now = start;
  Date.now = () => now;
  try {
    for (const [header, cooldown] of [[new Date(start + 90000).toUTCString(), 90000], ["PRIVATE token", 60000], ["9999999999", 86400000], ["0", 30000]]) {
      now = start;
      const env = { ...allDirect };
      let calls = 0;
      const fetchImpl = async () => { calls++; return new Response("PRIVATE", { status: 429, headers: { "retry-after": header } }); };
      const first = await probeDirectProvider(env, "github", fetchImpl);
      now = start + cooldown - 1;
      assert.deepEqual(await probeDirectProvider(env, "github", fetchImpl), first);
      assert.equal(calls, 1);
      now++;
      await probeDirectProvider(env, "github", fetchImpl);
      assert.equal(calls, 2);
      assert.doesNotMatch(JSON.stringify(first), /PRIVATE|token|GMT|9999999999/);
    }
  } finally { Date.now = originalNow; }
});


test("Google direct read uses refresh credentials without an access-token slot", async () => {
  const { probeDirectProvider } = await import("./read-service.mjs");
  const secrets = {
    GO_HUB_DIRECT_GOOGLE_CLIENT_ID: "SYNTHETIC_CLIENT_ID",
    GO_HUB_DIRECT_GOOGLE_CLIENT_SECRET: "SYNTHETIC_CLIENT_SECRET",
    GO_HUB_DIRECT_GOOGLE_REFRESH_TOKEN: "SYNTHETIC_REFRESH_TOKEN"
  };
  const calls = [];
  const result = await probeDirectProvider(secrets, "google", async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(init.method, "POST");
      assert.equal(init.headers.authorization, undefined);
      const params = new URLSearchParams(init.body);
      assert.deepEqual(Object.fromEntries(params), {
        client_id: secrets.GO_HUB_DIRECT_GOOGLE_CLIENT_ID,
        client_secret: secrets.GO_HUB_DIRECT_GOOGLE_CLIENT_SECRET,
        refresh_token: secrets.GO_HUB_DIRECT_GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token"
      });
      return new Response(JSON.stringify({
        access_token: "SYNTHETIC_ACCESS_PRIVATE",
        refresh_token: "SHOULD_NEVER_RETURN",
        expires_in: 3600
      }));
    }
    assert.equal(url, "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=kind");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, "Bearer SYNTHETIC_ACCESS_PRIVATE");
    return new Response(JSON.stringify({ kind: "drive#fileList", files: [{ name: "PRIVATE_DOCUMENT" }] }));
  });
  assert.deepEqual(calls, [
    "https://oauth2.googleapis.com/token",
    "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=kind"
  ]);
  assert.equal(result.status, "CONNECTED");
  assert.equal(result.readOnly, true);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC|PRIVATE|SHOULD_NEVER_RETURN|https:/);
});

test("Google OAuth failures do not fall back to service bindings or expose secrets", async () => {
  const { probeDirectProvider } = await import("./read-service.mjs");
  const base = {
    GO_HUB_DIRECT_GOOGLE_CLIENT_ID: "client",
    GO_HUB_DIRECT_GOOGLE_CLIENT_SECRET: "secret",
    GO_HUB_DIRECT_GOOGLE_REFRESH_TOKEN: "refresh"
  };
  const absent = await probeDirectProvider({ GO_HUB_DIRECT_GOOGLE_CLIENT_ID: "client" }, "google",
    () => assert.fail("Missing credential must never call upstream"));
  assert.equal(absent.status, "NOT_CONFIGURED");
  let calls = 0;
  const bad = await probeDirectProvider({ ...base, LIGHT_LEGACY: { probe: () => assert.fail("Must not borrow LIGHT") } },
    "google", async url => {
      calls++;
      assert.equal(url, "https://oauth2.googleapis.com/token");
      return new Response(JSON.stringify({ error: "invalid_grant", debug: "PRIVATE" }), { status: 400 });
    });
  assert.equal(calls, 1);
  assert.equal(bad.status, "UNAUTHORIZED");
  assert.equal(bad.connected, false);
  assert.doesNotMatch(JSON.stringify(bad), /PRIVATE|secret|refresh|invalid_grant/);
  const oversized = await probeDirectProvider({ ...base }, "google", async () =>
    new Response(JSON.stringify({ access_token: "P".repeat(17000) })));
  assert.equal(oversized.status, "RESPONSE_TOO_LARGE");
});


test("Cloudflare accepts account-owned token verification without exposing account metadata", async () => {
  const { probeDirectProvider } = await import("./read-service.mjs");
  const account = "a".repeat(32);
  const token = "SYNTHETIC_CLOUDFLARE_TOKEN";
  const routes = [];
  const result = await probeDirectProvider({
    GO_HUB_DIRECT_CLOUDFLARE_ACCOUNT_ID: account,
    GO_HUB_DIRECT_CLOUDFLARE_TOKEN: token
  }, "cloudflare", async (url, init) => {
    routes.push(url);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, "Bearer " + token);
    return new Response(JSON.stringify({ success: true, result: { status: "active", id: "PRIVATE_ID" } }));
  });
  assert.deepEqual(routes, ["https://api.cloudflare.com/client/v4/accounts/" + account + "/tokens/verify"]);
  assert.equal(result.status, "CONNECTED");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ID|SYNTHETIC|aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});

test("Cloudflare account-token mismatch falls back only to fixed user-token verification", async () => {
  const { probeDirectProvider } = await import("./read-service.mjs");
  const account = "b".repeat(32);
  let urls = [];
  const result = await probeDirectProvider({
    GO_HUB_DIRECT_CLOUDFLARE_ACCOUNT_ID: account,
    GO_HUB_DIRECT_CLOUDFLARE_TOKEN: "SYNTHETIC"
  }, "cloudflare", async url => {
    urls.push(url);
    return urls.length === 1
      ? new Response("PRIVATE_NOT_AUTHORIZED", { status: 401 })
      : new Response(JSON.stringify({ success: true, result: { status: "active" } }));
  });
  assert.deepEqual(urls, [
    "https://api.cloudflare.com/client/v4/accounts/" + account + "/tokens/verify",
    "https://api.cloudflare.com/client/v4/user/tokens/verify"
  ]);
  assert.equal(result.status, "CONNECTED");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SYNTHETIC/);
  const invalidId = await probeDirectProvider({
    GO_HUB_DIRECT_CLOUDFLARE_ACCOUNT_ID: "https://evil.example", GO_HUB_DIRECT_CLOUDFLARE_TOKEN: "SYNTHETIC"
  }, "cloudflare", async url => {
    assert.equal(url, "https://api.cloudflare.com/client/v4/user/tokens/verify");
    return new Response("PRIVATE", { status: 401 });
  });
  assert.equal(invalidId.status, "UNAUTHORIZED");
});

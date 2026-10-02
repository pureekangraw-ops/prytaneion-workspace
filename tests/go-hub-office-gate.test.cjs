"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

const gateUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-office-gate.mjs")).href;

function env(overrides = {}) {
  return {
    GOHUB_OFFICE_PASSCODE:"office-secret",
    GOHUB_OFFICE_SESSION_KEY:"0123456789abcdef0123456789abcdef",
    GOHUB_OFFICE_SESSION_EPOCH:"7",
    GOHUB_OFFICE_SESSION_TTL_SECONDS:"3600",
    ...overrides,
  };
}

function request(pathname, init = {}) {
  return new Request("https://office.example" + pathname, init);
}

function cookieFrom(response) {
  const set = response.headers.get("set-cookie") || "";
  return set.split(";")[0];
}

async function login(gate, currentEnv = env()) {
  const body = new URLSearchParams({ passcode:"office-secret" });
  return gate.fetch(request("/office/login", {
    method:"POST",
    headers:{ origin:"https://office.example", "content-type":"application/x-www-form-urlencoded" },
    body,
  }), currentEnv);
}

test("Office Gate denies protected routes without a session and returns no Work data", async () => {
  const { createOfficeGate } = await import(gateUrl + "?unauth=" + Date.now());
  const gate = createOfficeGate();
  for (const pathname of ["/office", "/office/api/work", "/office/api/eye"]) {
    const response = await gate.fetch(request(pathname), env());
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload), ["code"]);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  }
});

test("Office Gate is deny-by-default and does not delegate unknown Office routes", async () => {
  const { createOfficeGate } = await import(gateUrl + "?deny=" + Date.now());
  const gate = createOfficeGate();
  const loginResponse = await login(gate);
  const cookie = cookieFrom(loginResponse);
  const denied = await gate.fetch(request("/office/api/github-workspace", { headers:{ cookie } }), env());
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { code:"OFFICE_ROUTE_DENIED" });
});

test("Office login creates an HttpOnly Secure SameSite session and private responses", async () => {
  const { createOfficeGate } = await import(gateUrl + "?login=" + Date.now());
  const gate = createOfficeGate();
  const response = await login(gate);
  assert.equal(response.status, 303);
  const set = response.headers.get("set-cookie");
  assert.match(set, /__Host-ygg-office=/);
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);
  assert.match(set, /SameSite=Strict/);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");

  const cookie = cookieFrom(response);
  const office = await gate.fetch(request("/office", { headers:{ cookie } }), env());
  assert.equal(office.status, 200);
  assert.doesNotMatch(await office.text(), /GOHUB_OFFICE_SESSION_KEY|office-secret/);
});

test("Office login rejects cross-origin and wrong credentials without leaking secrets", async () => {
  const { createOfficeGate } = await import(gateUrl + "?loginfail=" + Date.now());
  const gate = createOfficeGate();
  const cross = await gate.fetch(request("/office/login", {
    method:"POST",
    headers:{ origin:"https://evil.example", "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({ passcode:"office-secret" }),
  }), env());
  assert.equal(cross.status, 403);
  assert.deepEqual(await cross.json(), { code:"OFFICE_ORIGIN_DENIED" });

  const wrong = await gate.fetch(request("/office/login", {
    method:"POST",
    headers:{ origin:"https://office.example", "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({ passcode:"wrong" }),
  }), env());
  assert.equal(wrong.status, 403);
  const text = await wrong.text();
  assert.doesNotMatch(text, /office-secret|wrong/);
});

test("Office session can be revoked by epoch rotation and logout clears the cookie", async () => {
  const { createOfficeGate } = await import(gateUrl + "?revoke=" + Date.now());
  const gate = createOfficeGate();
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);

  const revoked = await gate.fetch(request("/office/session", { headers:{ cookie } }), env({ GOHUB_OFFICE_SESSION_EPOCH:"8" }));
  assert.equal(revoked.status, 401);
  assert.deepEqual(await revoked.json(), { code:"OFFICE_SESSION_REVOKED" });

  const logout = await gate.fetch(request("/office/logout", {
    method:"POST",
    headers:{ cookie, origin:"https://office.example" },
  }), env());
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test("Office allowlisted Work/command/Eye seams stay unwired in Phase 1 after authentication", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase1=" + Date.now());
  const gate = createOfficeGate();
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);

  for (const [pathname, method] of [["/office/api/work","GET"],["/office/api/eye","GET"],["/office/api/command","POST"]]) {
    const response = await gate.fetch(request(pathname, {
      method,
      headers:{ cookie, ...(method === "POST" ? { origin:"https://office.example" } : {}) },
    }), env());
    assert.equal(response.status, 501);
    assert.deepEqual(await response.json(), { code:"OFFICE_ROUTE_NOT_WIRED_PHASE_1" });
  }
});

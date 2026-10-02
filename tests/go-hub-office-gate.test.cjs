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

test("Office Work read delegates exact identity to Centre V4 and preserves Centre as truth owner", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase2-read=" + Date.now());
  const calls = [];
  const centreLive = {
    async action(input) {
      calls.push(input);
      return new Response(JSON.stringify({
        ok:true,
        v4:true,
        work:{ workId:"WORK-1", checkpointId:"CP-1", status:"ON PROCESS", ownership:{ ownerId:"GO" } },
      }), { headers:{ "content-type":"application/json" } });
    },
  };
  const gate = createOfficeGate({ centreLive });
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);
  const response = await gate.fetch(request("/office/api/work?workId=WORK-1&checkpointId=CP-1", { headers:{ cookie } }), env());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.work.workId, "WORK-1");
  assert.equal(payload.work.checkpointId, "CP-1");
  assert.deepEqual(calls, [{ action:"v4_inspect", workId:"WORK-1", checkpointId:"CP-1" }]);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("Office command forwards the canonical Agent Mission payload unchanged and denies non-canonical actions", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase2-command=" + Date.now());
  const received = [];
  const agentMission = {
    async action(input) {
      received.push(input);
      return new Response(JSON.stringify({
        ok:true,
        action:input.action,
        tabletId:"TABLET:0001-TEST",
        workContext:{ workId:"WORK-NEW", checkpointId:"CP-NEW" },
      }), { status:201, headers:{ "content-type":"application/json" } });
    },
  };
  const gate = createOfficeGate({
    agentMission,
    agentMissionActions:["create_tablet","pickup_tablet","emergency_enter","help_choose","update_tablet","return_tablet"],
  });
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);
  const command = {
    action:"create_tablet",
    agentId:"GO",
    mission:"Office-created mission",
    requestedResult:"Use current Agent Mission contract",
    workKey:"OFFICE-MISSION",
    workType:"NORMAL",
    initialContext:{ source:"OFFICE" },
  };
  const response = await gate.fetch(request("/office/api/command", {
    method:"POST",
    headers:{ cookie, origin:"https://office.example", "content-type":"application/json" },
    body:JSON.stringify(command),
  }), env());
  assert.equal(response.status, 201);
  assert.deepEqual(received, [command]);

  const legacy = await gate.fetch(request("/office/api/command", {
    method:"POST",
    headers:{ cookie, origin:"https://office.example", "content-type":"application/json" },
    body:JSON.stringify({ action:"review", workId:"WORK-X" }),
  }), env());
  assert.equal(legacy.status, 403);
  assert.deepEqual(await legacy.json(), { code:"OFFICE_AGENT_MISSION_ACTION_DENIED" });
});

test("Office command requires same-origin even with a valid session", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase2-origin=" + Date.now());
  let calls = 0;
  const gate = createOfficeGate({
    agentMission:{ async action() { calls += 1; return new Response("{}"); } },
    agentMissionActions:["create_tablet"],
  });
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);
  const response = await gate.fetch(request("/office/api/command", {
    method:"POST",
    headers:{ cookie, origin:"https://evil.example", "content-type":"application/json" },
    body:JSON.stringify({ action:"create_tablet" }),
  }), env());
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test("Office Eye remains intentionally unwired in Phase 2", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase2-eye=" + Date.now());
  const gate = createOfficeGate();
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);
  const response = await gate.fetch(request("/office/api/eye", { headers:{ cookie } }), env());
  assert.equal(response.status, 501);
  assert.deepEqual(await response.json(), { code:"OFFICE_ROUTE_NOT_WIRED_PHASE_2" });
});

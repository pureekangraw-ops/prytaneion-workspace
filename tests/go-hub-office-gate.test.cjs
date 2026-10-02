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

test("Office login accepts a same-origin mobile form POST when Origin is omitted", async () => {
  const { createOfficeGate } = await import(gateUrl + "?mobile-origin=" + Date.now());
  const gate = createOfficeGate();
  const response = await gate.fetch(request("/office/login", {
    method:"POST",
    headers:{
      "sec-fetch-site":"same-origin",
      "content-type":"application/x-www-form-urlencoded",
    },
    body:new URLSearchParams({ passcode:"office-secret" }),
  }), env());
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie") || "", /__Host-ygg-office=/);
});

test("Office login still rejects a cross-site POST when Origin is omitted", async () => {
  const { createOfficeGate } = await import(gateUrl + "?mobile-cross-site=" + Date.now());
  const gate = createOfficeGate();
  const response = await gate.fetch(request("/office/login", {
    method:"POST",
    headers:{
      "sec-fetch-site":"cross-site",
      "content-type":"application/x-www-form-urlencoded",
    },
    body:new URLSearchParams({ passcode:"office-secret" }),
  }), env());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code:"OFFICE_ORIGIN_DENIED" });
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

test("Office Eye reads Factory Eye latest evidence without credentials or mutation", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase3-eye=" + Date.now());
  let latestCalls = 0;
  let screenshotCalls = 0;
  const factoryEye = {
    async latest() {
      latestCalls += 1;
      return {
        ok:true,
        source:"FACTORY_EYE",
        state:"STALE",
        freshness:{ state:"STALE", transportState:"STALE", evidenceLive:false },
        tabs:[{ tabId:7, active:true, url:"https://example.com/", title:"Example" }],
        latest:{
          observationId:"OBS-7",
          observedAt:"2026-10-02T06:00:00.000Z",
          receivedAt:"2026-10-02T06:00:01.000Z",
          tab:{ tabId:7, active:true, url:"https://example.com/", title:"Example" },
          page:{ title:"Example", capturesInputValues:false, createsAuthority:false },
          screenshotRef:"factory-eye-shot:session:OBS-7",
          source:"FACTORY_EYE",
          createsAuthority:false,
        },
        comparison:{ ready:false },
        createsAuthority:false,
      };
    },
    async screenshot({ screenshotRef }) {
      screenshotCalls += 1;
      return {
        ok:true,
        source:"FACTORY_EYE",
        screenshot:{ ref:screenshotRef, capturedAt:"2026-10-02T06:00:00.000Z", dataUrl:"data:image/png;base64,AA==" },
      };
    },
  };
  const gate = createOfficeGate({ factoryEye });
  const loggedIn = await login(gate);
  const cookie = cookieFrom(loggedIn);

  const latest = await gate.fetch(request("/office/api/eye", { headers:{ cookie } }), env());
  assert.equal(latest.status, 200);
  const payload = await latest.json();
  assert.equal(payload.source, "FACTORY_EYE");
  assert.equal(payload.mode, "READ_ONLY");
  assert.equal(payload.state, "STALE");
  assert.equal(payload.freshness.evidenceLive, false);
  assert.equal(payload.latest.tab.url, "https://example.com/");
  assert.equal(payload.latest.screenshotRef, "factory-eye-shot:session:OBS-7");
  assert.equal(payload.createsAuthority, false);
  assert.equal(latestCalls, 1);
  assert.equal(screenshotCalls, 0);
  assert.equal(latest.headers.get("cache-control"), "no-store, max-age=0");

  const shot = await gate.fetch(request("/office/api/eye?screenshotRef=factory-eye-shot%3Asession%3AOBS-7", { headers:{ cookie } }), env());
  assert.equal(shot.status, 200);
  const shotPayload = await shot.json();
  assert.equal(shotPayload.mode, "READ_ONLY");
  assert.equal(shotPayload.screenshot.ref, "factory-eye-shot:session:OBS-7");
  assert.equal(shotPayload.screenshot.dataUrl, "data:image/png;base64,AA==");
  assert.equal(screenshotCalls, 1);
});

test("Office Eye preserves WARMING_UP/STALE truth and never upgrades evidence to LIVE", async () => {
  const { createOfficeGate } = await import(gateUrl + "?phase3-freshness=" + Date.now());
  for (const state of ["WARMING_UP","STALE"]) {
    const factoryEye = {
      async latest() {
        return {
          ok:true,
          source:"FACTORY_EYE",
          state,
          freshness:{ state, transportState:state === "WARMING_UP" ? "LIVE" : "STALE", evidenceLive:false },
          tabs:[],
          latest:null,
          comparison:{ ready:false },
          createsAuthority:false,
        };
      },
      async screenshot() { return { ok:false, code:"FACTORY_EYE_SCREENSHOT_NOT_FOUND" }; },
    };
    const gate = createOfficeGate({ factoryEye });
    const loggedIn = await login(gate);
    const cookie = cookieFrom(loggedIn);
    const response = await gate.fetch(request("/office/api/eye", { headers:{ cookie } }), env());
    const payload = await response.json();
    assert.equal(payload.state, state);
    assert.equal(payload.freshness.evidenceLive, false);
    assert.notEqual(payload.state, "LIVE");
  }
});

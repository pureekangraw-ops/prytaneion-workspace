"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const load = name => import(pathToFileURL(path.join(root, name)).href + "?security=" + Date.now() + Math.random());

function loginRequest(passcode, ip = "203.0.113.10") {
  return new Request("https://hub.test/office/login", {
    method: "POST",
    headers: {
      origin: "https://hub.test",
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": ip,
    },
    body: new URLSearchParams({ passcode }),
  });
}

test("Office login throttles repeated failures and audits the auth lifecycle", async () => {
  const { createOfficeGate } = await load("go-hub-office-gate.mjs");
  const { createOfficeRateLimiter } = await load("go-hub-office-rate-limit.mjs");
  let now = 1_000;
  const audit = [];
  const rateLimiter = createOfficeRateLimiter({ memory: new Map(), now: () => now });
  const gate = createOfficeGate({ rateLimiter, audit: event => audit.push(event) });
  const env = {
    GOHUB_OFFICE_PASSCODE: "correct-passcode",
    GOHUB_OFFICE_SESSION_KEY: "test-session-key",
    GOHUB_OFFICE_SESSION_EPOCH: "1",
  };

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.equal((await gate.fetch(loginRequest("wrong"), env)).status, 403);
  }
  assert.equal((await gate.fetch(loginRequest("wrong"), env)).status, 429);
  assert.equal((await gate.fetch(loginRequest("correct-passcode"), env)).status, 429);
  assert.deepEqual(audit.map(event => event.type), [
    "OFFICE_LOGIN_FAILED",
    "OFFICE_LOGIN_FAILED",
    "OFFICE_LOGIN_FAILED",
    "OFFICE_LOGIN_FAILED",
    "OFFICE_LOGIN_RATE_LIMITED",
    "OFFICE_LOGIN_RATE_LIMITED",
  ]);
  assert.equal(audit.every(event => event.workId === "WORK-GO-HUB-OFFICE-AUTH" && event.checkpointId === "CP-GO-HUB-OFFICE-AUTH"), true);
  assert.equal(JSON.stringify(audit).includes("passcode"), false);

  now += 15 * 60 * 1000 + 1;
  const success = await gate.fetch(loginRequest("correct-passcode"), env);
  assert.equal(success.status, 303);
  assert.equal(audit.at(-1).type, "OFFICE_LOGIN_SUCCESS");
});

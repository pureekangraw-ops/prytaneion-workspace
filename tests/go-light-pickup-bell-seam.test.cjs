"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const dispatcherUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-counter-dispatcher.mjs")).href;

function storage() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async setAlarm() { throw new Error("Counter pickup route must not schedule a bell retry"); },
  };
}

const input = {
  counterId: "COUNTER-OWNER-TRIGGER-BOUNDARY-001",
  workId: "WORK-GO-LIGHT-COUNTER-20260919-001",
  checkpointId: "CP-GO-LIGHT-COUNTER-001",
  mode: "HANDOFF",
  request: "Hold this ticket until BIG explicitly triggers LIGHT.",
  requestedResult: "WAITING_PICKUP without automatic wake.",
  authority: "BIG",
  target: "GO Hub",
  projectRef: "GO Hub",
  fromActor: "GO",
  toActor: "LIGHT",
  context: { direction: "GO_TO_LIGHT" },
  workContext: {
    workId: "WORK-GO-LIGHT-COUNTER-20260919-001",
    checkpointId: "CP-GO-LIGHT-COUNTER-001",
  },
};

test("HANDOFF stays waiting even when legacy bell configuration exists", async () => {
  const { GoHubCounterDispatchState } = await import(dispatcherUrl + "?owner-trigger-boundary=" + Date.now());
  const calls = [];
  const service = new GoHubCounterDispatchState({ storage: storage() }, {
    LIGHT_BELL_PAGE_ID: "legacy-bell-page",
    LIGHT_WAKE_URL: "https://light.example/wake",
    GO_HUB_NOTION_LIGHT_STATE: {
      getByName() {
        return { fetch: async () => { calls.push("notion"); throw new Error("must not be called"); } };
      },
    },
  });

  const response = await service.fetch(new Request("https://counter-dispatch.internal/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "open", ...input }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.triggerRequired, true);
  assert.equal(payload.dispatch.legs.LIGHT.status, "WAITING_PICKUP");
  assert.equal(payload.dispatch.legs.LIGHT.attempts, 0);
  assert.deepEqual(calls, []);
});


test("SEARCH also stays on Counter pickup even when legacy bell and Notion configuration exist", async () => {
  const { GoHubCounterDispatchState } = await import(dispatcherUrl + "?search-owner-trigger-boundary=" + Date.now());
  const calls = [];
  const service = new GoHubCounterDispatchState({ storage: storage() }, {
    LIGHT_BELL_PAGE_ID: "legacy-bell-page",
    LIGHT_WAKE_URL: "https://light.example/wake",
    GO_HUB_NOTION_LIGHT_STATE: {
      getByName() {
        return { fetch: async () => { calls.push("notion"); throw new Error("must not be called"); } };
      },
    },
  });

  const response = await service.fetch(new Request("https://counter-dispatch.internal/open", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "open",
      ...input,
      counterId: "COUNTER-OWNER-TRIGGER-BOUNDARY-SEARCH-001",
      mode: "SEARCH",
      requestedResult: undefined,
    }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.dispatch.legs.LIGHT.status, "WAITING_PICKUP");
  assert.equal(payload.dispatch.legs.LIGHT.attempts, 0);
  assert.equal(payload.transport, "COUNTER_INBOX");
  assert.equal(payload.mode, "SEARCH");
  assert.deepEqual(calls, []);
});

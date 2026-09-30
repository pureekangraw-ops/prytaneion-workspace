"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-centre-client.js")).href;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    snapshot() { return Object.fromEntries(map); },
  };
}

test("Centre client restores durable work by identity pointer and does not replay local state", async () => {
  const { createCentreLiveClient, CENTRE_POINTER_KEY } = await import(moduleUrl + "?restore=" + Date.now());
  const storage = memoryStorage({
    [CENTRE_POINTER_KEY]: JSON.stringify({ workId: "WORK-A", checkpointId: "CENTRE-A", status: "FAKE_LOCAL_STATE" }),
  });
  const calls = [];
  const client = createCentreLiveClient({
    storage,
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(options.body);
      calls.push(input);
      return response({
        ok: true,
        phase: "AWAY",
        workId: "WORK-A",
        checkpointId: "CENTRE-A",
        returnAddress: "CENTRE-A",
        work: {
          workId: "WORK-A",
          checkpointId: "CENTRE-A",
          status: "AWAY",
          role: { roleReference: "role://factory", workingView: "live" },
          handoff: { destination: "destination://factory", returnAddress: "CENTRE-A" },
        },
      });
    },
  });

  const work = await client.restoreOrStart();
  assert.equal(work.status, "AWAY");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    action: "inspect",
    workId: "WORK-A",
    checkpointId: "CENTRE-A",
    returnAddress: "CENTRE-A",
  });
  assert.deepEqual(JSON.parse(storage.snapshot()[CENTRE_POINTER_KEY]), {
    workId: "WORK-A",
    checkpointId: "CENTRE-A",
  });
});

test("Centre client discards a stale missing-work pointer then starts and reads back a fresh durable work", async () => {
  const { createCentreLiveClient, CENTRE_POINTER_KEY } = await import(moduleUrl + "?stale=" + Date.now());
  const storage = memoryStorage({
    [CENTRE_POINTER_KEY]: JSON.stringify({ workId: "WORK-OLD", checkpointId: "CENTRE-OLD" }),
  });
  const calls = [];
  const client = createCentreLiveClient({
    storage,
    idFactory: () => "ID-RECOVERED",
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(options.body);
      calls.push(input);
      if (input.action === "inspect" && input.workId === "WORK-OLD") {
        return response({ code: "CENTRE_WORK_NOT_FOUND" }, 404);
      }
      if (input.action === "start") {
        return response({
          ok: true,
          phase: "ARRIVED",
          workId: "WORK-ID-RECOVERED",
          checkpointId: "CENTRE-ID-RECOVERED",
          returnAddress: "CENTRE-ID-RECOVERED",
          work: { workId: "WORK-ID-RECOVERED", checkpointId: "CENTRE-ID-RECOVERED", status: "ARRIVED" },
        });
      }
      return response({
        ok: true,
        phase: "ARRIVED",
        workId: "WORK-ID-RECOVERED",
        checkpointId: "CENTRE-ID-RECOVERED",
        returnAddress: "CENTRE-ID-RECOVERED",
        work: { workId: "WORK-ID-RECOVERED", checkpointId: "CENTRE-ID-RECOVERED", status: "ARRIVED", authority: null },
      });
    },
  });

  const work = await client.restoreOrStart();
  assert.equal(work.workId, "WORK-ID-RECOVERED");
  assert.deepEqual(calls.map(item => item.action), ["inspect", "start", "inspect"]);
  assert.deepEqual(JSON.parse(storage.snapshot()[CENTRE_POINTER_KEY]), {
    workId: "WORK-ID-RECOVERED",
    checkpointId: "CENTRE-ID-RECOVERED",
  });
});

test("Centre client does not discard a pointer or start replacement work for live service failure", async () => {
  const { createCentreLiveClient, CENTRE_POINTER_KEY } = await import(moduleUrl + "?failclosed=" + Date.now());
  const original = JSON.stringify({ workId: "WORK-A", checkpointId: "CENTRE-A" });
  const storage = memoryStorage({ [CENTRE_POINTER_KEY]: original });
  const calls = [];
  const client = createCentreLiveClient({
    storage,
    idFactory: () => "SHOULD-NOT-START",
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ code: "CENTRE_STATE_NOT_CONFIGURED" }, 503);
    },
  });

  await assert.rejects(client.restoreOrStart(), /CENTRE_STATE_NOT_CONFIGURED/);
  assert.deepEqual(calls.map(item => item.action), ["inspect"]);
  assert.equal(storage.snapshot()[CENTRE_POINTER_KEY], original);
});

test("Centre client starts once then reads back the durable state before returning it", async () => {
  const { createCentreLiveClient, CENTRE_POINTER_KEY } = await import(moduleUrl + "?start=" + Date.now());
  const storage = memoryStorage();
  const calls = [];
  const client = createCentreLiveClient({
    storage,
    idFactory: () => "ID-1",
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(options.body);
      calls.push(input);
      if (input.action === "start") {
        return response({
          ok: true,
          phase: "ARRIVED",
          workId: "WORK-ID-1",
          checkpointId: "CENTRE-ID-1",
          returnAddress: "CENTRE-ID-1",
          work: { workId: "WORK-ID-1", checkpointId: "CENTRE-ID-1", status: "ARRIVED" },
        });
      }
      return response({
        ok: true,
        phase: "ARRIVED",
        workId: "WORK-ID-1",
        checkpointId: "CENTRE-ID-1",
        returnAddress: "CENTRE-ID-1",
        work: { workId: "WORK-ID-1", checkpointId: "CENTRE-ID-1", status: "ARRIVED", authority: null },
      });
    },
  });

  const work = await client.restoreOrStart();
  assert.equal(work.status, "ARRIVED");
  assert.deepEqual(calls.map(item => item.action), ["start", "inspect"]);
  assert.deepEqual(JSON.parse(storage.snapshot()[CENTRE_POINTER_KEY]), {
    workId: "WORK-ID-1",
    checkpointId: "CENTRE-ID-1",
  });
});

test("Centre mutation always performs exact durable readback", async () => {
  const { createCentreLiveClient } = await import(moduleUrl + "?command=" + Date.now());
  const calls = [];
  const client = createCentreLiveClient({
    storage: memoryStorage(),
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(options.body);
      calls.push(input);
      if (input.action === "review") {
        return response({
          ok: true, workId: "WORK-A", checkpointId: "CENTRE-A", returnAddress: "CENTRE-A",
          work: { workId: "WORK-A", checkpointId: "CENTRE-A", status: "READY", task: "T" },
        });
      }
      return response({
        ok: true, workId: "WORK-A", checkpointId: "CENTRE-A", returnAddress: "CENTRE-A",
        work: { workId: "WORK-A", checkpointId: "CENTRE-A", status: "READY", task: "T", authority: "BIG" },
      });
    },
  });

  const work = await client.command({
    action: "review",
    workId: "WORK-A",
    checkpointId: "CENTRE-A",
    returnAddress: "CENTRE-A",
    task: "T",
    requestedResult: "R",
    authority: "BIG",
  });

  assert.deepEqual(calls.map(item => item.action), ["review", "inspect"]);
  assert.equal(work.authority, "BIG");
});

test("Centre client fails closed when live readback is unavailable", async () => {
  const { createCentreLiveClient } = await import(moduleUrl + "?unavailable=" + Date.now());
  const client = createCentreLiveClient({
    storage: memoryStorage(),
    fetchImpl: async () => response({ code: "CENTRE_STATE_NOT_CONFIGURED" }, 503),
  });
  await assert.rejects(
    client.command({
      action: "review",
      workId: "WORK-A",
      checkpointId: "CENTRE-A",
      returnAddress: "CENTRE-A",
      task: "T",
      requestedResult: "R",
      authority: "BIG",
    }),
    /CENTRE_STATE_NOT_CONFIGURED/,
  );
});


test("Ticket Hub can explicitly start and inspect Centre Work without inventing local truth", async () => {
  const { createCentreLiveClient, CENTRE_POINTER_KEY } = await import(moduleUrl + "?ticket-hub=" + Date.now());
  const storage = memoryStorage();
  const calls = [];
  const client = createCentreLiveClient({
    storage,
    idFactory: () => "TICKET-1",
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(options.body);
      calls.push(input);
      if (input.action === "start") {
        return response({
          ok:true, workId:"WORK-TICKET-1", checkpointId:"CENTRE-TICKET-1",
          work:{ workId:"WORK-TICKET-1", checkpointId:"CENTRE-TICKET-1", status:"ARRIVED" },
        });
      }
      return response({
        ok:true, workId:input.workId, checkpointId:input.checkpointId,
        work:{ workId:input.workId, checkpointId:input.checkpointId, status:"ARRIVED" },
      });
    },
  });

  const started = await client.startNew();
  assert.equal(started.workId, "WORK-TICKET-1");
  const found = await client.inspect("WORK-FOUND", "CP-FOUND");
  assert.equal(found.workId, "WORK-FOUND");
  assert.deepEqual(calls.map(item => item.action), ["start", "inspect", "inspect"]);
  assert.deepEqual(JSON.parse(storage.snapshot()[CENTRE_POINTER_KEY]), {
    workId:"WORK-FOUND",
    checkpointId:"CP-FOUND",
  });
});

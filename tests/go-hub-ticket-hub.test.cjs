"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-ticket-hub.js")).href;

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    snapshot() { return Object.fromEntries(map); },
  };
}

test("Ticket Hub store keeps pointers only and never copies Work truth", async () => {
  const { TICKET_STORE_KEY, storeTicketPointer, readStoredTickets } = await import(moduleUrl + "?store=" + Date.now());
  const storage = memoryStorage();
  storeTicketPointer(storage, {
    workId:"WORK-1",
    checkpointId:"CP-1",
    task:"Build ticket point",
    status:"AWAY",
    authority:"BIG",
    handoff:{ destination:"destination://factory" },
  }, "จุดขายตั๋ว", () => "2026-10-01T00:00:00.000Z");

  const raw = JSON.parse(storage.snapshot()[TICKET_STORE_KEY]);
  assert.deepEqual(Object.keys(raw[0]).sort(), ["checkpointId","label","savedAt","workId"].sort());
  assert.equal(raw[0].status, undefined);
  assert.equal(raw[0].task, undefined);
  assert.equal(raw[0].authority, undefined);

  const stored = readStoredTickets(storage);
  assert.equal(stored[0].label, "จุดขายตั๋ว");
  assert.equal(stored[0].workId, "WORK-1");
});

test("Ticket Hub store replaces the same pointer instead of creating competing truth", async () => {
  const { storeTicketPointer, readStoredTickets } = await import(moduleUrl + "?dedupe=" + Date.now());
  const storage = memoryStorage();
  storeTicketPointer(storage, { workId:"WORK-1", checkpointId:"CP-1" }, "old", () => "2026-10-01T00:00:00.000Z");
  storeTicketPointer(storage, { workId:"WORK-1", checkpointId:"CP-1" }, "new", () => "2026-10-01T00:01:00.000Z");
  const stored = readStoredTickets(storage);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].label, "new");
});

test("Ticket Hub search matches label, Work ID, or Checkpoint ID", async () => {
  const { filterStoredTickets } = await import(moduleUrl + "?search=" + Date.now());
  const items = [
    { label:"จุดขายตั๋ว", workId:"WORK-TICKET", checkpointId:"CP-TICKET" },
    { label:"Map", workId:"WORK-MAP", checkpointId:"CP-MAP" },
  ];
  assert.equal(filterStoredTickets(items, "ขายตั๋ว").length, 1);
  assert.equal(filterStoredTickets(items, "WORK-MAP")[0].label, "Map");
  assert.equal(filterStoredTickets(items, "CP-TICKET")[0].workId, "WORK-TICKET");
});

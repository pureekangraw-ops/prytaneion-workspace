"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "go-hub-pixie-monitor.mjs"), "utf8");

test("Pixie monitor uses bounded backoff instead of fixed 15 second polling", () => {
  assert.match(source, /PIXIE_MONITOR_INITIAL_MS = 15_000/);
  assert.match(source, /PIXIE_MONITOR_MAX_MS = 120_000/);
  assert.match(source, /function nextMonitorDelay/);
  assert.match(source, /monitorAttempt/);
  assert.doesNotMatch(source, /Date\.now\(\) \+ PIXIE_MONITOR_MS/);
});

test("Pixie monitor keeps WAIT semantics and schedules follow-up alarms", () => {
  assert.match(source, /body\?\.status === "WAIT"/);
  assert.match(source, /setAlarm\(Date\.now\(\) \+ nextMonitorDelay/);
  assert.match(source, /status:"WATCHING"/);
});

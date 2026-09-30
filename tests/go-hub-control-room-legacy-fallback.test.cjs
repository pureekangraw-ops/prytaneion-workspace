"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "..", "go-hub-edge-worker.mjs"), "utf8");

test("Control Room falls back to legacy Centre inspect for an existing browser pointer", () => {
  const start = source.indexOf("async function controlRoomRead");
  assert.ok(start >= 0);
  const body = source.slice(start, start + 5000);

  assert.match(body, /action:"v4_inspect"/);
  assert.match(body, /unsupported Centre live action/);
  assert.match(body, /action:"inspect"/);

  const v4Index = body.indexOf('action:"v4_inspect"');
  const fallbackIndex = body.indexOf('action:"inspect"');
  assert.ok(v4Index >= 0 && fallbackIndex > v4Index, "legacy fallback must happen only after V4 inspect fails");
});

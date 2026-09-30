"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("project viewer is read-only and exposes Hub Factory Updates", () => {
  const html = read("project-viewer.html");
  const js = read("project-viewer.js");
  const manifest = JSON.parse(read("project-viewer.webmanifest"));
  const sw = read("go-hub-sw.js");

  assert.match(html, />HUB</);
  assert.match(html, />FACTORY</);
  assert.match(html, />UPDATES</);
  assert.match(html, /READ ONLY/);

  assert.match(js, /\/hub\/api\/centre\/control-room/);
  assert.match(js, /method:"GET"/);
  assert.doesNotMatch(js, /method:"POST"/);
  assert.doesNotMatch(js, /\/hub\/api\/centre\/action/);

  assert.equal(manifest.start_url, "/project-viewer.html");
  assert.equal(manifest.display, "standalone");
  assert.match(sw, /project-viewer\.html/);
  assert.match(sw, /project-viewer\.js/);
  assert.match(sw, /project-viewer\.css/);
});


test("project viewer translates strict UNKNOWN into CHECK without hiding evidence unknowns", () => {
  const js = read("project-viewer.js");
  assert.match(js, /function deriveViewerSummary/);
  assert.match(js, /status:"CHECK"/);
  assert.match(js, /หลักฐานบางรายการยัง UNKNOWN/);
  assert.match(js, /observations\.deploymentProvenance/);
  assert.match(js, /FACTORY_V4_NOT_FOUND/);
  assert.match(js, /status:"IDLE"/);
});

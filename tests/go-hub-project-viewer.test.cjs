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

  assert.match(js, /\/hub\/api\/centre\/project-viewer-status/);
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

test("project viewer global status does not depend on a local Work pointer", () => {
  const js = read("project-viewer.js");
  const edge = read("go-hub-edge-worker.mjs");
  const wrangler = JSON.parse(read("wrangler.go-hub.jsonc"));

  assert.match(js, /const GLOBAL_STATUS = "\/hub\/api\/centre\/project-viewer-status"/);
  assert.match(js, /const global = await fetchJson/);
  assert.match(js, /if \(!pointer\) \{/);
  assert.match(js, /renderNoLocalWork\(\)/);

  assert.match(edge, /PROJECT_VIEWER_STATUS_PATH/);
  assert.match(edge, /mode:"GLOBAL_PROJECT_VIEWER"/);
  assert.match(edge, /viewerVersion:"20260930-3"/);
  assert.ok(wrangler.assets.run_worker_first.includes("/hub/api/centre/*"));
});

test("project viewer keeps strict uncertainty in detail while top-level health is actionable", () => {
  const js = read("project-viewer.js");
  assert.match(js, /NORMAL/);
  assert.match(js, /CHECK/);
  assert.match(js, /ISSUE/);
  assert.match(js, /Local Work detail:/);
  assert.doesNotMatch(js, /renderNoPointer/);
});

test("project viewer cache-busts its browser assets so installed PWA sees fresh UI logic", () => {
  const html = read("project-viewer.html");
  assert.match(html, /project-viewer\.css\?v=20260930-3/);
  assert.match(html, /project-viewer\.js\?v=20260930-3/);
});

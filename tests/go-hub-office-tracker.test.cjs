"use strict";

const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const assert=require("node:assert/strict");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("Office home exposes a real Centre-backed work tracker",()=>{
  const gate=read("go-hub-office-gate.mjs");
  assert.match(gate,/data-work-tracker/);
  assert.match(gate,/data-work-form/);
  assert.match(gate,/data-work-list/);
  assert.match(gate,/data-work-active/);
  assert.match(gate,/data-work-waiting/);
  assert.match(gate,/data-work-done/);
  assert.match(gate,/ติดตามงานจริงจาก Centre/);
});

test("Office tracker reads owner truth and SPECTRUM requests governed Tablet actions without owning authority",()=>{
  const surface=read("go-hub-office-surface.js");
  assert.match(surface,/\/office\/api\/work\?/);
  assert.match(surface,/ygg-office-tracked-work-v1/);
  assert.match(surface,/cache:"no-store"/);
  assert.match(surface,/setInterval\([^]*30000\)/);
  assert.match(surface,/visibilitychange/);
  assert.match(surface,/\/office\/api\/command/);
  assert.match(surface,/action:"create_tablet"/);
  assert.match(surface,/action:"pickup_tablet"/);
  assert.match(surface,/source:"SPECTRUM_WORK"/);
  assert.doesNotMatch(surface,/open_pass|merge_pull_request|deploy/i);
});

test("Office tracker styles live status lanes for mobile and desktop",()=>{
  const css=read("go-hub-office-surface.css");
  assert.match(css,/\.office-work-card\[data-status="active"\]/);
  assert.match(css,/\.office-work-card\[data-status="waiting"\]/);
  assert.match(css,/\.office-work-card\[data-status="done"\]/);
  assert.match(css,/\.office-work-form/);
});

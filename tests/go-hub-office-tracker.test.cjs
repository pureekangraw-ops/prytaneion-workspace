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
  assert.match(gate,/data-overview-works/);
  assert.match(gate,/data-overview-results/);
  assert.match(gate,/data-overview-sales/);
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


test("Office degraded mode preserves cached reads without PRISM bypass",()=>{
  const surface=read("go-hub-office-surface.js");
  assert.match(surface,/ygg-office-work-cache-v1/);
  assert.match(surface,/ygg-office-eye-cache-v1/);
  assert.match(surface,/DEGRADED MODE/);
  assert.match(surface,/CACHED READ ONLY/);
  assert.match(surface,/NOT EXECUTED/);
  assert.doesNotMatch(surface,/office\/api\/prism|prism-control-port|PRISM_WORK_CONTEXT_REQUIRED/i);
});

test("Office sales readback shows every observed funnel stage as raw evidence counts",()=>{
  const surface=read("go-hub-office-surface.js");
  assert.match(surface,/events\.filter\(e=>e\.type==='CTA_CLICK'\)\.length/);
  assert.match(surface,/events\.filter\(e=>e\.type==='SERVICE_INTEREST'\)\.length/);
  assert.match(surface,/events\.filter\(e=>e\.type==='BRIEF_STARTED'\)\.length/);
  assert.match(surface,/เปิดหน้า '\+views\+' → กดเริ่ม '\+ctaClicks\+' → สนใจบริการ '\+interest\+' → เริ่มบรีฟ '\+started/);
  const sales=surface.slice(surface.indexOf('async function loadOverviewSales'),surface.indexOf('quoteForm?.addEventListener'));
  assert.doesNotMatch(sales,/conversion|อัตรา|เปอร์เซ็นต์|%/i);
});

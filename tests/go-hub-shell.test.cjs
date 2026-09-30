"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("GO Hub shell remains available directly while the root becomes Hub-owned", () => {
  for (const file of ["go-hub.html", "go-hub-shell.js", "go-hub-shell.css", "index.html", "normalpocket.html"]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
  }
  const rootHtml = read("index.html");
  assert.match(rootHtml, /go-hub-shell\.js/);
  assert.match(rootHtml, /go-hub-shell\.css/);
});

test("GO Hub shell loads only neutral Hub runtime modules", () => {
  const html = read("go-hub.html");
  assert.match(html, /go-hub-shell\.css/);
  assert.match(html, /go-hub-shell\.js/);
  for (const forbidden of [
    "normalpocket-bootstrap.js",
    "metropolis-r5.js",
    "app.js",
    "sw-bootstrap.js",
    "manifest.webmanifest",
  ]) {
    assert.equal(html.includes(forbidden), false, `Hub shell must not load ${forbidden}`);
  }
});

test("GO Hub shell bootstrap uses the neutral runtime registry", () => {
  const source = read("go-hub-shell.js");
  assert.match(source, /createHubRuntime/);
  assert.match(source, /go-hub-runtime\.js/);
  assert.doesNotMatch(source, /normalpocket/i);
  assert.doesNotMatch(source, /metropolis-r5/i);
});


test("idle GO Hub does not pre-bind any repository and opens a workspace only for explicit AWAY target", () => {
  const source = read("go-hub-shell.js");
  assert.match(source, /go-hub-work-targets\.js/);
  assert.match(source, /centreWork\?\.status === CENTRE_STATES\.AWAY/);
  assert.match(source, /repository: target\.repository/);
  assert.match(source, /key: `work:\$\{centreWork\.workId\}`/);
  assert.doesNotMatch(source, /repository:\s*"pureekangraw-ops\/standard-"/);
});

test("GO Hub shell mounts the six truths from the restored Code task projection", () => {
  const source = read("go-hub-shell.js");
  const goHubHtml = read("go-hub.html");
  const indexHtml = read("index.html");
  assert.match(source, /createWorkbenchView/);
  assert.match(source, /renderWorkbench\(taskSnapshot\(\)\)/);
  [
    "data-workbench-mission",
    "data-workbench-blueprint",
    "data-workbench-piece",
    "data-workbench-status",
    "data-workbench-evidence",
    "data-workbench-next",
  ].forEach((selector) => {
    assert.match(goHubHtml, new RegExp(selector));
    assert.match(indexHtml, new RegExp(selector));
  });
});


test("CENTRE is the live durable entry and exit gate before Code capability access", () => {
  const source = read("go-hub-shell.js");
  const htmlFiles = [read("index.html"), read("go-hub.html")];

  for (const marker of [
    "createCentreLiveClient",
    "await centreLive.restoreOrStart()",
    "admitDestination",
    "destination://factory",
    "createFactoryWorkContext",
    "runtime.register(\"Code\", createCodeCapability({ workspace, task, workContext }))",
    "runtime.unregister(\"Code\")",
    'action: "review"',
    'action: "fit"',
    'action: "leave"',
    'action: "return"',
  ]) {
    assert.equal(source.includes(marker), true, `shell must include ${marker}`);
  }
  assert.doesNotMatch(source, /namespace:\s*"go-hub-centre"/);
  assert.doesNotMatch(source, /createCentreSession/);

  for (const html of htmlFiles) {
    for (const marker of [
      "data-centre-state",
      "data-centre-checkpoint",
      "data-centre-work",
      "data-centre-form",
      "data-centre-action",
      "data-centre-return",
    ]) {
      assert.equal(html.includes(marker), true, `Centre surface must include ${marker}`);
    }
  }
});

test("active shell must pass Optician and canonical city route before leaving Centre for Factory", () => {
  const source = read("go-hub-shell.js");

  assert.match(source, /go-hub-optician\.js/);
  assert.match(source, /go-hub-city-route\.js/);
  assert.match(source, /fitWork/);
  assert.match(source, /routeInbound/);
  assert.match(source, /fit\.gate !== "PASS"/);
  assert.match(source, /route\.destination !== "go-work-loop"/);
  assert.match(source, /action:\s*"leave"/);

  const fitIndex = source.indexOf("fitWork(");
  const routeIndex = source.indexOf("routeInbound(");
  const leaveIndex = source.indexOf('action: "leave"');
  assert.ok(fitIndex >= 0 && routeIndex > fitIndex && leaveIndex > routeIndex,
    "Optician fit and city route must run before live Centre handoff");
});


test("Centre Review is not blocked by fit-only Persona fields", () => {
  for (const html of [read("index.html"), read("go-hub.html")]) {
    assert.match(html, /name="personaReference"/);
    assert.match(html, /name="workingView"/);
    assert.doesNotMatch(html, /name="personaReference"[^>]*required/);
    assert.doesNotMatch(html, /name="workingView"[^>]*required/);
  }

  const source = read("go-hub-shell.js");
  assert.match(source, /\["personaReference", "workingView"\]\.forEach/);
  assert.match(source, /field\(name\)\.required = reviewed && !fitted/);
  assert.match(source, /action:\s*"fit"/);
  assert.match(source, /CENTRE_STATES\.READY && !centreWork\.persona/);
});


test("Centre boots before any Workbench restore and remains the authority for target binding", () => {
  const source = read("go-hub-shell.js");
  const centreIndex = source.indexOf("await centreLive.restoreOrStart()");
  const ensureIndex = source.indexOf("await ensureWorkbenchForCentre()");
  const loadIndex = source.indexOf("task = await taskSession.load()");
  const renderIndex = source.lastIndexOf("render();");

  assert.ok(centreIndex >= 0, "Centre must restore");
  assert.ok(ensureIndex > centreIndex, "Workbench decision must happen after Centre restore");
  assert.ok(loadIndex > centreIndex, "Code task cannot load before Centre truth");
  assert.ok(renderIndex > ensureIndex, "shell renders after target-aware Workbench decision");
  assert.match(source, /WORKBENCH_TARGET_MISMATCH/);
  assert.match(source, /WORK_TARGET_REQUIRED/);
  assert.match(source, /renderCentre\(\)/);
});

test("Workbench target failure never silently opens Factory capability", () => {
  const source = read("go-hub-shell.js");
  assert.match(source, /if \(!target\) \{/);
  assert.match(source, /if \(runtime\.get\("Code"\)\) runtime\.unregister\("Code"\)/);
  assert.match(source, /assertWorkbenchReady\(\);/);
  assert.match(source, /state: "IDLE"/);
  assert.match(source, /"next-action": "NO ACTIVE WORK"/);
});

test("owner must choose a Work Target explicitly and LIGHTHOUSE is available without being selected by default", () => {
  for (const html of [read("index.html"), read("go-hub.html")]) {
    assert.match(html, /name="targetId" required/);
    assert.match(html, /<option value="">Choose target<\/option>/);
    assert.match(html, /<option value="lighthouse">LIGHTHOUSE<\/option>/);
    assert.doesNotMatch(html, /<option value="lighthouse"[^>]*selected/);
    assert.match(html, /data-centre-target/);
  }
});


test("Counter surface exposes one GO-LIGHT route and keeps Notion search explicitly separate", () => {
  const source = read("go-hub-shell.js");
  for (const html of [read("index.html"), read("go-hub.html")]) {
    const start = html.indexOf('<section class="counter-panel"');
    const end = html.indexOf('<section class="go-workbench"', start);
    const counter = html.slice(start, end);
    assert.match(counter, /GO ↔ LIGHT — COUNTER ONLY/);
    assert.match(counter, /Notion AI Search — direct capability, not LIGHT/);
    assert.match(counter, /data-counter-conversation/);
    assert.match(counter, /data-counter-ask-form/);
    assert.match(counter, /data-counter-question/);
    assert.match(counter, /NOTION AI SEARCH — ค้นของในคลังเท่านั้น · ไม่ใช่ LIGHT/);
    assert.match(counter, /Enter = ถาม/);
    assert.match(counter, /เปิด GO × LIGHT ใน Notion/);
    assert.doesNotMatch(counter, /<button|data-counter-inbox|data-counter-pickup|Work<\/dt>|Checkpoint<\/dt>|🔔|🪞|Mirror/);
  }
  const start = source.indexOf('const counterAskForm');
  const end = source.indexOf('centreForm?.addEventListener', start);
  const counter = source.slice(start, end);
  assert.match(counter, /\/hub\/api\/counter\/ask/);
  assert.match(counter, /async function searchNotion/);
  assert.match(counter, /appendCounterMessage\("NOTION"/);
  assert.doesNotMatch(counter, /async function askLight/);
  assert.match(counter, /event\.key !== "Enter"/);
  assert.match(counter, /event\.shiftKey/);
  assert.doesNotMatch(counter, /\/hub\/api\/counter\/inbox|\/hub\/api\/counter\/pickup|refreshCounterInbox|counterInbox|centreWork\?\.workId/);
});


test("Centre includes a thin persistent GO Identity Installer dressing room", () => {
  for (const html of [read("index.html"), read("go-hub.html")]) {
    assert.match(html, /GO IDENTITY INSTALLER/);
    assert.match(html, /data-dressing-room/);
    assert.match(html, /data-dressing-status/);
    assert.match(html, /data-dressing-rule/);
    assert.match(html, /ทาบบัตร = อ่าน\/ฉายข้อมูลเท่านั้น/);
    assert.match(html, /ไม่สั่งงาน/);
    assert.match(html, /ไม่เปลี่ยน state/);
    assert.match(html, /ไม่เปิด\/ปิดสิทธิ์/);
    assert.match(html, /ไม่บล็อกทาง/);
    assert.equal((html.match(/data-dressing-core/g) || []).length, 5);
    assert.match(html, /data-dressing-lesson/);
    assert.match(html, /data-dressing-add/);
    assert.match(html, /data-dressing-lessons/);
    assert.match(html, /name="personaReference"/);
    assert.match(html, /name="workingView"/);
  }

  const source = read("go-hub-shell.js");
  assert.match(source, /DRESSING_STORAGE_KEY/);
  assert.match(source, /go-hub:dressing-room:v1/);
  assert.match(source, /readDressingState/);
  assert.match(source, /saveDressingState/);
  assert.match(source, /addDressingLesson/);
  assert.match(source, /slice\(-200\)/);
});

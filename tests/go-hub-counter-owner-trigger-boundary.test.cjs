"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("Counter UI clearly separates the GO-LIGHT Counter route from direct Notion search", () => {
  const html = fs.readFileSync("go-hub.html", "utf8");
  const shell = fs.readFileSync("go-hub-shell.js", "utf8");
  const start = html.indexOf('<section class="counter-panel"');
  const end = html.indexOf('<section class="go-workbench"', start);
  const counter = html.slice(start, end);

  assert.match(counter, /GO ↔ LIGHT — COUNTER ONLY/);
  assert.match(counter, /data-counter-conversation/);
  assert.match(counter, /data-counter-question/);
  assert.match(counter, /เปิด GO × LIGHT ใน Notion/);
  assert.doesNotMatch(counter, /<button|data-counter-inbox|data-counter-pickup|data-counter-work|data-counter-checkpoint|🔔|🪞|Mirror/);

  assert.match(shell, /\/hub\/api\/counter\/ask/);
  assert.match(shell, /async function searchNotion/);
  assert.match(shell, /appendCounterMessage\("NOTION"/);
  assert.doesNotMatch(shell, /async function askLight/);
  assert.match(shell, /event\.key !== "Enter"/);
  assert.doesNotMatch(shell, /\/hub\/api\/counter\/mirror|counterMirrorBell|counterLightBell|refreshCounterInbox|counterInbox|🔔|🪞/);
});

test("direct Notion search shortcut stays explicitly outside GO-LIGHT Counter SEARCH transport", () => {
  const edge = fs.readFileSync("go-hub-edge-worker.mjs", "utf8");
  const askStart = edge.indexOf('url.pathname === `${COUNTER_API_ROOT}/ask`');
  const inboxStart = edge.indexOf('url.pathname === `${COUNTER_API_ROOT}/inbox`', askStart);
  const handoffStart = edge.indexOf('url.pathname === `${COUNTER_API_ROOT}/handoff`');
  assert.ok(askStart >= 0 && inboxStart > askStart && handoffStart > inboxStart);

  const ask = edge.slice(askStart, inboxStart);
  assert.match(ask, /createNotionLightService/);
  assert.match(ask, /\.search\(\{ query:question \}\)/);
  assert.doesNotMatch(ask, /mode:"SEARCH"|v4_inspect|workId|checkpointId/);
  assert.doesNotMatch(edge, /COUNTER_API_ROOT}\/mirror/);
});

test("HANDOFF source has no automatic LIGHT Bell or HANDOFF wake adapter", () => {
  const dispatcher = fs.readFileSync("go-hub-counter-dispatcher.mjs", "utf8");
  assert.doesNotMatch(dispatcher, /bellType:"LIGHT_HANDOFF"/);
  assert.doesNotMatch(dispatcher, /notion-light-bell-inbox|notion-light-counter-bell/);
  assert.doesNotMatch(dispatcher, /light-counter-handoff-wake/);
  assert.match(dispatcher, /triggerRequired:target === "LIGHT"/);
});

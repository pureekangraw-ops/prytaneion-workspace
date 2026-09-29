"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("LIGHTHOUSE deploy smoke retries propagation failures without weakening the access guard", () => {
  const workflow = fs.readFileSync(".github/workflows/go-hub-deploy.yml", "utf8");
  assert.match(workflow, /retryableStatus = status => status === 409 \|\| status === 425 \|\| status === 429 \|\| status >= 500/);
  assert.match(workflow, /const runtimeFetch = async \(url, init = \{\}\) =>/);
  assert.match(workflow, /const roomResponse = await runtimeFetch\(roomUrl/);
  assert.match(workflow, /const realityResponse = await runtimeFetch\(/);
  assert.match(workflow, /const reentered = await runtimeFetch\(roomUrl/);
  assert.match(workflow, /const denied = await fetch\(origin \+ "\/hub\/lighthouse"/);
  assert.match(workflow, /denied\.status !== 403/);
});


test("V4 deploy smoke outfits the existing Work with current HERMES card contracts", () => {
  const workflow = fs.readFileSync(".github/workflows/go-hub-deploy.yml", "utf8");
  assert.match(workflow, /action:"v4_mission_enter"/);
  assert.match(workflow, /action:"v4_mission_recommended_tools"/);
  assert.match(workflow, /action:"v4_mission_card_prepare"/);
  assert.match(workflow, /action:"v4_mission_card_issue"/);
  assert.match(workflow, /accessScope:"WORK"/);
  assert.match(workflow, /accessScope:"MAINTENANCE"/);
  assert.match(workflow, /action:"v4_inspect", workId, checkpointId, workContext:context\(\)/);
  assert.match(workflow, /kind:"MAINTENANCE", destinations:\["maintenance"\]/);
  assert.doesNotMatch(workflow, /mcp\("\/mcp\/light"/);
});


test("all post-deploy governed smoke calls stay bound to one WorkContext", () => {
  const workflow = fs.readFileSync(".github/workflows/go-hub-deploy.yml", "utf8");
  assert.match(workflow, /const governedArgs = \{/);
  assert.match(workflow, /workContext:args\?\.workContext \|\| context\(\)/);
  assert.match(workflow, /params:\{ name, arguments:governedArgs \}/);
  assert.match(workflow, /"go_hub_observer_latest",[\s\S]*"go_hub_drive_health"/);
  assert.match(workflow, /name: "go_hub_observer_latest", arguments: \{ workContext \}/);
  assert.match(workflow, /name: "go_hub_drive_health", arguments: \{ workContext \}/);
  assert.doesNotMatch(workflow, /name: "go_hub_observer_latest", arguments: \{\}/);
  assert.doesNotMatch(workflow, /name: "go_hub_drive_health", arguments: \{\}/);
});

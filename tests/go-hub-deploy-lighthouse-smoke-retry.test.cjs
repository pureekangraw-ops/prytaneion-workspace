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
  assert.match(workflow, /action:"v4_inspect", workId, checkpointId/);
  assert.doesNotMatch(workflow, /go_hub_centre_live_action"[\s\S]{0,180}workContext:context\(\)/);
  assert.match(workflow, /kind:"MAINTENANCE"[\s\S]*destinations:\["maintenance"\]/);
  assert.doesNotMatch(workflow, /mcp\("\/mcp\/light"/);
});


test("post-deploy smoke respects each tool's declared contract instead of injecting WorkContext", () => {
  const workflow = fs.readFileSync(".github/workflows/go-hub-deploy.yml", "utf8");
  assert.match(workflow, /const governedArgs = \{ \.\.\.\(args \|\| \{\}\) \};/);
  assert.doesNotMatch(workflow, /workContext:args\?\.workContext \|\| context\(\)/);
  assert.match(workflow, /params:\{ name, arguments:governedArgs \}/);
  assert.match(workflow, /go_hub_maintenance"[\s\S]{0,1400}workContext:context\(\)/);
  assert.match(workflow, /go_hub_factory_v4"[\s\S]{0,300}workContext:context\(\)/);
  assert.match(workflow, /go_hub_heimdall_pass"[\s\S]{0,300}workContext:context\(\)/);
  assert.doesNotMatch(workflow, /go_hub_centre_live_action"[\s\S]{0,180}workContext:context\(\)/);
});


test("maintenance deploy smoke carries bounded BIG-approved repair scope", () => {
  const workflow = fs.readFileSync(".github/workflows/go-hub-deploy.yml", "utf8");
  assert.match(workflow, /kind:"MAINTENANCE"/);
  assert.match(workflow, /ownerApproval:"BIG_APPROVED"/);
  assert.match(workflow, /repairScope:\["production runtime owner-binding route verification"\]/);
});


test("post-V4 Observer and Drive remain on the exact smoke Work card", () => {
  const workflow = fs.readFileSync(".github/workflows/go-hub-deploy.yml", "utf8");
  const match = workflow.match(/const workCardTools = \[([\s\S]*?)\n\s*\];/);
  assert.ok(match, "workCardTools block must exist");
  assert.match(match[1], /"go_hub_observer_latest"/);
  assert.match(match[1], /"go_hub_drive_health"/);
});

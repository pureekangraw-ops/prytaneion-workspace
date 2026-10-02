"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.resolve(__dirname,"..","go-hub-mcp-registry.mjs"),"utf8");

test("registry does not rewrite capability contracts while Work contracts remain gate-aware",()=>{
  assert.doesNotMatch(source,/optionalWorkContext/);
  assert.doesNotMatch(source,/inputSchema\.properties\.workContext\s*=\s*workContext/);
  assert.doesNotMatch(source,/required\.push\("workContext"\)/);
  assert.match(source,/definitionUsesWorkContext\(definition\)/);
  assert.match(source,/go_hub_agent_persona_room[^\n]+schema\(\{ action:[^\n]+\}, \["action"\]\)/);
  assert.match(source,/go_hub_agent_lens_room[^\n]+schema\(\{ action:[^\n]+\}, \["action"\]\)/);
  assert.match(source,/go_hub_agent_fitting_room[^\n]+schema\(\{ action:[^\n]+\}, \["action"\]\)/);
});

test("backend policy reads Centre truth and keeps Maintenance as the scope exception",()=>{
  const start=source.indexOf("function backendPolicyDecision");
  const end=source.indexOf("function assertLifecycle",start);
  const guard=source.slice(start,end);
  assert.match(guard,/toolName === "go_hub_maintenance"/);
  assert.match(guard,/work\?\.accessScope/);
  assert.match(guard,/"MAINTENANCE"/);
  assert.match(guard,/work\?\.toolAccess|work\.toolAccess/);
  assert.match(guard,/lifecycle\.centreInspect/);
  assert.doesNotMatch(guard,/agentMission/);
});

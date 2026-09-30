"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.resolve(__dirname,"..","go-hub-mcp-registry.mjs"),"utf8");

test("read-only reality sensors stay outside Work Tablet enforcement",()=>{
  assert.match(source,/enforceCardAccess && !optionalWorkContext\.has\(name\)/);
});

test("direct Work Tablet gate reads Centre truth and keeps Maintenance as the scope exception",()=>{
  const start=source.indexOf("function tabletToolAllowed");
  const end=source.indexOf("function assertLifecycle",start);
  const guard=source.slice(start,end);
  assert.match(guard,/toolName === "go_hub_maintenance"/);
  assert.match(guard,/work\?\.accessScope/);
  assert.match(guard,/"MAINTENANCE"/);
  assert.match(guard,/work\?\.toolAccess|work\.toolAccess/);
  assert.match(guard,/lifecycle\.centreInspect/);
  assert.doesNotMatch(guard,/lifecycle\.agentMission/);
});

"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.resolve(__dirname,"..","go-hub-mcp-registry.mjs"),"utf8");

test("read-only reality sensors stay outside room-entry card enforcement",()=>{
  assert.match(source,/enforceCardAccess && !optionalWorkContext\.has\(name\)/);
});

test("governed room entrance keeps Maintenance scope as the only access_scope exception",()=>{
  const start=source.indexOf("function cardToolAllowed");
  const end=source.indexOf("async function assertCardAccess",start);
  const guard=source.slice(start,end);
  assert.match(guard,/toolName === "go_hub_maintenance"/);
  assert.match(guard,/card\?\.access_scope/);
  assert.match(guard,/"MAINTENANCE"/);
  assert.match(guard,/card\.tool_access/);
});

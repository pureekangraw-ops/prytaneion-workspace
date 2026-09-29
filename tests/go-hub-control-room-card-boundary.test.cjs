"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.resolve(__dirname,"..","go-hub-mcp-registry.mjs"),"utf8");

test("read-only reality sensors stay outside room-entry card enforcement",()=>{
  assert.match(source,/enforceCardAccess && !optionalWorkContext\.has\(name\)/);
});

test("governed room entrance reads only Current Card tool_access",()=>{
  const start=source.indexOf("function cardToolAllowed");
  const end=source.indexOf("async function assertCardAccess",start);
  const guard=source.slice(start,end);
  assert.match(guard,/card\.tool_access/);
  assert.doesNotMatch(guard,/access_scope|MAINTENANCE/);
});

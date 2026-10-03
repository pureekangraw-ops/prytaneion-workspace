"use strict";
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");
const assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");

test("PRISM mobile workspace manifest references local tools that exist",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"prism-workspace-manifest.json"),"utf8"));
  assert.equal(manifest.schemaVersion,"prism-workspace-manifest-v1");
  const local=manifest.tools.filter(tool=>tool.class==="LOCAL");
  assert.ok(local.length>=5);
  for(const tool of local){
    assert.equal(fs.existsSync(path.join(root,tool.source)),true,tool.id+" source missing: "+tool.source);
  }
});

test("PRISM recovery policy never restores raw secrets or central authority",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"prism-workspace-manifest.json"),"utf8"));
  assert.equal(manifest.recoveryPolicy.secrets,"REISSUE_NOT_RESTORE");
  assert.equal(manifest.recoveryPolicy.governedTruth,"CENTRAL_ONLY");
  assert.ok(manifest.sync.exclude.includes("sessionToken"));
  assert.ok(manifest.sync.exclude.includes("passkeyPrivateMaterial"));
  assert.ok(manifest.sync.exclude.includes("accessToken"));
});

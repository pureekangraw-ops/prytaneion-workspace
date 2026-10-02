"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

async function adapterMod(){return import("../go-hub-aion-olympus-adapter.mjs?test="+Date.now());}

test("OLYMPUS AION adapter preserves VERIFIED target and never executes",async()=>{
  const {createOlympusAionAdapter}=await adapterMod();
  let seen=null;
  const adapter=createOlympusAionAdapter({
    endpoint:"https://olympus.example",
    fetchImpl:async(url,init)=>{
      seen={url,init};
      return Response.json({
        appId:"prism",version:"1",sourceRevision:"rev",artifactSha:"sha",destination:"PRISM_NATIVE",
        target:"app://prism-owner",releaseTruthRef:"truth://prism",verifiedAt:"NOW",status:"VERIFIED",
        reason:"OLYMPUS_TRUTH_MATCHED",unknowns:[],
      });
    },
  });
  const result=await adapter.resolve({appId:"prism",version:"1",sourceRevision:"rev",artifactSha:"sha",destination:"PRISM_NATIVE"});
  assert.equal(seen.url,"https://olympus.example/aion/resolve");
  assert.equal(seen.init.method,"POST");
  assert.equal(result.status,"VERIFIED");
  assert.equal(result.target,"app://prism-owner");
  assert.equal(result.releaseTruthRef,"truth://prism");
  assert.equal(result.source,"OLYMPUS");
  assert.equal(result.authority,"OLYMPUS_RELEASE_MANIFEST_V1");
  assert.equal(result.executed,false);
  assert.equal(result.authorityCreated,false);
  assert.equal(result.routeSelected,false);
});

test("OLYMPUS AION adapter strips target for stale mismatch and unknown",async()=>{
  const {createOlympusAionAdapter}=await adapterMod();
  for(const status of ["STALE","MISMATCH","UNKNOWN"]){
    const adapter=createOlympusAionAdapter({fetchImpl:async()=>Response.json({
      appId:"prism",version:"1",sourceRevision:"rev",artifactSha:"sha",destination:"PRISM_NATIVE",
      target:"app://must-not-leak",releaseTruthRef:"truth://must-not-leak",status,
    })});
    const result=await adapter.resolve({appId:"prism",version:"1",sourceRevision:"rev",artifactSha:"sha",destination:"PRISM_NATIVE"});
    assert.equal(result.status,status);
    assert.equal(result.target,null);
    assert.equal(result.releaseTruthRef,null);
  }
});

test("OLYMPUS AION adapter fails UNKNOWN-safe when upstream is unavailable",async()=>{
  const {createOlympusAionAdapter}=await adapterMod();
  const adapter=createOlympusAionAdapter({fetchImpl:async()=>{throw new Error("down");}});
  const result=await adapter.resolve({appId:"prism",version:"1",sourceRevision:"rev",artifactSha:"sha",destination:"PRISM_NATIVE"});
  assert.equal(result.status,"UNKNOWN");
  assert.equal(result.reason,"OLYMPUS_AION_UNREACHABLE");
  assert.equal(result.target,null);
  assert.equal(result.releaseTruthRef,null);
});

test("MCP publishes OLYMPUS compatibility tools while legacy AION open remains unchanged",async()=>{
  const {createMcpRegistry}=await import("../go-hub-mcp-registry.mjs?compat="+Date.now());
  const lifecycle={
    aionResolve:async(input)=>Response.json({ok:true,source:"OLYMPUS",status:"VERIFIED",target:"app://prism-owner",input}),
    aionRegistry:async()=>Response.json({ok:true,source:"OLYMPUS",entries:[]}),
  };
  const registry=createMcpRegistry({lifecycle});
  const names=registry.listTools().map(x=>x.name);
  assert.ok(names.includes("go_hub_aion_open"));
  assert.ok(names.includes("go_hub_aion_resolve"));
  assert.ok(names.includes("go_hub_aion_registry"));
  const resolved=(await registry.callTool("go_hub_aion_resolve",{appId:"prism",version:"1",sourceRevision:"rev",artifactSha:"sha",destination:"PRISM_NATIVE"})).structuredContent;
  assert.equal(resolved.source,"OLYMPUS");
  assert.equal(resolved.status,"VERIFIED");
  assert.equal(resolved.target,"app://prism-owner");
});

"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url");
const path=require("node:path");
const mod=f=>import(pathToFileURL(path.join(process.cwd(),f)).href+"?centre-resolve="+Date.now()+Math.random());

test("Centre resolver does exact -> nearby -> create-new only when empty",async()=>{
  const {resolveCentreWork}=await mod("go-hub-centre-resolver.mjs");
  const works=[
    {workId:"WORK-ALPHA",checkpointId:"CP-WORK-ALPHA",jobCode:"ALPHA-01",name:"Build Spectrum counter",command:"Connect Spectrum to Counter",status:"ON PROCESS",workType:"NORMAL"},
    {workId:"WORK-BETA",checkpointId:"CP-WORK-BETA",jobCode:"BETA-01",name:"Office surface",command:"Build office status page",status:"OPEN",workType:"NORMAL"},
  ];
  const exact=resolveCentreWork(works,{workId:"WORK-ALPHA"});
  assert.equal(exact.status,"RESOLVED");
  assert.equal(exact.work.workId,"WORK-ALPHA");
  assert.equal(exact.createAllowed,false);

  const nearby=resolveCentreWork(works,{query:"spectrum counter"});
  assert.equal(nearby.status,"NEARBY");
  assert.equal(nearby.candidates[0].workId,"WORK-ALPHA");
  assert.equal(nearby.createAllowed,false);

  const missing=resolveCentreWork(works,{query:"totally unrelated lunar garden"});
  assert.equal(missing.status,"NOT_FOUND");
  assert.equal(missing.createAllowed,true);
});

test("Centre resolver refuses empty lookup",async()=>{
  const {resolveCentreWork}=await mod("go-hub-centre-resolver.mjs");
  assert.throws(()=>resolveCentreWork([],{}),/CENTRE_RESOLVE_QUERY_REQUIRED/);
});

test("MCP exposes pre-Work Centre resolve without WorkContext",async()=>{
  const {createMcpRegistry}=await mod("go-hub-mcp-registry.mjs");
  const calls=[];
  const lifecycle=new Proxy({}, {get:(_,name)=>async input=>{calls.push({name,input});return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json"}});}});
  const registry=createMcpRegistry({lifecycle});
  const tool=registry.listTools().find(x=>x.name==="go_hub_centre_resolve");
  assert.ok(tool);
  assert.equal((tool.inputSchema.required||[]).includes("workContext"),false);
  await registry.callTool("go_hub_centre_resolve",{query:"Spectrum"});
  assert.equal(calls.at(-1).name,"centreResolve");
});

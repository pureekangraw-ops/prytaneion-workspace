"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const{pathToFileURL}=require("node:url");
const root=path.resolve(__dirname,"..");
const workerUrl=pathToFileURL(path.join(root,"go-hub-edge-worker.mjs")).href;
async function load(tag){return import(`${workerUrl}?observer-worker=${tag}-${Date.now()}`)}
function delegate(){return{async fetch(){return new Response("delegated",{status:202})}}}
function mcp(){return{async fetch(){return new Response("mcp")}}}
function env(){return{GOHUB_OWNER_PASSCODE:"owner-secret",BROWSER_POLICY:{allowedHostnames:["gumroad.com","*.gumroad.com"],requireOwnerPasscode:true}}}

test("legacy Browser Observer owner and API routes are retired fail-closed",async()=>{
  const{createEdgeWorkerHandler}=await load("retired");
  const handler=createEdgeWorkerHandler({delegate:delegate(),factoryMcp:mcp()});
  for(const [url,method] of [
    ["https://hub.example/hub/observer","GET"],
    ["https://hub.example/hub/api/browser/observer/session/start","POST"],
    ["https://hub.example/hub/api/browser/observer/snapshot","POST"],
    ["https://hub.example/hub/api/browser/observer/session/stop","POST"],
    ["https://hub.example/hub/api/browser/observer/screenshot/consent","POST"],
  ]){
    const response=await handler.fetch(new Request(url,{method,headers:{"content-type":"application/json"},body:method==="POST"?"{}":undefined}),env());
    assert.equal(response.status,410);
    assert.deepEqual(await response.json(),{code:"LEGACY_OBSERVER_RETIRED",canonical:"FACTORY_EYE",canonicalPath:"/hub/api/factory-eye"});
  }
});

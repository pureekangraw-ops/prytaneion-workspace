"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");
const {webcrypto}=require("node:crypto");
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const moduleUrl=pathToFileURL(path.resolve(__dirname,"../go-hub-edge-worker.mjs")).href;

function bucket(){
  const map=new Map();
  return {
    async put(key,body,options={}){
      const bytes=body instanceof Uint8Array?body:new Uint8Array(body);
      const record={
        key,body:new Uint8Array(bytes),size:bytes.byteLength,etag:"e1",uploaded:new Date(),
        httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{},
      };
      map.set(key,record);return record;
    },
    async get(key){
      const r=map.get(key); if(!r)return null;
      return {...r,body:new Response(r.body).body};
    },
    async head(key){return map.get(key)||null},
  };
}

test("Centre object route fails closed without owner auth",async()=>{
  const {createEdgeWorkerHandler}=await import(moduleUrl+"?auth="+Date.now());
  const handler=createEdgeWorkerHandler({
    delegate:{fetch:async()=>new Response("delegate",{status:418})},
    factoryMcp:{fetch:async()=>new Response("mcp")},
  });
  const response=await handler.fetch(
    new Request("https://hub.example/hub/api/centre/object?workId=W&checkpointId=C&objectId=x",{method:"HEAD"}),
    {GO_HUB_CENTRE_OBJECTS:bucket()}
  );
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{code:"CENTRE_OBJECT_OWNER_AUTH_NOT_CONFIGURED"});
});

test("Centre object route stores and reads through R2 binding with owner auth",async()=>{
  const {createEdgeWorkerHandler}=await import(moduleUrl+"?r2="+Date.now());
  const store=bucket();
  const handler=createEdgeWorkerHandler({
    delegate:{fetch:async()=>new Response("delegate",{status:418})},
    factoryMcp:{fetch:async()=>new Response("mcp")},
  });
  const env={GOHUB_OWNER_PASSCODE:"owner-secret",GO_HUB_CENTRE_OBJECTS:store};
  const headers={
    "x-go-owner-passcode":"owner-secret",
    "x-centre-work-id":"WORK-1",
    "x-centre-checkpoint-id":"CP-1",
    "x-centre-object-id":"brief.txt",
    "content-type":"text/plain",
  };
  const put=await handler.fetch(new Request("https://hub.example/hub/api/centre/object",{method:"PUT",headers,body:"hello-r2"}),env);
  assert.equal(put.status,201);
  const written=await put.json();
  assert.equal(written.objectKey,"centre/WORK-1/CP-1/brief.txt");
  assert.equal(written.size,8);

  const get=await handler.fetch(new Request(
    "https://hub.example/hub/api/centre/object?workId=WORK-1&checkpointId=CP-1&objectId=brief.txt",
    {headers:{"x-go-owner-passcode":"owner-secret"}}
  ),env);
  assert.equal(get.status,200);
  assert.equal(await get.text(),"hello-r2");
  assert.match(get.headers.get("x-centre-sha256")||"",/^[a-f0-9]{64}$/);
});

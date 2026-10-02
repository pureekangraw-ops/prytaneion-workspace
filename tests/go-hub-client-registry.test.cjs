"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {pathToFileURL}=require("node:url");

const moduleUrl=pathToFileURL(path.resolve(__dirname,"../go-hub-client-registry.mjs")).href;

function storage(){
  const map=new Map();
  return {
    async get(key){return map.get(key)},
    async put(key,value){map.set(key,value)},
  };
}

test("Client Registry upserts one durable client and preserves firstSeenAt",async()=>{
  const {GoHubClientRegistryState}=await import(moduleUrl+"?upsert="+Date.now());
  const state=new GoHubClientRegistryState({storage:storage()});
  const first=await state.fetch(new Request("https://client-registry.internal/upsert",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      clientId:"CLIENT-1",
      conversationId:"CONV-1",
      latestText:"hello",
      interpreted:{intent:"START",wantsEstimate:false,wantsManager:false,clientConfirmedComplete:false},
      at:"2026-10-03T00:00:00.000Z"
    })
  }));
  assert.equal(first.status,201);

  const second=await state.fetch(new Request("https://client-registry.internal/upsert",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      clientId:"CLIENT-1",
      conversationId:"CONV-2",
      latestText:"second",
      interpreted:{intent:"PRICE",wantsEstimate:true,wantsManager:false,clientConfirmedComplete:false},
      at:"2026-10-03T00:05:00.000Z"
    })
  }));
  assert.equal(second.status,200);

  const listed=await state.fetch(new Request("https://client-registry.internal/list?limit=50"));
  const body=await listed.json();
  assert.equal(body.count,1);
  assert.equal(body.clients[0].clientId,"CLIENT-1");
  assert.equal(body.clients[0].conversationId,"CONV-2");
  assert.equal(body.clients[0].latestText,"second");
  assert.equal(body.clients[0].firstSeenAt,"2026-10-03T00:00:00.000Z");
  assert.equal(body.clients[0].interpreted.intent,"PRICE");
});

test("Client Registry rejects records without stable identity",async()=>{
  const {GoHubClientRegistryState}=await import(moduleUrl+"?invalid="+Date.now());
  const state=new GoHubClientRegistryState({storage:storage()});
  const response=await state.fetch(new Request("https://client-registry.internal/upsert",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({conversationId:"CONV-1"})
  }));
  assert.equal(response.status,400);
  assert.deepEqual(await response.json(),{code:"CLIENT_ID_REQUIRED"});
});

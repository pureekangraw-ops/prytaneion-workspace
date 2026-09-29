"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const{pathToFileURL}=require("node:url");

const workerUrl=pathToFileURL(path.resolve(__dirname,"..","go-hub-edge-worker.mjs")).href;
async function load(tag){return import(workerUrl+"?factory-eye-worker="+tag+"-"+Date.now())}
function delegate(){return{async fetch(){return new Response("delegated",{status:202})}}}
function mcp(){return{async fetch(){return new Response("mcp")}}}

function factoryNamespace(calls){
  return{
    getByName(name){
      assert.equal(name,"ergasterion-factory-eye-v1");
      return{
        async fetch(request){
          const input=await request.json();
          calls.push([new URL(request.url).pathname,input]);
          const path=new URL(request.url).pathname;
          if(path==="/start") return new Response(JSON.stringify({
            ok:true,session_id:"S1",session_token:"T1",expires_at:999999,adapter_id:input.adapterId,creates_authority:false,
          }),{headers:{"content-type":"application/json"}});
          if(path==="/register") return new Response(JSON.stringify({ok:true,adapter:{adapterId:input.adapterId}}),{headers:{"content-type":"application/json"}});
          if(path==="/commands") return new Response(JSON.stringify({ok:true,commands:[],capability:"EYES_ONLY"}),{headers:{"content-type":"application/json"}});
          return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json"}});
        },
      };
    },
  };
}

test("Factory Eye pairing uses owner auth and never requires Gumroad browser policy",async()=>{
  const calls=[];
  const{createEdgeWorkerHandler}=await load("pair");
  const handler=createEdgeWorkerHandler({delegate:delegate(),factoryMcp:mcp()});
  const response=await handler.fetch(new Request("https://hub.example/hub/api/factory-eye/session/start",{
    method:"POST",
    headers:{"content-type":"application/json","x-go-owner-passcode":"owner-secret"},
    body:JSON.stringify({adapterId:"FIREFOX-PHONE"}),
  }),{
    GOHUB_OWNER_PASSCODE:"owner-secret",
    FACTORY_EYE_SESSIONS:factoryNamespace(calls),
  });
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.session_id,"S1");
  assert.equal(body.hub_origin,"https://hub.example");
  assert.equal(body.bridge,"ERGASTERION_FACTORY_EYE_REMOTE_V1");
  assert.deepEqual(calls[0][0],"/start");
});

test("Factory Eye pairing fails closed without owner passcode",async()=>{
  const calls=[];
  const{createEdgeWorkerHandler}=await load("auth");
  const handler=createEdgeWorkerHandler({delegate:delegate(),factoryMcp:mcp()});
  const response=await handler.fetch(new Request("https://hub.example/hub/api/factory-eye/session/start",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({adapterId:"FIREFOX-PHONE"}),
  }),{
    GOHUB_OWNER_PASSCODE:"owner-secret",
    FACTORY_EYE_SESSIONS:factoryNamespace(calls),
  });
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{code:"FACTORY_EYE_OWNER_AUTH_FAILED"});
  assert.equal(calls.length,0);
});

test("Factory Eye register and command poll use Factory Eye session headers",async()=>{
  const calls=[];
  const{createEdgeWorkerHandler}=await load("session");
  const handler=createEdgeWorkerHandler({delegate:delegate(),factoryMcp:mcp()});
  const env={GOHUB_OWNER_PASSCODE:"owner-secret",FACTORY_EYE_SESSIONS:factoryNamespace(calls)};
  const register=await handler.fetch(new Request("https://hub.example/hub/api/factory-eye/register",{
    method:"POST",
    headers:{"content-type":"application/json","x-factory-eye-session-id":"S1","x-factory-eye-session-token":"T1"},
    body:JSON.stringify({adapterId:"FIREFOX-PHONE",host:"firefox-addon"}),
  }),env);
  assert.equal(register.status,200);
  assert.equal(calls[0][0],"/register");
  assert.equal(calls[0][1].sessionId,"S1");
  assert.equal(calls[0][1].sessionToken,"T1");

  const commands=await handler.fetch(new Request("https://hub.example/hub/api/factory-eye/commands?adapterId=FIREFOX-PHONE",{
    headers:{"x-factory-eye-session-id":"S1","x-factory-eye-session-token":"T1"},
  }),env);
  assert.equal(commands.status,200);
  assert.deepEqual((await commands.json()).commands,[]);
});

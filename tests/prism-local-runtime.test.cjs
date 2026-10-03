"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

async function load(){
  return import("../prism-local-runtime.mjs?test="+Date.now()+Math.random());
}
function memory(){
  const data=new Map();
  return {
    storage:{
      async get(key){return structuredClone(data.get(key));},
      async put(key,value){data.set(key,structuredClone(value));},
    },
    data,
  };
}

test("PRISM local contract keeps machine capabilities available without granting authority",async()=>{
  const {createPrismLocalRuntime}=await load();
  const m=memory();
  const runtime=createPrismLocalRuntime({storage:m.storage,now:()=>1000});
  assert.deepEqual(runtime.capability("PAGE_SCAN"),{id:"PAGE_SCAN",mode:"LOCAL",available:true,createsAuthority:false});
  assert.deepEqual(runtime.capability("MERGE"),{id:"MERGE",mode:"GOVERNED",available:false,createsAuthority:false});
});

test("PRISM keeps workspace and last-good evidence on device",async()=>{
  const {createPrismLocalRuntime}=await load();
  const m=memory();
  const runtime=createPrismLocalRuntime({storage:m.storage,now:()=>2000});
  await runtime.updateWorkspace({notes:["draft"],trackedWork:[{workId:"W1",checkpointId:"C1"}],context:{page:"gumroad"}});
  await runtime.rememberEvidence({kind:"PAGE_SNAPSHOT",pageFingerprint:"fp:1"});
  const ws=await runtime.workspace();
  assert.equal(ws.notes[0],"draft");
  assert.equal(ws.trackedWork[0].workId,"W1");
  const ev=await runtime.evidence();
  assert.equal(ev[0].source,"PRISM_LOCAL");
  assert.equal(ev[0].createsAuthority,false);
});

test("governed actions enter local outbox as NOT_EXECUTED instead of being faked",async()=>{
  const {createPrismLocalRuntime}=await load();
  const m=memory();
  const runtime=createPrismLocalRuntime({storage:m.storage,now:()=>3000});
  const queued=await runtime.queueGovernedRequest({capability:"DEPLOY",payload:{ref:"abc"}});
  assert.equal(queued.state,"NOT_EXECUTED");
  assert.equal((await runtime.outbox()).length,1);
  await assert.rejects(runtime.queueGovernedRequest({capability:"PAGE_SCAN"}),/GOVERNED_CAPABILITY_REQUIRED/);
});

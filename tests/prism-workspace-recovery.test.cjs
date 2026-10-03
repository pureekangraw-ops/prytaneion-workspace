"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

async function load(){return import("../prism-workspace-recovery.mjs?x="+Date.now()+Math.random());}
function memory(){
  const data=new Map();
  return {async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},data};
}

test("recovery backup strips secrets but preserves workspace and tool recovery data",async()=>{
  const {createPrismRecoveryService}=await load();const registry=memory(),backupStore=memory();
  const svc=createPrismRecoveryService({registry,backupStore,now:()=>1000});
  await svc.registerDevice({deviceId:"phone-a",label:"Mobile"});
  const backup=await svc.createBackup({
    deviceId:"phone-a",
    workspace:{notes:["draft"],context:{page:"gumroad",sessionToken:"NOPE"},trackedWork:[{workId:"W1",checkpointId:"C1"}]},
    evidence:[{kind:"PAGE",pageFingerprint:"fp:1",capturedAt:"2026-10-03T00:00:00Z"}],
    outbox:[{id:"O1",capability:"DEPLOY",state:"NOT_EXECUTED"}],
    toolManifest:{version:"v1",apiKey:"NOPE"},
    presets:{visual:"clean",cookie:"NOPE"}
  });
  assert.equal(JSON.stringify(backup).includes("NOPE"),false);
  assert.equal(backup.workspace.trackedWork[0].workId,"W1");
  assert.equal(backup.evidenceIndex[0].ref,"fp:1");
});

test("lost device can be revoked and a new active device receives a restore plan",async()=>{
  const {createPrismRecoveryService}=await load();const registry=memory(),backupStore=memory();let now=1000;
  const svc=createPrismRecoveryService({registry,backupStore,now:()=>now});
  await svc.registerDevice({deviceId:"phone-a"});
  await svc.createBackup({deviceId:"phone-a",workspace:{notes:["continue"]},toolManifest:{version:"v1"}});
  now=2000;await svc.revokeDevice("phone-a",{reason:"LOST"});
  await svc.registerDevice({deviceId:"phone-b"});
  const plan=await svc.restorePlan({targetDeviceId:"phone-b"});
  assert.equal(plan.restore.workspace.notes[0],"continue");
  assert.equal(plan.secretsRestored,false);
  assert.equal(plan.authorityRestored,false);
  assert.ok(plan.actions.includes("REINSTALL_LOCAL_TOOLS"));
  assert.equal((await svc.device("phone-a")).status,"REVOKED");
});

test("revoked device cannot create a fresh backup",async()=>{
  const {createPrismRecoveryService}=await load();const registry=memory(),backupStore=memory();
  const svc=createPrismRecoveryService({registry,backupStore,now:()=>1000});
  await svc.registerDevice({deviceId:"phone-a"});
  await svc.revokeDevice("phone-a");
  await assert.rejects(svc.createBackup({deviceId:"phone-a",workspace:{}}),/ACTIVE_REQUIRED/);
});

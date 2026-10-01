"use strict";
const test=require("node:test");const assert=require("node:assert/strict");

test("Centre-backed Work Index survives restart and prevents duplicate Work identity",async()=>{const {createWorkRecord,createCentreBackedWorkIndex}=await import("../go-hub-centre-v4.js");const values=new Map();const storage={async get(k){return structuredClone(values.get(k));},async put(k,v){values.set(k,structuredClone(v));}};const w=createWorkRecord({workId:"WORK-DURABLE-1",checkpointId:"CP-DURABLE-1",name:"durable",command:"cutover",expectedResult:"done",requestedDestinations:["factory"]});let first=createCentreBackedWorkIndex({storage});await first.put(w);assert.equal((await first.active()).length,0);const second=createCentreBackedWorkIndex({storage});assert.equal((await second.get(w.workId)).workId,w.workId);await assert.rejects(second.put({...w,name:"duplicate"}),/DUPLICATE_WORK_ID/);});

test("Heimdall owns scoped Passes, Emergency expiry inputs, Return, and the three-way Project Board",async()=>{const {createWorkRecord,claimWork}=await import("../go-hub-centre-v4.js");const {createHeimdallV4}=await import("../go-hub-heimdall-v4.js");let w=createWorkRecord({workId:"WORK-PASS-1",name:"pass",command:"inspect",expectedResult:"readback",requestedDestinations:["factory"],projectRefs:{FACTORY:{id:"FACTORY-1",status:"DOING",destination:"destination://factory"},MAINTENANCE:{id:"MAINT-1",status:"WAIT",destination:"destination://maintenance"}}});w=claimWork(w,{actor:"GO"});const h=createHeimdallV4({works:[w]});w=await h.openPass(w.workId,{holder:"GO",kind:"EMERGENCY",scope:["factory"],expiresAt:"2099-09-24T13:00:00+07:00",reason:"production outage",audit:{eventId:"AUDIT-1"},returnAddress:w.checkpointId});assert.equal(w.pass.kind,"EMERGENCY");assert.equal(w.pass.holder,"GO");assert.deepEqual((await h.projectBoard()).map(x=>x.projectType),["WORK_CENTRE","FACTORY","MAINTENANCE"]);w=await h.closePass(w.workId,{holder:"GO",status:"OPEN",result:"returned"});assert.equal(w.pass.state,"CLOSED");});

test("Factory V4 creates a Project ID and its Live Board is UNKNOWN or STALE instead of guessing",async()=>{const m=await import("../go-hub-factory-v4.js");const work={workId:"WORK-FACTORY-1",command:"build",expectedResult:"artifact",status:"ON PROCESS",holder:"GO",pass:{state:"ACTIVE",allowedDestinations:["factory"]}};let s=m.enterFactoryV4({work,form:{repository:"repo",branch:"main",outputType:"REF"}});assert.equal(s.factoryProjectId,"FACTORY-WORK-FACTORY-1");assert.equal(m.factoryLiveBoard({repository:"repo"}).head,"UNKNOWN");assert.equal(m.factoryLiveBoard({repository:"repo",headSha:"abc",lastUpdated:"2020-01-01T00:00:00Z"},{now:Date.parse("2026-09-24T00:00:00Z")}).head,"STALE");});

test("Maintenance persists map and latest probe while never auto-repairing",async()=>{const {createMaintenanceV4}=await import("../go-hub-maintenance.js");const storage={values:new Map(),async get(k){return structuredClone(this.values.get(k));},async put(k,v){this.values.set(k,structuredClone(v));}};const work={workId:"WORK-MAINT-1",status:"ON PROCESS",holder:"GO",pass:{kind:"MAINTENANCE",state:"ACTIVE",allowedDestinations:["ALL_GO_HUB_OWNED_AREAS"]}};const map={routes:[{id:"route-1",from:"centre",to:"factory",checkpoints:[{id:"cp-1",importantValue:"path",expected:true,source:"centre",probeAction:"read",mode:"READ"}]}]};const s=createMaintenanceV4({storage,readValue:async()=>({available:true,value:true,evidenceRef:"ev://1"}),now:()=>"2026-09-24T00:00:00Z",traceId:()=>"TRACE-1"});const b=await (await s.run({work,action:"run_system_check",map})).json();assert.equal(b.routes[0].checkpoints[0].evidenceRef,"ev://1");assert.equal(b.autoRepair,false);const s2=createMaintenanceV4({storage});assert.equal((await s2.load()).lastProbe.traceId,"TRACE-1");});

test("COMPLETE requires owner-source evidence; OPEN return may remain pending",async()=>{const {createWorkRecord,claimWork,openWorkPass,returnWork}=await import("../go-hub-centre-v4.js");let w=createWorkRecord({workId:"WORK-EVIDENCE-1",name:"evidence",command:"cutover",expectedResult:"verified",requestedDestinations:["factory"]});w=claimWork(w,{actor:"GO"});w=openWorkPass(w,{actor:"GO"});assert.throws(()=>returnWork(w,{actor:"GO",status:"COMPLETE",result:"done",evidence:[]}),/owner-source evidence/);assert.equal(returnWork(w,{actor:"GO",status:"OPEN",result:"pending"}).status,"OPEN");assert.equal(returnWork(w,{actor:"GO",status:"COMPLETE",result:"done",evidence:[{ref:"github://pureekangraw-ops/standard-/commit/abc"}]}).status,"COMPLETE");});


test("Emergency Pass refuses already-expired time and reports live expiry state",async()=>{
  const c=await import("../go-hub-centre-v4.js");
  let w=c.createWorkRecord({workId:"WORK-EMERGENCY-AGE",name:"age",command:"recover",expectedResult:"bounded pass",requestedDestinations:["factory"]});
  w=c.claimWork(w,{actor:"GO",at:"2026-09-24T07:00:00Z"});
  assert.throws(()=>c.openWorkPass(w,{actor:"GO",kind:"EMERGENCY",scope:["factory"],reason:"smoke",at:"2026-09-24T07:00:00Z",expiresAt:"2026-09-24T06:59:59Z"}),/already expired/);
  w=c.openWorkPass(w,{actor:"GO",kind:"EMERGENCY",scope:["factory"],reason:"smoke",at:"2026-09-24T07:00:00Z",expiresAt:"2026-09-24T07:05:00Z"});
  assert.equal(c.passIsExpired(w.pass,{at:"2026-09-24T07:04:59Z"}),false);
  assert.equal(c.passIsExpired(w.pass,{at:"2026-09-24T07:05:00Z"}),true);
});


test("V4 board remains a Centre-derived read model", async () => {
  const { createWorkRecord, boardView } = await import("../go-hub-centre-v4.js");
  const work = createWorkRecord({ workId:"WORK-BOARD-CANONICAL-1", name:"canonical board", command:"inspect", expectedResult:"readback" });
  const board = boardView([work]);
  assert.equal(board.length, 1);
  assert.equal(board[0].workId, work.workId);
  assert.equal(board[0].status, work.status);
  assert.equal(board[0].card.workId, work.workId);
});

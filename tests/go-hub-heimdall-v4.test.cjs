const test=require("node:test");const assert=require("node:assert/strict");
test("thin Heimdall stores searches and reports Work without evidence judgment",async()=>{const c=await import("../go-hub-centre-v4.js"),h=await import("../go-hub-heimdall-v4.js");const w=c.createWorkRecord({workId:"W-H",name:"Factory job",command:"build",expectedResult:"artifact",requestedDestinations:["factory"]});const x=h.createThinHeimdall({works:[w]});assert.equal(x.get("W-H").workId,"W-H");assert.equal(x.search("factory").length,1);assert.equal(x.report().counts.OPEN,1);for(const forbidden of ["decideEvidenceGate","PASS","REJECT","EVIDENCE_ACCEPTED"])assert.equal(Object.prototype.hasOwnProperty.call(x,forbidden),false);});


test("Heimdall owns support-board projection and dependency targeting",async()=>{
  const h=await import("../go-hub-heimdall-v4.js");
  const missions=[
    {missionId:"M1",mission:"done",status:"FINISHED",priority:"NORMAL",dependencies:[],roomStates:[]},
    {missionId:"M2",mission:"blocked",status:"ACTIVE",priority:"URGENT",dependencies:["M3"],roomStates:[{roomId:"ROOM-A",session:{status:"ACTIVE",evidenceRefs:[],unknowns:["WAIT"]}}]},
    {missionId:"M3",mission:"ready",status:"ACTIVE",priority:"HIGH",dependencies:[],roomStates:[{roomId:"ROOM-B",session:{status:"FINISHED",evidenceRefs:["e://1"],unknowns:[]}}]},
  ];
  const board=h.supportBoardView(missions);
  assert.equal(board.projectionOnly,true);
  assert.equal(board.counts.missions,3);
  assert.equal(board.cards.find(x=>x.missionId==="M3").status,"READY_FOR_GO");
  const targets=h.supportBoardTargets(missions,{maxConcurrent:2});
  assert.equal(targets.runnable[0].missionId,"M3");
  assert.equal(targets.waiting[0].missionId,"M2");
  assert.deepEqual(targets.waiting[0].blockedBy,["M3"]);
});

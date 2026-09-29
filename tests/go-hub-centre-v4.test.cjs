const test = require("node:test");
const assert = require("node:assert/strict");
async function mod(){ return import("../go-hub-centre-v4.js"); }

test("Work must be claimed before Heimdall opens a Pass", async () => {
  const { createWorkRecord, openWorkPass } = await mod();
  const work=createWorkRecord({workId:"W1",name:"Centre V4",command:"build centre",expectedResult:"centre ready",requestedDestinations:["factory"]});
  assert.throws(()=>openWorkPass(work,{kind:"WORK"}),/ON PROCESS/);
});

test("one active Work has one holder and Work Pass destinations", async () => {
  const { createWorkRecord,claimWork,openWorkPass }=await mod();
  let work=createWorkRecord({workId:"W1",name:"Centre V4",command:"build centre",expectedResult:"centre ready",requestedDestinations:["factory","drive"]});
  work=claimWork(work,{actor:"GO",at:"2026-09-24T01:00:00Z"});
  work=openWorkPass(work,{kind:"WORK",at:"2026-09-24T01:01:00Z"});
  assert.equal(work.status,"ON PROCESS");
  assert.equal(work.holder,"GO");
  assert.deepEqual(work.pass.allowedDestinations,["factory","drive"]);
  assert.equal(work.pass.openedBy,"heimdall");
});

test("Maintenance Pass exposes all GO Hub owned areas but remains Work-bound", async () => {
  const { createWorkRecord,claimWork,openWorkPass }=await mod();
  let work=createWorkRecord({workId:"WM",name:"Maintenance",command:"repair route",expectedResult:"route verified",requestedDestinations:["maintenance"]});
  work=claimWork(work,{actor:"GO"});
  assert.throws(()=>openWorkPass(work,{kind:"MAINTENANCE"}),/BIG-approved repair scope/);
  assert.throws(()=>openWorkPass(work,{kind:"MAINTENANCE",audit:{ownerApproval:"BIG_APPROVED"}}),/repair scope/);
  work=openWorkPass(work,{kind:"MAINTENANCE",audit:{ownerApproval:"BIG_APPROVED",approvedBy:"BIG",repairScope:["repair route"]}});
  assert.deepEqual(work.pass.allowedDestinations,["ALL_GO_HUB_OWNED_AREAS"]);
  assert.equal(work.pass.audit.ownerApproval,"BIG_APPROVED");
  assert.deepEqual(work.pass.audit.repairScope,["repair route"]);
});

test("Return can only be written by holder and closes Pass", async () => {
  const { createWorkRecord,claimWork,openWorkPass,returnWork }=await mod();
  let work=createWorkRecord({workId:"W2",name:"Factory",command:"produce",expectedResult:"artifact",requestedDestinations:["factory"]});
  work=claimWork(work,{actor:"LIGHT"});
  work=openWorkPass(work,{kind:"WORK"});
  assert.throws(()=>returnWork(work,{actor:"GO",result:"done"}),/current holder/);
  work=returnWork(work,{actor:"LIGHT",result:"done",evidence:[{ref:"github://pureekangraw-ops/standard-/commit/abc"}],at:"2026-09-24T02:00:00Z"});
  assert.equal(work.status,"COMPLETE");
  assert.equal(work.pass.state,"CLOSED");
  assert.equal(work.holder,null);
});

test("Board is a read model of Work reality", async () => {
  const { createWorkRecord,boardView }=await mod();
  const work=createWorkRecord({workId:"W3",name:"Board",command:"show",expectedResult:"visible",requestedDestinations:["factory"]});
  const board=boardView([work]);
  assert.equal(board[0].workId,"W3");
  assert.equal(board[0].status,"OPEN");
  assert.equal(board[0].holder,null);
});


test("GO explicitly reopens COMPLETE Work on the same Work ID and Checkpoint", async () => {
  const { createWorkRecord, claimWork, openWorkPass, returnWork, reopenWork } = await mod();
  let work = createWorkRecord({
    workId:"W-REOPEN",
    checkpointId:"CP-W-REOPEN",
    name:"Reopen same work",
    command:"finish then correct",
    expectedResult:"same work continues",
    requestedDestinations:["github://owner/repo"],
  });
  work = claimWork(work, { actor:"GO", at:"2026-09-30T00:00:00Z" });
  work = openWorkPass(work, { kind:"WORK", actor:"GO", at:"2026-09-30T00:01:00Z" });
  work = returnWork(work, {
    actor:"GO",
    status:"COMPLETE",
    result:{ summary:"first completion" },
    evidence:[{ ref:"commit://first" }],
    at:"2026-09-30T00:02:00Z",
  });
  assert.equal(work.status, "COMPLETE");
  assert.equal(work.holder, null);
  assert.throws(() => reopenWork({ ...work, status:"CANCEL" }, { actor:"GO" }), /Only COMPLETE Work/);

  const reopened = reopenWork(work, { actor:"GO", at:"2026-09-30T00:03:00Z" });
  assert.equal(reopened.workId, work.workId);
  assert.equal(reopened.checkpointId, work.checkpointId);
  assert.equal(reopened.status, "ON PROCESS");
  assert.equal(reopened.holder, "GO");
  assert.equal(reopened.attention, "REOPENED");
  assert.equal(reopened.readback, null);
  assert.equal(reopened.pass.state, "CLOSED");
});


test("emergency owner controls bypass lifecycle deadlocks without minting a new Work", async () => {
  const { createWorkRecord, claimWork, openWorkPass, emergencyEnterWork, emergencyExitWork } = await mod();
  let work = createWorkRecord({
    workId:"W-EMERGENCY",
    checkpointId:"CP-W-EMERGENCY",
    name:"Emergency escape",
    command:"escape stuck lifecycle",
    expectedResult:"same Work survives",
    requestedDestinations:["github://owner/repo"],
  });
  work = claimWork(work, { actor:"LIGHT", at:"2026-09-30T02:00:00Z" });
  work = openWorkPass(work, {
    kind:"WORK",
    actor:"LIGHT",
    destinations:["github://owner/repo"],
    at:"2026-09-30T02:01:00Z",
  });

  const escaped = emergencyExitWork(work, { at:"2026-09-30T02:02:00Z" });
  assert.equal(escaped.workId, work.workId);
  assert.equal(escaped.checkpointId, work.checkpointId);
  assert.equal(escaped.status, "OPEN");
  assert.equal(escaped.holder, null);
  assert.equal(escaped.pass.state, "CLOSED");
  assert.equal(escaped.attention, "EMERGENCY_EXIT");
  assert.equal(escaped.readback.actor, "BIG");

  const entered = emergencyEnterWork(escaped, { at:"2026-09-30T02:03:00Z" });
  assert.equal(entered.workId, work.workId);
  assert.equal(entered.checkpointId, work.checkpointId);
  assert.equal(entered.status, "ON PROCESS");
  assert.equal(entered.holder, "GO");
  assert.equal(entered.pass.state, "CLOSED");
  assert.equal(entered.attention, "EMERGENCY_ENTER");
});

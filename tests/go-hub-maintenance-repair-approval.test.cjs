"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});}

test("Maintenance mutations require a BIG-approved repair scope while pass issuance remains the approval gate",async()=>{
  const {createGovernedMutationRunner}=await import("../go-hub-factory-mcp-worker.mjs?repair-gate="+Date.now());
  let currentPass={kind:"WORK",state:"ACTIVE",allowedDestinations:["destination://maintenance"]};
  const centreLive={action:async()=>response({ok:true,v4:true,work:{workId:"W-M",checkpointId:"CP-W-M",workType:"MAINTENANCE",status:"ON PROCESS",holder:"GO",pass:currentPass}})};
  const globalAudit={append:async()=>response({ok:true})};
  const run=createGovernedMutationRunner({centreLive,globalAudit});
  let executions=0;
  const execute=async()=>{executions++;return response({ok:true});};

  let result=await run("github.put_file",{workContext:{workId:"W-M",checkpointId:"CP-W-M"}},execute);
  assert.equal(result.status,409);
  assert.equal((await result.json()).code,"MAINTENANCE_REPAIR_PASS_REQUIRED");
  assert.equal(executions,0);

  currentPass={kind:"MAINTENANCE",state:"ACTIVE",allowedDestinations:["ALL_GO_HUB_OWNED_AREAS"],audit:null};
  result=await run("github.put_file",{workContext:{workId:"W-M",checkpointId:"CP-W-M"}},execute);
  assert.equal(result.status,409);
  assert.equal((await result.json()).code,"MAINTENANCE_REPAIR_APPROVAL_REQUIRED");
  assert.equal(executions,0);

  result=await run("heimdall.pass.open",{workContext:{workId:"W-M",checkpointId:"CP-W-M"}},execute);
  assert.equal(result.status,200);
  assert.equal(executions,1);

  currentPass={kind:"MAINTENANCE",state:"ACTIVE",allowedDestinations:["ALL_GO_HUB_OWNED_AREAS"],audit:{ownerApproval:"BIG_APPROVED",repairScope:["fix checker"]}};
  result=await run("github.put_file",{workContext:{workId:"W-M",checkpointId:"CP-W-M"}},execute);
  assert.equal(result.status,200);
  assert.equal(executions,2);
});

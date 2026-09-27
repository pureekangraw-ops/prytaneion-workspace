const test=require("node:test");const assert=require("node:assert/strict");async function mod(){return import("../go-hub-maintenance.js");}
const work={workId:"WM",status:"ON PROCESS",holder:"GO",pass:{kind:"MAINTENANCE",state:"ACTIVE",allowedDestinations:["ALL_GO_HUB_OWNED_AREAS"],audit:{ownerApproval:"BIG_APPROVED",repairScope:["test repair"]}}};
const readWork={...work,pass:{kind:"WORK",state:"ACTIVE",allowedDestinations:["destination://maintenance"]}};
const LIVE_CONTROL={centre:{status:"OPEN"},projectStatus:{status:"OPEN"},board:{updatedAt:"2099-01-01T00:00:00.000Z"},github:{headSha:"abc123"},cloudflare:{deployment:{sourceSha:"abc123"}}};
const map={source:"GO_FIRST_REALITY_RUN",routes:[{id:"centre-factory",from:"centre",to:"factory",checkpoints:[{id:"centre-pass",importantValue:"Factory path allowed",expected:true,source:"go-hub-centre-v4.js",probeAction:"read",mode:"READ",ownerSource:"GO Hub"},{id:"factory-flow",importantValue:"Factory stages",expected:{contains:["PLAN","BUILD","ASSEMBLY","MERGE","CHECK","OUTPUT"]},source:"go-hub-factory-v4.js",probeAction:"read",mode:"READ",ownerSource:"GO Hub"}]}]};
test("Maintenance inspection is Work-bound but read-only access does not require repair authority",async()=>{const {createMaintenanceV4}=await mod();const s=createMaintenanceV4();assert.equal((await s.run({action:"inspect"})).status,409);assert.equal((await s.run({work:{...work,pass:null},action:"inspect"})).status,409);assert.equal((await s.run({work:readWork,action:"inspect"})).status,200);const repair=await s.run({work:readWork,action:"repair_context"});assert.equal(repair.status,409);assert.equal((await repair.json()).code,"MAINTENANCE_REPAIR_PASS_REQUIRED");assert.equal((await s.run({work,action:"repair_context"})).status,200);});
test("Probe overlays observed reality on GO-defined route",async()=>{const {createMaintenanceV4}=await mod();const s=createMaintenanceV4({readValue:async p=>({available:true,value:p.id==="centre-pass"?true:["PLAN","BUILD","ASSEMBLY","MERGE","CHECK","OUTPUT"],evidence:p.source}),traceId:()=>"T1",now:()=>"NOW"});const r=await s.run({work,action:"run_system_check",map,controlRoomTruth:LIVE_CONTROL});const b=await r.json();assert.equal(b.status,"MAINTENANCE_CHECK_COMPLETE");assert.equal(b.routes[0].status,"PASS");assert.equal(b.traceId,"T1");});
test("First bad value is recorded while downstream observations continue and no auto repair",async()=>{const {createMaintenanceV4}=await mod();let reads=0;const s=createMaintenanceV4({readValue:async p=>{reads++;return{available:true,value:p.id==="centre-pass"?false:[]};}});const b=await (await s.run({work,action:"run_system_check",map})).json();assert.equal(b.routes[0].checkpoints[0].status,"FAIL");assert.equal(b.routes[0].checkpoints[1].status,"FAIL");assert.equal(reads,2);assert.equal(b.autoRepair,false);});
test("Mutating probes are blocked",async()=>{const {createMaintenanceV4}=await mod();let reads=0;const s=createMaintenanceV4({readValue:async()=>{reads++;return{available:true,value:true};}});const bad={routes:[{id:"gmail",from:"centre",to:"gmail",checkpoints:[{id:"send",importantValue:"send",expected:true,source:"gmail",probeAction:"send",mode:"MUTATE"}]}]};const b=await (await s.run({work,action:"run_system_check",map:bad})).json();assert.equal(b.routes[0].status,"BLOCKED");assert.equal(reads,0);});

test("Maintenance persists the first reality map and reuses it on later checks",async()=>{
  const {createMaintenanceV4}=await mod();
  let reads=0;
  const s=createMaintenanceV4({readValue:async p=>{reads++;return{available:true,value:p.id==="centre-pass"?true:["PLAN","BUILD","ASSEMBLY","MERGE","CHECK","OUTPUT"],evidenceRef:"test://"+p.id};},traceId:()=>"T-PERSIST",now:()=>"NOW"});
  const saved=await (await s.run({work,action:"inspect_map",map})).json();
  assert.equal(saved.persisted,true);
  assert.equal(saved.map.routes.length,1);
  const checked=await (await s.run({work,action:"run_system_check",controlRoomTruth:LIVE_CONTROL})).json();
  assert.equal(checked.status,"MAINTENANCE_CHECK_COMPLETE");
  assert.equal(checked.report.mapSource,"GO_FIRST_REALITY_RUN");
  assert.equal(checked.report.coverage.checkpoints.total,2);
  assert.equal(reads,2);
  const readback=await (await s.run({work,action:"inspect_map"})).json();
  assert.equal(readback.map.routes[0].id,"centre-factory");
  assert.equal(readback.persisted,true);
});

test("Maintenance report exposes reached-until, safe evidence, relation mismatch and bounded persona-aware views",async()=>{
  const {createMaintenanceV4}=await mod();
  const s=createMaintenanceV4({
    readValue:async p=>p.id==="centre-pass"
      ? {available:true,value:true,evidenceRef:"owner://centre",safeEvidence:{kind:"CENTRE"}}
      : {available:true,value:["PLAN","BUILD"],evidenceRef:"owner://factory",safeEvidence:{kind:"FACTORY"}},
    traceId:()=>"T-REPORT",now:()=>"NOW",
  });
  const body=await (await s.run({work,action:"run_system_check",map})).json();
  assert.equal(body.status,"MAINTENANCE_CHECK_ATTENTION");
  assert.equal(body.routes[0].firstBreak,"factory-flow");
  assert.equal(body.routes[0].reachedUntil,"factory-flow");
  assert.equal(body.routes[0].firstBadValue.relationMismatch.type,"RELATION_MISMATCH");
  assert.equal(body.routes[0].checkpoints[0].safeEvidence.kind,"CENTRE");
  assert.equal(body.report.reportVersion,2);
  assert.equal(body.report.firstBreaks[0].firstBreak,"factory-flow");
  assert.equal(body.report.decisionPoints[0].checkpointId,"factory-flow");
  assert.equal(body.views.cartographer.brokenRoutes[0].routeId,"centre-factory");
  assert.equal(body.views.detective.causalLeads[0].verdict,"EVIDENCE_BOUND_FIRST_CAUSAL_BREAK");
  assert.equal(body.views.detective.hardLock,"READ_ONLY_ZERO_MUTATION");
  assert.deepEqual(body.views.ghostbusters.confirmedGhosts,[]);
  assert.equal(body.report.safety.autoRepair,false);
});



test("Control Room preserves live conflicts and exact-linkage UNKNOWN",async()=>{
  const {createMaintenanceV4}=await mod();
  const s=createMaintenanceV4({readValue:async()=>({available:true,value:true}),traceId:()=>"T-CONTROL",now:()=>"NOW"});
  const body=await (await s.run({work,action:"run_system_check",map,controlRoomTruth:{
    centre:{status:"ON PROCESS"},projectStatus:{status:"IDLE"},
    board:{smokeResidue:true,updatedAt:"2026-09-20T00:00:00.000Z"},
    github:{headSha:"abc123"},cloudflare:{deployment:{id:"dep-1"}},
  }})).json();
  assert.equal(body.report.controlRoom.overall,"CONFLICT");
  assert.equal(body.report.controlRoom.centreProject.reason,"CENTRE_ACTIVE_PROJECT_IDLE");
  assert.equal(body.report.controlRoom.board.classification,"STALE_PROJECTION_RESIDUE");
  assert.equal(body.report.controlRoom.deploymentProvenance.status,"UNKNOWN");
});


test("Full-system verification refuses false green while required truth is UNKNOWN",async()=>{
  const {createMaintenanceV4}=await mod();
  const s=createMaintenanceV4({readValue:async p=>({available:true,value:p.id==="centre-pass"?true:["PLAN","BUILD","ASSEMBLY","MERGE","CHECK","OUTPUT"]}),traceId:()=>"T-UNKNOWN",now:()=>"NOW"});
  const body=await (await s.run({work:readWork,action:"run_system_check",map})).json();
  assert.equal(body.status,"MAINTENANCE_CHECK_ATTENTION");
  assert.equal(body.fullSystemVerified,false);
  assert.equal(body.next,"GO_RESOLVE_UNKNOWN");
  assert.equal(body.report.controlRoom.overall,"UNKNOWN");
});

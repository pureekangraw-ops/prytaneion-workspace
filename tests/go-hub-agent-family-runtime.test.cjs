const test=require("node:test");
const assert=require("node:assert/strict");

test("Agent runtime routes preserve Work identity and do not expand authority", async()=>{
  const { prepareAgentDispatch }=await import("../go-hub-agent-family-runtime.mjs");
  const prepared=prepareAgentDispatch({
    agentId:"PIXIE",
    workId:"WORK-1",
    checkpointId:"CP-1",
    requestedResult:"inspect factory state",
    acceptanceCriteria:["owner source readback"],
  });
  assert.equal(prepared.envelope.workId,"WORK-1");
  assert.equal(prepared.envelope.checkpointId,"CP-1");
  assert.equal(prepared.handoff.to,"PIXIE_LAB_GO_WORKS");
  assert.equal(prepared.handoff.authorityExpanded,false);
  assert.equal(prepared.handoff.checkpointPreserved,true);
});

test("HERMES remains stationary transport home", async()=>{
  const { getAgentHomeRoute }=await import("../go-hub-agent-family-runtime.mjs");
  const route=getAgentHomeRoute("HERMES");
  assert.equal(route.home,"CENTRE_TRANSPORT_STATION");
  assert.deepEqual(route.entryTools,["go_hub_agent_mission"]);
});

test("MIMIR receives Centre returns rather than acting as general Counter helper", async()=>{
  const { getAgentHomeRoute }=await import("../go-hub-agent-family-runtime.mjs");
  const route=getAgentHomeRoute("MIMIR");
  assert.equal(route.receive,"CENTRE_RETURN");
  assert.equal(route.agent.counterSeat,"DEFINED_NOT_PUBLISHED");
  assert.equal(route.home,"CENTRE_HOUSEKEEPING");
});

test("verified return goes back to Centre and COMPLETE still needs readback", async()=>{
  const { prepareAgentReturn }=await import("../go-hub-agent-family-runtime.mjs");
  assert.throws(()=>prepareAgentReturn({
    agentId:"SPECTRUM",
    workId:"WORK-2",
    checkpointId:"CP-2",
    requestedResult:"web status",
    status:"COMPLETE",
  }),/AGENT_COMPLETE_REQUIRES_EVIDENCE_AND_READBACK/);

  const returned=prepareAgentReturn({
    agentId:"SPECTRUM",
    workId:"WORK-2",
    checkpointId:"CP-2",
    requestedResult:"web status",
    status:"COMPLETE",
    evidenceRefs:["office://readback/1"],
    readback:{source:"OFFICE",state:"MATCHED"},
    result:{summary:"healthy"},
  });
  assert.equal(returned.to,"CENTRE");
  assert.equal(returned.from,"WEB_OFFICE_STOREFRONT");
  assert.equal(returned.authorityExpanded,false);
});

test("BIG GO and LIGHT receive reports from the intended agents", async()=>{
  const { agentRuntimeDescriptor }=await import("../go-hub-agent-family.mjs");
  assert.deepEqual(agentRuntimeDescriptor("PIXIE").reportsTo,["GO"]);
  assert.ok(agentRuntimeDescriptor("SPECTRUM").reportsTo.includes("BIG"));
  assert.ok(agentRuntimeDescriptor("HERMES").reportsTo.includes("LIGHT"));
  assert.ok(agentRuntimeDescriptor("LIGHT").reportsTo.includes("GO"));
});

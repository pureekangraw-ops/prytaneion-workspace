const test = require("node:test");
const assert = require("node:assert/strict");

test("Agent Family publishes one staged lifecycle and Centre truth policy", async () => {
  const family = await import("../go-hub-agent-family.mjs");
  assert.deepEqual(family.AGENT_LIFECYCLE, [
    "RECEIVE","RESOLVE","PLAN","AUTHORIZE","EXECUTE","VERIFY","RETURN"
  ]);
  assert.equal(family.AGENT_FAMILY_POLICY.workTruthOwner, "CENTRE");
  assert.equal(family.AGENT_FAMILY_POLICY.intakeSurface, "COUNTER");
  assert.equal(family.AGENT_FAMILY_POLICY.toolSuccessIsCompletion, false);
  assert.equal(family.AGENT_FAMILY_POLICY.agentMayCreateSecondWorkTruth, false);
  assert.equal(family.AGENT_FAMILY_POLICY.agentMayExpandOwnAuthority, false);
});

test("roles match current operating model without publishing new authority", async () => {
  const family = await import("../go-hub-agent-family.mjs");
  assert.equal(family.AGENT_ROLES.PIXIE.homeRuntime, "PIXIE_LAB_GO_WORKS");
  assert.deepEqual(family.AGENT_ROLES.PIXIE.reportsTo, ["GO"]);
  assert.equal(family.AGENT_ROLES.SPECTRUM.homeRuntime, "WEB_OFFICE_STOREFRONT");
  assert.ok(family.AGENT_ROLES.SPECTRUM.reportsTo.includes("BIG"));
  assert.equal(family.AGENT_ROLES.HERMES.stationary, true);
  assert.equal(family.AGENT_ROLES.MIMIR.homeRuntime, "CENTRE_HOUSEKEEPING");
  assert.equal(family.AGENT_ROLES.MIMIR.counterSeat, "DEFINED_NOT_PUBLISHED");
  assert.equal(family.AGENT_ROLES.LIGHT.role, "KNOWLEDGE_MANAGER");
  assert.deepEqual(family.CURRENT_COUNTER_HELPERS, ["PIXIE","SPECTRUM","HERMES","LIGHT"].sort((a,b)=>0));
});

test("normal lifecycle cannot skip stages but exceptions can pause and resume", async () => {
  const { nextAgentState } = await import("../go-hub-agent-family.mjs");
  assert.equal(nextAgentState("RECEIVE","RESOLVE"), "RESOLVE");
  assert.throws(() => nextAgentState("RECEIVE","EXECUTE"), /AGENT_TRANSITION_INVALID/);
  assert.equal(nextAgentState("EXECUTE","BLOCKED"), "BLOCKED");
  assert.equal(nextAgentState("BLOCKED","RESOLVE"), "RESOLVE");
});

test("COMPLETE return requires evidence and readback", async () => {
  const { createVerifiedReturn } = await import("../go-hub-agent-family.mjs");
  const base = {
    agentId:"PIXIE",
    workId:"WORK-1",
    checkpointId:"CP-1",
    requestedResult:"verified result",
  };
  assert.throws(
    () => createVerifiedReturn({ ...base, status:"COMPLETE" }),
    /AGENT_COMPLETE_REQUIRES_EVIDENCE_AND_READBACK/
  );
  const returned = createVerifiedReturn({
    ...base,
    status:"COMPLETE",
    result:{ ok:true },
    evidenceRefs:["github://example/evidence"],
    readback:{ source:"OWNER_SOURCE", state:"MATCHED" },
  });
  assert.equal(returned.returnOwner, "CENTRE");
  assert.equal(returned.status, "COMPLETE");
});

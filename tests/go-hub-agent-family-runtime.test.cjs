const test = require("node:test");
const assert = require("node:assert/strict");

test("PIXIE runtime response carries shared Agent family identity without new authority", async () => {
  const { createPixieCommandService } = await import("../go-hub-pixie-service.mjs");
  const service = createPixieCommandService({
    token:"test-token",
    fetchImpl:async () => new Response(null, { status:204 }),
  });
  const response = await service.command({ requestId:"REQ-AGENT-FAMILY-1", command:"inspect", args:{} });
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.agent.agentId, "PIXIE");
  assert.equal(body.agent.homeRuntime, "PIXIE_LAB_GO_WORKS");
  assert.equal(body.agent.workTruthOwner, "CENTRE");
  assert.deepEqual(body.agent.reportsTo, ["GO"]);
});

test("SPECTRUM sales seam identifies Web/Office home while preserving receipt behavior", async () => {
  const { createSalesStore } = await import("../go-hub-sales-store.mjs");
  const rows = new Map();
  const storage = {
    get:async key => rows.get(key),
    put:async (key,value) => rows.set(key, structuredClone(value)),
    list:async ({prefix}) => new Map([...rows].filter(([key]) => key.startsWith(prefix))),
  };
  const store = createSalesStore({ storage });
  const saved = await store.brief("upsert", {
    briefId:"BRIEF-1",
    clientId:"CLIENT-1",
    conversationId:"CONV-1",
    brief:{ goal:"website" },
  });
  assert.equal(saved.agent.agentId, "SPECTRUM");
  assert.equal(saved.agent.homeRuntime, "WEB_OFFICE_STOREFRONT");
  assert.ok(saved.receipt);
  const listed = await store.list();
  assert.equal(listed.agent.agentId, "SPECTRUM");
  assert.equal(listed.source, "CENTRE_SPECTRUM_INTAKE");
});

test("MIMIR housekeeping plan is an Agent-family projection but remains non-mutating", async () => {
  const { planReturnHousekeeping, assertMimirHousekeepingSafety } = await import("../go-hub-mimir-logic-v1.mjs");
  const plan = planReturnHousekeeping({
    planId:"PLAN-1",
    policy:{ policyRef:"POLICY-1", allowDeleteCandidates:false },
    returnEnvelope:{
      returnId:"RETURN-1",
      workId:"WORK-1",
      checkpointId:"CP-1",
      items:[{
        itemId:"ITEM-1",
        kind:"RESULT",
        ref:"result://1",
        lifecycleStatus:"current",
        duplicateState:"none",
        protected:false,
        evidenceRefs:["evidence://1"],
        lineageRefs:[],
      }],
    },
  });
  assert.equal(plan.agent.agentId, "MIMIR");
  assert.equal(plan.agent.homeRuntime, "CENTRE_HOUSEKEEPING");
  assert.equal(plan.writePerformed, false);
  assert.equal(plan.sourceMutationAllowed, false);
  assert.equal(assertMimirHousekeepingSafety(plan), true);
});

test("HERMES and LIGHT share the same family contract with different homes", async () => {
  const { agentRuntimeDescriptor } = await import("../go-hub-agent-family.mjs");
  const hermes = agentRuntimeDescriptor("HERMES");
  const light = agentRuntimeDescriptor("LIGHT");
  assert.equal(hermes.contract, light.contract);
  assert.equal(hermes.homeRuntime, "CENTRE_TRANSPORT_STATION");
  assert.equal(light.homeRuntime, "NOTION_KNOWLEDGE_RUNTIME");
  assert.ok(hermes.reportsTo.includes("LIGHT"));
  assert.ok(light.reportsTo.includes("BIG"));
});

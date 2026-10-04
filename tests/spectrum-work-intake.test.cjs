const test = require("node:test");
const assert = require("node:assert/strict");

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async list({ prefix = "" } = {}) {
      return [...values.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)]);
    },
  };
}

test("confirmed brief preserves deterministic Work identity", async () => {
  const { createSalesStore } = await import("../go-hub-sales-store.mjs");
  const store = createSalesStore({ storage: memoryStorage() });
  const payload = {
    briefId: "BRIEF-1",
    clientId: "CLIENT-1",
    conversationId: "CONV-1",
    workId: "WORK-SPECTRUM-BRIEF-1",
    brief: { goal: "Company profile", jobType: "COMPANY_PROFILE" },
  };
  const first = await store.brief("confirm", payload);
  const second = await store.brief("confirm", payload);
  assert.equal(first.brief.workId, "WORK-SPECTRUM-BRIEF-1");
  assert.equal(second.brief.workId, "WORK-SPECTRUM-BRIEF-1");
  assert.equal(second.receipt, first.receipt);
});

test("confirmed brief rejects a changed payload", async () => {
  const { createSalesStore } = await import("../go-hub-sales-store.mjs");
  const store = createSalesStore({ storage: memoryStorage() });
  const base = { briefId: "BRIEF-2", clientId: "CLIENT-1", conversationId: "CONV-1", workId: "WORK-SPECTRUM-BRIEF-2", brief: { goal: "A" } };
  await store.brief("confirm", base);
  await assert.rejects(() => store.brief("confirm", { ...base, brief: { goal: "B" } }), /BRIEF_CONFIRM_CONFLICT/);
});


test("GO escalation budget is durable, idempotent, and bounded per conversation", async () => {
  const { createSalesStore } = await import("../go-hub-sales-store.mjs");
  const store = createSalesStore({ storage: memoryStorage() });
  const base={clientId:"CLIENT-1",conversationId:"CONV-GO"};
  const first=await store.goBudget({...base,requestId:"REQ-W-1",kind:"WHISPER"});
  assert.equal(first.allowed,true);
  const duplicate=await store.goBudget({...base,requestId:"REQ-W-1",kind:"WHISPER"});
  assert.equal(duplicate.allowed,true);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.budget.conversation.whisper,1);
  await store.goBudget({...base,requestId:"REQ-W-2",kind:"WHISPER"});
  await store.goBudget({...base,requestId:"REQ-W-3",kind:"WHISPER"});
  const blocked=await store.goBudget({...base,requestId:"REQ-W-4",kind:"WHISPER"});
  assert.equal(blocked.allowed,false);assert.equal(blocked.reason,"GO_CONVERSATION_WHISPER_LIMIT");
  for(let i=1;i<=3;i++)assert.equal((await store.goBudget({...base,requestId:"REQ-T-"+i,kind:"TAKEOVER"})).allowed,true);
  const takeoverBlocked=await store.goBudget({...base,requestId:"REQ-T-4",kind:"TAKEOVER"});
  assert.equal(takeoverBlocked.allowed,false);assert.equal(takeoverBlocked.reason,"GO_CONVERSATION_TAKEOVER_LIMIT");
});

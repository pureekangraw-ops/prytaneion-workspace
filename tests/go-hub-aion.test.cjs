"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function mod() { return import("../go-hub-aion.mjs?test=" + Date.now()); }

function missionTool(version) {
  return {
    name:"go_hub_agent_mission",
    description:"Agent Mission " + version,
    inputSchema:{ type:"object", properties:{ action:{ type:"string" }, version:{ const:version } } },
    annotations:{ readOnlyHint:false, destructiveHint:false },
  };
}

test("AION.OPEN queries CURRENT exposure every time and never caches prior Agent Mission contract", async () => {
  const { createAionGate } = await mod();
  let revision = "v1";
  let calls = 0;
  const gate = createAionGate({
    queryControlRoom: async () => {
      calls += 1;
      return { tools:[missionTool(revision), { name:"go_hub_board_read", description:"board", annotations:{ readOnlyHint:true } }], broadcast:{ version:revision } };
    },
    now:() => "NOW",
  });
  const first = await gate.open({ context:{ chat:"same-chat" } });
  revision = "v2";
  const second = await gate.open({ context:{ chat:"same-chat" } });
  assert.equal(calls, 2);
  assert.equal(first.contract.inputSchema.properties.version.const, "v1");
  assert.equal(second.contract.inputSchema.properties.version.const, "v2");
  assert.equal(second.broadcast.version, "v2");
  assert.equal(second.transfer.tool, "go_hub_agent_mission");
  assert.deepEqual(second.transfer.context, { chat:"same-chat" });
  assert.equal(second.closed, true);
  assert.equal(second.cacheUsed, false);
});

test("AION.OPEN returns UNKNOWN, does not transfer, and closes when CURRENT Agent Mission entry cannot be verified", async () => {
  const { createAionGate } = await mod();
  const gate = createAionGate({ queryControlRoom:async () => ({ tools:[{ name:"old_agent_entry" }] }), now:() => "NOW" });
  const result = await gate.open({ context:{ workId:"must-not-be-used" } });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.transfer, null);
  assert.equal(result.closed, true);
  assert.equal(result.cacheUsed, false);
  assert.equal(result.workCreated, false);
  assert.equal(result.routeSelected, false);
  assert.equal(result.authorityCreated, false);
});

test("AION.OPEN is ephemeral entry-only and exposes current capabilities without executing them", async () => {
  const { createAionGate } = await mod();
  const gate = createAionGate({ queryControlRoom:async () => ({ tools:[
    missionTool("current"),
    { name:"go_hub_merge_pull_request", description:"merge", annotations:{ destructiveHint:true } },
  ] }) });
  const result = await gate.open();
  assert.deepEqual(result.capabilities.map(item => item.name), ["go_hub_agent_mission","go_hub_merge_pull_request"]);
  assert.equal(result.capabilities[1].destructive, true);
  assert.equal(result.closed, true);
});

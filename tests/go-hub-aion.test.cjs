"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function mod() { return import("../go-hub-aion.mjs?test=" + Date.now()); }

function missionTool(version) {
  return {
    name:"go_hub_agent_mission",
    description:"Agent Mission " + version,
    inputSchema:{ type:"object", properties:{ action:{ type:"string", enum:["find","enter","reopen","create","issue_card","prepare_route_change","confirm_route_change","select_context","note","ask_light","first_open","touch","return","update_card","exit","inspect"] }, version:{ const:version } }, required:["action"] },
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
      return { status:"CURRENT", source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST", observedAt:"NOW", tools:[missionTool(revision), { name:"go_hub_board_read", description:"board", annotations:{ readOnlyHint:true } }], broadcast:{ version:revision } };
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
  const gate = createAionGate({ queryControlRoom:async () => ({ status:"CURRENT", source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST", observedAt:"NOW", tools:[
    missionTool("current"),
    { name:"go_hub_merge_pull_request", description:"merge", annotations:{ destructiveHint:true } },
  ] }) });
  const result = await gate.open();
  assert.deepEqual(result.capabilities.map(item => item.name), ["go_hub_agent_mission","go_hub_merge_pull_request"]);
  assert.equal(result.capabilities[1].destructive, true);
  assert.equal(result.closed, true);
});

test("MCP AION reads the current contract twice in one chat and reaches Agent Mission without selecting Work", async () => {
  const { createMcpRegistry } = await import("../go-hub-mcp-registry.mjs?test=" + Date.now());
  let current = [missionTool("v1")];
  const received = [];
  const registry = createMcpRegistry({
    currentTools:() => current,
    lifecycle:{
      agentMission:async input => {
        received.push(input);
        return new Response(JSON.stringify({ ok:true, action:input.action }), {
          headers:{ "content-type":"application/json" },
        });
      },
    },
  });
  const args = { context:{ chat:"same-chat", mission:"Inspect current contract" } };
  const first = (await registry.callTool("go_hub_aion_open", args)).structuredContent;
  current = [missionTool("v2")];
  const second = (await registry.callTool("go_hub_aion_open", args)).structuredContent;
  assert.equal(first.contract.inputSchema.properties.version.const, "v1");
  assert.equal(second.contract.inputSchema.properties.version.const, "v2");
  assert.equal(second.handoff.status, "ARRIVED");
  assert.deepEqual(received, [
    { action:"find", mission:"Inspect current contract" },
    { action:"find", mission:"Inspect current contract" },
  ]);
  assert.equal(second.workCreated, false);

  current = [];
  const stale = await registry.callTool("go_hub_aion_open", args);
  assert.equal(stale.isError, true);
  assert.equal(stale.structuredContent.status, "UNKNOWN");
  assert.equal(stale.structuredContent.transfer, null);
  assert.equal(received.length, 2);
});

test("MCP AION hands explicit existing Work context to Agent Mission enter", async () => {
  const { createMcpRegistry } = await import("../go-hub-mcp-registry.mjs?enter=" + Date.now());
  let received;
  const registry = createMcpRegistry({
    currentTools:() => [missionTool("current")],
    lifecycle:{
      agentMission:async input => {
        received = input;
        return new Response(JSON.stringify({ ok:true, action:"enter" }), {
          headers:{ "content-type":"application/json" },
        });
      },
    },
  });
  const response = await registry.callTool("go_hub_aion_open", {
    context:{ workId:"WORK-A", checkpointId:"CP-A", mission:"Continue existing work" },
  });
  assert.equal(response.structuredContent.handoff.status, "ARRIVED");
  assert.deepEqual(received, {
    action:"enter", workId:"WORK-A", checkpointId:"CP-A", agentId:"GO", mission:"Continue existing work",
  });
});


test("AION.OPEN returns UNKNOWN when only a legacy Agent Mission surface is exposed", async () => {
  const { createAionGate } = await mod();
  const gate = createAionGate({
    queryControlRoom:async () => ({
      status:"CURRENT",
      source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST",
      observedAt:"NOW",
      tools:[{
        name:"go_hub_agent_mission",
        inputSchema:{ type:"object", properties:{ action:{ type:"string", enum:["prepare_card","confirm_card"] } }, required:["action"] },
      }],
    }),
    now:() => "NOW",
  });
  const result = await gate.open({ context:{ mission:"legacy surface" } });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.reason, "CURRENT_AGENT_MISSION_ENTRY_NOT_EXPOSED");
  assert.equal(result.transfer, null);
});

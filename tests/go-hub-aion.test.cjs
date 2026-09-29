"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function mod() { return import("../go-hub-aion.mjs?test=" + Date.now()); }

const actions = [
  "find","enter","reopen","manual_continue","emergency_enter","emergency_exit","create",
  "issue_card","prepare_route_change","confirm_route_change","select_context","note","ask_light",
  "first_open","touch","return","update_card","exit","inspect",
];

function missionTool(version) {
  return {
    name:"go_hub_agent_mission",
    description:"Agent Mission " + version,
    inputSchema:{ type:"object", properties:{ action:{ type:"string", enum:[...actions] }, version:{ const:version } }, required:["action"] },
    annotations:{ readOnlyHint:false, destructiveHint:false },
  };
}

test("AION reads CURRENT every time and returns a pointer only", async () => {
  const { createAionGate } = await mod();
  let revision = "v1";
  let calls = 0;
  const aion = createAionGate({
    queryControlRoom: async () => {
      calls += 1;
      return {
        status:"CURRENT",
        source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST",
        observedAt:"NOW",
        tools:[missionTool(revision), { name:"go_hub_board_read", description:"board", annotations:{ readOnlyHint:true } }],
        broadcast:{ version:revision },
      };
    },
    now:() => "NOW",
  });

  const first = await aion.open({ context:{ chat:"same-chat" } });
  revision = "v2";
  const second = await aion.open({ context:{ chat:"same-chat" } });

  assert.equal(calls, 2);
  assert.equal(first.contract.inputSchema.properties.version.const, "v1");
  assert.equal(second.contract.inputSchema.properties.version.const, "v2");
  assert.equal(second.surface, "AION_ROUTE");
  assert.equal(second.action, "ROUTE");
  assert.equal(second.route.tool, "go_hub_agent_mission");
  assert.equal(second.route.mode, "POINTER_ONLY");
  assert.deepEqual(second.route.context, { chat:"same-chat" });
  assert.equal(second.handoff, null);
  assert.equal(second.executed, false);
  assert.equal(second.sessionCreated, false);
  assert.equal(second.authorityCreated, false);
  assert.equal(second.workCreated, false);
  assert.equal(second.routeSelected, false);
});

test("AION never blocks entry when CURRENT route is unavailable", async () => {
  const { createAionGate } = await mod();
  const aion = createAionGate({
    queryControlRoom:async () => ({ status:"UNKNOWN", source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST", tools:[] }),
    now:() => "NOW",
  });
  const result = await aion.open({ context:{ workId:"WORK-A", checkpointId:"CP-A" } });
  assert.equal(result.ok, true);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.route, null);
  assert.equal(result.handoff, null);
  assert.equal(result.executed, false);
  assert.equal(result.closed, true);
});

test("AION exposes current capabilities without executing any capability", async () => {
  const { createAionGate } = await mod();
  const aion = createAionGate({ queryControlRoom:async () => ({
    status:"CURRENT", source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST", observedAt:"NOW",
    tools:[
      missionTool("current"),
      { name:"go_hub_merge_pull_request", description:"merge", annotations:{ destructiveHint:true } },
    ],
  }) });
  const result = await aion.open();
  assert.deepEqual(result.capabilities.map(item => item.name), ["go_hub_agent_mission","go_hub_merge_pull_request"]);
  assert.equal(result.capabilities[1].destructive, true);
  assert.equal(result.executed, false);
});

test("MCP AION returns route only and never calls Agent Mission for mission or Work context", async () => {
  const { createMcpRegistry } = await import("../go-hub-mcp-registry.mjs?route-only=" + Date.now());
  let calls = 0;
  const registry = createMcpRegistry({
    currentTools:() => [missionTool("current")],
    lifecycle:{
      agentMission:async () => {
        calls += 1;
        throw new Error("AION must not call HERMES");
      },
    },
  });

  const missionRoute = (await registry.callTool("go_hub_aion_open", {
    context:{ mission:"continue dream" },
  })).structuredContent;
  const workRoute = (await registry.callTool("go_hub_aion_open", {
    context:{ workId:"WORK-A", checkpointId:"CP-A", mission:"continue work" },
  })).structuredContent;

  assert.equal(calls, 0);
  assert.equal(missionRoute.route.tool, "go_hub_agent_mission");
  assert.deepEqual(missionRoute.route.context, { mission:"continue dream" });
  assert.equal(workRoute.route.tool, "go_hub_agent_mission");
  assert.deepEqual(workRoute.route.context, { workId:"WORK-A", checkpointId:"CP-A", mission:"continue work" });
  assert.equal(workRoute.handoff, null);
  assert.equal(workRoute.executed, false);
});

test("AION route result stays non-error when only legacy Agent Mission is exposed", async () => {
  const { createMcpRegistry } = await import("../go-hub-mcp-registry.mjs?legacy-route=" + Date.now());
  const registry = createMcpRegistry({
    currentTools:() => [{
      name:"go_hub_agent_mission",
      inputSchema:{ type:"object", properties:{ action:{ type:"string", enum:["prepare_card","confirm_card"] } }, required:["action"] },
    }],
  });
  const result = await registry.callTool("go_hub_aion_open", { context:{ mission:"legacy" } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.status, "UNKNOWN");
  assert.equal(result.structuredContent.route, null);
});

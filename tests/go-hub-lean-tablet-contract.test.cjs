"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

async function importFresh(path) { return import(`${path}?lean=${Date.now()}-${Math.random()}`); }

const work = {
  workId:"WORK-YGGMETRO-WEB-20261002-001",
  checkpointId:"CP-WORK-YGGMETRO-WEB-20261002-001",
  jobCode:"0210-RGPQ",
  command:"Refactor the lean Tablet flow",
  expectedResult:"Factory continues without Agent-managed gates",
  workType:"NORMAL",
  status:"ON PROCESS",
  holder:"GO",
};

test("Work Tablet keeps only identity, task, initial context, status, result, and evidence", async () => {
  const { prepareStandardMissionTicket, issueStandardMissionTicket } = await importFresh("../go-hub-mission-card.mjs");
  const draft = prepareStandardMissionTicket({
    work,
    tabletOnly:true,
    agentId:"GO",
    sessionId:"SESSION-YGGMETRO-001",
    initialContext:{ source:"NOTION_AI_LIGHT", test:"yggmetro-web" },
  });
  const forbidden = ["tool_access", "access_scope", "destinations", "snapshot_key", "pass", "scope"];
  for (const key of forbidden) assert.equal(Object.hasOwn(draft, key), false, key);
  assert.equal(draft.agentId, "GO");
  assert.equal(draft.sessionId, "SESSION-YGGMETRO-001");
  assert.equal(draft.workId, work.workId);
  assert.equal(draft.checkpointId, work.checkpointId);
  assert.equal(draft.task, work.command);
  assert.deepEqual(draft.initialContext, { source:"NOTION_AI_LIGHT", test:"yggmetro-web" });
  assert.equal(draft.status, "ON PROCESS");
  assert.deepEqual(draft.evidence, []);
  assert.equal(issueStandardMissionTicket(draft).state, "CURRENT");
});

test("Agent Mission schema has no route, Pass, scope, or tool selection fields", async () => {
  const { createMcpRegistry } = await importFresh("../go-hub-mcp-registry.mjs");
  const lifecycle = {
    centreInspect: async () => new Response(JSON.stringify({ work }), { status:200 }),
    factoryV4: async () => new Response(JSON.stringify({ ok:true, action:"inspect" }), { status:200 }),
  };
  const registry = createMcpRegistry({ lifecycle, enforceCardAccess:true });
  const tool = registry.listTools().find(item => item.name === "go_hub_agent_mission");
  for (const key of ["toolAccess", "accessScope", "destinations", "scope"]) {
    assert.equal(Object.hasOwn(tool.inputSchema.properties, key), false, key);
  }
  const result = await registry.callTool("go_hub_factory_v4", {
    action:"inspect",
    workContext:{ workId:work.workId, checkpointId:work.checkpointId },
  });
  assert.equal(result.structuredContent.ok, true);
});

test("City Map resolves routes in backend without Agent selection", async () => {
  const { createCityRoute, resolveBackendRoute } = await importFresh("../go-hub-city-route.js");
  const city = createCityRoute();
  assert.equal(city.map.agentSelectionRequired, false);
  assert.equal(city.destinations.notion.role, "search-archive-service");
  assert.deepEqual(resolveBackendRoute({ destination:"factory", workId:work.workId, checkpointId:work.checkpointId }), {
    map:"GO_HUB_BACKEND",
    route:"destination://factory",
    destinationId:"factory",
    role:"building-entry",
    workId:work.workId,
    checkpointId:work.checkpointId,
    status:"ON PROCESS",
    automatic:true,
    agentSelectionRequired:false,
  });
});

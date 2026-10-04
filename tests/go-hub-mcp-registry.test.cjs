"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const registryUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-mcp-registry.mjs")).href;
const factoryWorkContext = Object.freeze({ workId:"WORK-A", checkpointId:"CENTRE-001" });
const linearWorkContext = factoryWorkContext;
const driveWorkContext = factoryWorkContext;
const counterWorkContext = factoryWorkContext;

test("registry publishes lifecycle plus one Hephaestus Foreman tool with safe annotations", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?contract=" + Date.now());
  const calls = [];
  const lifecycle = new Proxy({}, {
    get: (_, name) => async input => {
      calls.push({ name, input });
      return new Response(JSON.stringify({ ok: true, operation: name }), { headers: { "content-type": "application/json" } });
    },
  });
  const registry = createMcpRegistry({ lifecycle });
  const tools = registry.listTools();
  assert.deepEqual(tools.map(tool => tool.name), [
    "go_hub_broadcast_read", "go_hub_broadcast_activate",
    "go_hub_inspect_repository", "go_hub_list_repositories", "go_hub_read_file",
    "go_hub_create_branch", "go_hub_put_file", "go_hub_delete_file", "go_hub_compare_refs",
    "go_hub_open_pull_request", "go_hub_get_pull_request", "go_hub_get_ci",
    "go_hub_get_failure_evidence", "go_hub_rerun_failed_jobs", "go_hub_factory_v4",
    "go_hub_ergasterion_health", "go_hub_ergasterion_handoff",
    "go_hub_maintenance", "go_hub_heimdall_pass", "go_hub_v4_project_board", "go_hub_aion_open", "go_hub_aion_resolve", "go_hub_aion_registry", "go_hub_agent_family_status", "go_hub_agent_fitting_room", "go_hub_agent_persona_room", "go_hub_agent_lens_room", "go_hub_agent_mission", "go_hub_light_centre_v4_action", "go_hub_light_factory_v4_action", "go_hub_merge_pull_request", "go_hub_get_workflow_runs", "go_hub_list_workflow_artifacts", "go_hub_archive_workflow_artifact", "go_hub_audit_history", "go_hub_centre_inspect", "go_hub_centre_resolve", "go_hub_centre_audit_history", "go_hub_centre_live_action", "go_hub_centre_read_only_fast_lane",
    "go_hub_lighthouse_control_port_state", "go_hub_lighthouse_control_port_command", "go_hub_project_status", "go_hub_board_read",
    "go_hub_pixie_command", "go_hub_pixie_go_works_action", "go_hub_pixie_debug_factory_action", "go_hub_pixie_result",
    "go_hub_counter_create", "go_hub_counter_inbox", "go_hub_counter_get", "go_hub_counter_seen", "go_hub_counter_pickup", "go_hub_counter_answer", "go_hub_counter_readback",
    "go_hub_observer_latest", "go_hub_observer_screenshot", "go_hub_linear_list_projects", "go_hub_linear_get_issue",
    "go_hub_linear_create_issue", "go_hub_linear_update_issue",
    "go_hub_cloudflare_capabilities", "go_hub_cloudflare_health", "go_hub_cloudflare_list_workers", "go_hub_cloudflare_inspect_worker", "go_hub_cloudflare_deploy_worker",
    "go_hub_notion_status", "go_hub_notion_connect", "go_hub_notion_search", "go_hub_notion_tools", "go_hub_notion_call",
    "go_hub_gmail_capabilities", "go_hub_gmail_diagnostics", "go_hub_gmail_profile", "go_hub_gmail_search", "go_hub_gmail_get_message", "go_hub_gmail_send_message",
    "go_hub_calendar_capabilities", "go_hub_calendar_diagnostics", "go_hub_calendar_list", "go_hub_calendar_events", "go_hub_calendar_create_event",
    "go_hub_drive_capabilities", "go_hub_drive_health", "go_hub_drive_diagnostics", "go_hub_drive_root", "go_hub_drive_get_item", "go_hub_drive_list_children", "go_hub_drive_read_document", "go_hub_drive_download_file",
    "go_hub_drive_create_folder", "go_hub_drive_upload_file", "go_hub_drive_move_item", "go_hub_drive_rename_item",
  ]);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_broadcast_activate").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_factory_v4").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_ergasterion_health").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_ergasterion_handoff").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_factory_v4").inputSchema.properties.inspection.type, "object");
  assert.equal(tools.find(tool => tool.name === "go_hub_light_factory_v4_action").inputSchema.properties.inspection.type, "object");
  assert.equal(tools.find(tool => tool.name === "go_hub_light_factory_v4_action").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_aion_open").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_aion_resolve").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_aion_registry").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_family_status").annotations.readOnlyHint, true);
  assert.deepEqual(tools.find(tool => tool.name === "go_hub_agent_family_status").inputSchema.properties.action.enum, ["overview","route"]);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_fitting_room").annotations.readOnlyHint, false);
  assert.deepEqual(tools.find(tool => tool.name === "go_hub_agent_fitting_room").inputSchema.properties.action.enum, ["list", "fit"]);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_lens_room").annotations.readOnlyHint, false);
  assert.deepEqual(tools.find(tool => tool.name === "go_hub_agent_lens_room").inputSchema.properties.action.enum, ["list", "compare", "select"]);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_fitting_room").inputSchema.properties.workContext, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_fitting_room").inputSchema.properties.tabletId, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_lens_room").inputSchema.properties.workContext, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_lens_room").inputSchema.properties.tabletId, undefined);
  for (const name of ["go_hub_agent_persona_room", "go_hub_agent_lens_room", "go_hub_agent_fitting_room"]) {
    const tool = tools.find(current => current.name === name);
    assert.equal(tool.inputSchema.properties.workContext, undefined);
    assert.equal((tool.inputSchema.required || []).includes("workContext"), false);
  }
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").annotations.readOnlyHint, false);
  assert.deepEqual(
    tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.action.enum,
    ["create_tablet","pickup_tablet","emergency_enter","help_choose","update_tablet","return_tablet"]
  );
  assert.match(tools.find(tool => tool.name === "go_hub_agent_mission").description, /Work Tablet desk/);
  assert.deepEqual(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.tabletId, { type:"string", minLength:1 });
  assert.deepEqual(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.cardId, { type:"string", minLength:1 });
  assert.match(tools.find(tool => tool.name === "go_hub_agent_mission").description, /Legacy CARD:\*/);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.accessScope, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.toolAccess, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.destinations, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.scope, undefined);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.confirmation, undefined);
  assert.match(tools.find(tool => tool.name === "go_hub_agent_mission").description, /backend policy/);
  assert.equal(tools.some(tool => tool.name === "go_hub_factory_ready_gate"), false);
  assert.equal(tools.some(tool => tool.name === "go_hub_factory_foreman"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_maintenance").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_merge_pull_request").annotations.destructiveHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_list_workflow_artifacts").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_archive_workflow_artifact").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_audit_history").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_centre_inspect").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_centre_audit_history").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_centre_live_action").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_centre_read_only_fast_lane").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_lighthouse_control_port_state").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_lighthouse_control_port_command").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_project_status").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_board_read").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_pixie_command").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_pixie_go_works_action").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_pixie_debug_factory_action").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_pixie_result").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_counter_create").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_counter_get").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_counter_readback").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_observer_latest").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_observer_screenshot").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_list_projects").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_get_issue").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_create_issue").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_update_issue").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_capabilities").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_health").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_list_workers").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_inspect_worker").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_deploy_worker").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_notion_status").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_notion_connect").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_notion_search").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_notion_tools").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_notion_call").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_notion_call").annotations.destructiveHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_capabilities").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_health").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_diagnostics").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_root").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_get_item").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_list_children").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_read_document").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_download_file").annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_create_folder").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_upload_file").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_move_item").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_rename_item").annotations.readOnlyHint, false);
  assert.deepEqual(tools[0].securitySchemes, [{ type: "oauth2", scopes: ["go-hub"] }]);

  for (const tool of tools.filter(tool => tool.inputSchema?.properties?.workContext && tool.name !== "go_hub_agent_mission")) {
    assert.equal(tool.inputSchema.required.includes("workContext"), true, `${tool.name} must require work identity`);
    assert.deepEqual(tool.inputSchema.properties.workContext.required, ["workId","checkpointId"], `${tool.name} gate must have exactly two identity values`);
    assert.deepEqual(Object.keys(tool.inputSchema.properties.workContext.properties), ["workId","checkpointId"], `${tool.name} gate must expose no extra identity fields`);
  }
  assert.equal(tools.find(tool => tool.name === "go_hub_inspect_repository").inputSchema.required.includes("workContext"), true);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_list_projects").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_get_issue").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_observer_latest").inputSchema.required.includes("workContext"), true);
  assert.equal(tools.find(tool => tool.name === "go_hub_observer_screenshot").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_health").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_inspect_worker").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_deploy_worker").inputSchema.required.includes("workContext"), true);
  assert.equal(tools.find(tool => tool.name === "go_hub_project_status").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_board_read").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_family_status").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_root").inputSchema.required.includes("workContext"), false);

  await registry.callTool("go_hub_agent_family_status", { action:"overview" });
  assert.equal(calls.at(-1).name, "agentFamilyStatus");

  await registry.callTool("go_hub_inspect_repository", { repository: "pureekangraw-ops/standard-", branch: "main", workContext: factoryWorkContext });
  assert.equal(calls.at(-1).name, "inspect");

  await registry.callTool("go_hub_counter_create", {
    counterId: "COUNTER-0001", request: "Find GO Hub source", context: {}, workContext: counterWorkContext,
  });
  assert.equal(calls.at(-1).name, "counterCreate");
  await registry.callTool("go_hub_counter_get", { counterId: "COUNTER-0001", workContext: counterWorkContext });
  assert.equal(calls.at(-1).name, "counterGet");
  await registry.callTool("go_hub_counter_inbox", { limit: 10, workContext: counterWorkContext });
  assert.equal(calls.at(-1).name, "counterInbox");
  await registry.callTool("go_hub_counter_pickup", { counterId: "COUNTER-0001", workContext: counterWorkContext });
  assert.equal(calls.at(-1).name, "counterPickup");
  await registry.callTool("go_hub_audit_history", { workId: "WORK-LIVE", afterSequence: 0, limit: 50 });
  assert.equal(calls.at(-1).name, "auditHistory");
  await registry.callTool("go_hub_centre_inspect", { workId: "WORK-LIVE", checkpointId: "CENTRE-001" });
  assert.equal(calls.at(-1).name, "centreInspect");
  await registry.callTool("go_hub_centre_audit_history", { workId: "WORK-LIVE", afterSequence: 0, limit: 50 });
  assert.equal(calls.at(-1).name, "centreAuditHistory");
  await registry.callTool("go_hub_centre_live_action", { action: "inspect", workId: "WORK-LIVE" });
  assert.equal(calls.at(-1).name, "centreLiveAction");
  await registry.callTool("go_hub_centre_live_action", {
    action:"v4_return",
    workId:"WORK-LIVE",
    actor:"GO",
    status:"COMPLETE",
    evidence:[{ ref:"runtime://proof" }],
  });
  assert.equal(calls.at(-1).name, "centreLiveAction");
  await registry.callTool("go_hub_centre_read_only_fast_lane", { purpose: "READ_TELL", operations: ["READ"] });
  assert.equal(calls.at(-1).name, "centreReadOnlyFastLane");
  await registry.callTool("go_hub_drive_download_file", { fileId:"zip-a", maxBytes:1024 });
  assert.equal(calls.at(-1).name, "driveDownloadFile");
  await registry.callTool("go_hub_notion_tools", {});
  assert.equal(calls.at(-1).name, "notionTools");
  await registry.callTool("go_hub_notion_call", {
    toolName:"notion-create-pages",
    arguments:{ parent:{ type:"page_id", page_id:"page-1" }, pages:[{ properties:{ title:"Test" } }] },
    workContext:factoryWorkContext,
  });
  assert.equal(calls.at(-1).name, "notionCall");
  await registry.callTool("go_hub_lighthouse_control_port_state", { targetId: "lighthouse" });
  assert.equal(calls.at(-1).name, "lighthouseControlPortState");
  await registry.callTool("go_hub_lighthouse_control_port_command", { targetId: "lighthouse", requestId: "hub-1", capabilityId: "system.appState", payload: {} });
  assert.equal(calls.at(-1).name, "lighthouseControlPortCommand");
  await registry.callTool("go_hub_project_status", { targetId: "lighthouse", factoryTaskId: "pureekangraw-ops:task-1" });
  assert.equal(calls.at(-1).name, "projectStatus");
  await registry.callTool("go_hub_board_read", {});
  assert.equal(calls.at(-1).name, "boardRead");
  await assert.rejects(registry.callTool("go_hub_board_pin_route", { firstCommand: "legacy" }), /unknown MCP tool/);
  await registry.callTool("go_hub_pixie_command", { requestId:"PIXIE-REQ-1", command:"status", args:{}, workContext:counterWorkContext });
  assert.equal(calls.at(-1).name, "pixieCommand");
  await registry.callTool("go_hub_pixie_go_works_action", { action:"inspect", factoryInput:{}, workContext:counterWorkContext });
  assert.equal(calls.at(-1).name, "pixieGoWorksAction");
  await registry.callTool("go_hub_pixie_debug_factory_action", { action:"inspect", roomId:"ROOM-D", factoryInput:{}, workContext:counterWorkContext });
  assert.equal(calls.at(-1).name, "pixieDebugFactoryAction");
  await registry.callTool("go_hub_pixie_result", { requestId:"PIXIE-REQ-1" });
  assert.equal(calls.at(-1).name, "pixieResult");
  await registry.callTool("go_hub_observer_latest", { workContext: counterWorkContext });
  await registry.callTool("go_hub_observer_screenshot", { screenshotRef: "shot:1" });
  assert.equal(calls.at(-2).name, "observerLatest");
  assert.deepEqual(calls.at(-2).input, { workContext: counterWorkContext });
  assert.equal(calls.at(-1).name, "observerScreenshot");
  await registry.callTool("go_hub_list_workflow_artifacts", { repository: "pureekangraw-ops/ygph-metropolis", runId: 123, workContext: factoryWorkContext });
  assert.equal(calls.at(-1).name, "listWorkflowArtifacts");
  await registry.callTool("go_hub_archive_workflow_artifact", { repository: "pureekangraw-ops/ygph-metropolis", runId: 123, artifactId: 456, parentId: "folder-a", entrySuffix: "app.apk", destinationName: "app.apk", workContext: driveWorkContext });
  assert.equal(calls.at(-1).name, "archiveWorkflowArtifact");
});

test("governed tools expose exactly two gate identity values and reject extras", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?identity=" + Date.now());
  const calls = [];
  const lifecycle = new Proxy({}, {
    get: (_, name) => async input => {
      calls.push({ name, input });
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    },
  });
  const registry = createMcpRegistry({ lifecycle });

  await assert.rejects(registry.callTool("go_hub_put_file", {
    repository: "pureekangraw-ops/standard-", path: "x.js", branch: "task-branch", content: "x",
  }), /workContext/);
  await assert.rejects(registry.callTool("go_hub_put_file", {
    repository: "pureekangraw-ops/standard-", path: "x.js", branch: "task-branch", content: "x",
    workContext: { ...factoryWorkContext, returnAddress: "CENTRE-001" },
  }), /unknown workContext field/i);
  await assert.rejects(registry.callTool("go_hub_factory_v4", {
    action: "inspect",
  }), /workContext/);

  await registry.callTool("go_hub_linear_create_issue", {
    title: "Bridge", workContext: linearWorkContext,
  });
  assert.equal(calls.at(-1).name, "linearCreateIssue");
  assert.deepEqual(calls.at(-1).input.workContext, { workId:"WORK-A", checkpointId:"CENTRE-001" });
});

test("card access enforcement never rewrites tool contracts", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?no-schema-rewrite=" + Date.now());
  let centreReads = 0;
  const lifecycle = new Proxy({
    centreInspect:async () => {
      centreReads += 1;
      return new Response(JSON.stringify({ ok:true }), { headers:{ "content-type":"application/json" } });
    },
  }, {
    get(target, name) {
      if (name in target) return target[name];
      return async input => new Response(JSON.stringify({ ok:true, operation:name, input }), { headers:{ "content-type":"application/json" } });
    },
  });
  const registry = createMcpRegistry({ lifecycle, enforceCardAccess:true });
  const tools = registry.listTools();

  for (const name of ["go_hub_agent_persona_room", "go_hub_agent_lens_room", "go_hub_agent_fitting_room"]) {
    const tool = tools.find(current => current.name === name);
    assert.equal(tool.inputSchema.properties.workContext, undefined);
    assert.equal((tool.inputSchema.required || []).includes("workContext"), false);
  }

  const capability = await registry.callTool("go_hub_agent_persona_room", { action:"list", agentId:"GO" });
  assert.equal(capability.structuredContent.ok, true);
  assert.equal(centreReads, 0);

  const workTool = tools.find(current => current.name === "go_hub_put_file");
  assert.ok(workTool.inputSchema.properties.workContext);
  assert.equal(workTool.inputSchema.required.includes("workContext"), true);
});

test("merge uses Work Tablet tool authority and adds no separate BIG approval gate", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?merge-tablet=" + Date.now());
  let received = null;
  let centreReads = 0;
  let hermesCalls = 0;
  const registry = createMcpRegistry({
    lifecycle:{
      agentMission:async () => {
        hermesCalls += 1;
        throw new Error("HERMES must not mediate merge");
      },
      centreInspect:async input => {
        centreReads += 1;
        return new Response(JSON.stringify({
          ok:true,
          v4:true,
          work:{
            workId:input.workId,
            checkpointId:input.checkpointId,
            status:"ON PROCESS",
            holder:"GO",
            toolAccess:["go_hub_merge_pull_request"],
          },
        }), { headers:{ "content-type":"application/json" } });
      },
      mergePullRequest:async input => {
        received = input;
        return new Response(JSON.stringify({ ok:true, merged:true }), { headers:{ "content-type":"application/json" } });
      },
    },
    enforceCardAccess:true,
  });
  const tool = registry.listTools().find(item => item.name === "go_hub_merge_pull_request");
  assert.equal(tool.inputSchema.properties.ownerApproval, undefined);
  assert.equal(tool.inputSchema.required.includes("ownerApproval"), false);
  const result = await registry.callTool("go_hub_merge_pull_request", {
    repository:"pureekangraw-ops/standard-",
    number:50,
    expectedHeadSha:"head-sha",
    workContext:factoryWorkContext,
  });
  assert.equal(result.structuredContent.ok, true);
  assert.equal(received.number, 50);
  assert.equal(Object.hasOwn(received, "ownerApproval"), false);
  assert.equal(centreReads, 1);
  assert.equal(hermesCalls, 0);
});

test("registry preserves domain failures and rejects unknown tools", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?errors=" + Date.now());
  const registry = createMcpRegistry({ lifecycle: {
    putFile: async () => new Response(JSON.stringify({ code: "DEFAULT_BRANCH_WRITE_BLOCKED" }), { status: 409, headers: { "content-type": "application/json" } }),
  } });
  const blocked = await registry.callTool("go_hub_put_file", {
    repository: "pureekangraw-ops/standard-", path: "x.js", branch: "main", content: "x", workContext: factoryWorkContext,
  });
  assert.equal(blocked.isError, true);
  assert.deepEqual(blocked.structuredContent, { code: "DEFAULT_BRANCH_WRITE_BLOCKED" });
  await assert.rejects(registry.callTool("unknown", {}), /unknown MCP tool/);
});


test("Maintenance Tablet scope is read from Centre directly without HERMES mediation", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?maintenance-tablet=" + Date.now());
  let hermesCalls = 0;
  const registry = createMcpRegistry({
    lifecycle:{
      agentMission:async () => {
        hermesCalls += 1;
        throw new Error("HERMES must not mediate tool execution");
      },
      centreInspect:async input => new Response(JSON.stringify({
        ok:true,
        v4:true,
        work:{
          workId:input.workId,
          checkpointId:input.checkpointId,
          status:"ON PROCESS",
          holder:"GO",
          workType:"MAINTENANCE",
        },
      }), { headers:{ "content-type":"application/json" } }),
      maintenance:async () => new Response(JSON.stringify({ ok:true, status:"MAINTENANCE_READY" }), { headers:{ "content-type":"application/json" } }),
      inspect:async () => new Response(JSON.stringify({ ok:true, inspected:true }), { headers:{ "content-type":"application/json" } }),
    },
    enforceCardAccess:true,
  });
  const workContext = { workId:"WORK-MAINTENANCE-SCOPE", checkpointId:"CP-MAINTENANCE-SCOPE" };
  const result = await registry.callTool("go_hub_maintenance", {
    action:"inspect",
    workContext,
  });
  assert.equal(result.structuredContent.status, "MAINTENANCE_READY");
  assert.equal(hermesCalls, 0);
  const backendRouted = await registry.callTool("go_hub_inspect_repository", { repository:"owner/repo", workContext });
  assert.equal(backendRouted.structuredContent.ok, true);
  assert.equal(hermesCalls, 0);
});

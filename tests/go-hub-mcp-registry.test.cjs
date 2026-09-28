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
    "go_hub_maintenance", "go_hub_heimdall_pass", "go_hub_v4_project_board", "go_hub_aion_open", "go_hub_agent_persona_room", "go_hub_agent_mission", "go_hub_light_centre_v4_action", "go_hub_light_factory_v4_action", "go_hub_merge_pull_request", "go_hub_get_workflow_runs", "go_hub_list_workflow_artifacts", "go_hub_archive_workflow_artifact", "go_hub_audit_history", "go_hub_centre_inspect", "go_hub_centre_audit_history", "go_hub_centre_live_action", "go_hub_centre_read_only_fast_lane",
    "go_hub_lighthouse_control_port_state", "go_hub_lighthouse_control_port_command", "go_hub_project_status", "go_hub_board_read",
    "go_hub_pixie_command", "go_hub_pixie_go_works_action", "go_hub_pixie_debug_factory_action", "go_hub_pixie_result",
    "go_hub_counter_create", "go_hub_counter_inbox", "go_hub_counter_get", "go_hub_counter_seen", "go_hub_counter_pickup", "go_hub_counter_answer", "go_hub_counter_readback",
    "go_hub_observer_latest", "go_hub_observer_screenshot", "go_hub_linear_list_projects", "go_hub_linear_get_issue",
    "go_hub_linear_create_issue", "go_hub_linear_update_issue",
    "go_hub_cloudflare_capabilities", "go_hub_cloudflare_health", "go_hub_cloudflare_list_workers", "go_hub_cloudflare_inspect_worker",
    "go_hub_gmail_capabilities", "go_hub_gmail_diagnostics", "go_hub_gmail_profile", "go_hub_gmail_search", "go_hub_gmail_get_message", "go_hub_gmail_send_message",
    "go_hub_calendar_capabilities", "go_hub_calendar_diagnostics", "go_hub_calendar_list", "go_hub_calendar_events", "go_hub_calendar_create_event",
    "go_hub_drive_capabilities", "go_hub_drive_health", "go_hub_drive_diagnostics", "go_hub_drive_root", "go_hub_drive_get_item", "go_hub_drive_list_children", "go_hub_drive_read_document", "go_hub_drive_download_file",
    "go_hub_drive_create_folder", "go_hub_drive_upload_file", "go_hub_drive_move_item", "go_hub_drive_rename_item",
  ]);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools.find(tool => tool.name === "go_hub_broadcast_activate").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_factory_v4").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_factory_v4").inputSchema.properties.inspection.type, "object");
  assert.equal(tools.find(tool => tool.name === "go_hub_light_factory_v4_action").inputSchema.properties.inspection.type, "object");
  assert.equal(tools.find(tool => tool.name === "go_hub_light_factory_v4_action").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_aion_open").annotations.readOnlyHint, false);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").annotations.readOnlyHint, false);
  assert.deepEqual(
    tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.action.enum,
    ["find","enter","create","prepare_card","confirm_card","prepare_route_change","confirm_route_change","select_context","note","ask_light","first_open","touch","return","exit","inspect"]
  );
  assert.match(tools.find(tool => tool.name === "go_hub_agent_mission").description, /HERMES owns the user-facing route operation/);
  assert.deepEqual(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.properties.confirmation, { type:"string", enum:["GO_CONFIRMED"] });
  assert.match(tools.find(tool => tool.name === "go_hub_agent_mission").description, /Heimdall remains the internal enforcement engine/);
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
  assert.equal(tools.find(tool => tool.name === "go_hub_inspect_repository").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_list_projects").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_linear_get_issue").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_observer_latest").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_observer_screenshot").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_health").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_cloudflare_inspect_worker").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_project_status").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_board_read").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_agent_mission").inputSchema.required.includes("workContext"), false);
  assert.equal(tools.find(tool => tool.name === "go_hub_drive_root").inputSchema.required.includes("workContext"), false);

  await registry.callTool("go_hub_inspect_repository", { repository: "pureekangraw-ops/standard-", branch: "main" });
  assert.equal(calls[0].name, "inspect");

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
  await registry.callTool("go_hub_observer_latest", {});
  await registry.callTool("go_hub_observer_screenshot", { screenshotRef: "shot:1" });
  assert.equal(calls.at(-2).name, "observerLatest");
  assert.equal(calls.at(-1).name, "observerScreenshot");
  await registry.callTool("go_hub_list_workflow_artifacts", { repository: "pureekangraw-ops/ygph-metropolis", runId: 123 });
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

test("merge schema requires explicit BIG approval on every merge", async () => {
  const { createMcpRegistry } = await import(registryUrl + "?merge=" + Date.now());
  let received = null;
  const registry = createMcpRegistry({ lifecycle: { mergePullRequest: async input => { received = input; return new Response(JSON.stringify({ ok:true }), { headers:{ "content-type":"application/json" } }); } } });
  await assert.rejects(registry.callTool("go_hub_merge_pull_request", {
    repository: "pureekangraw-ops/standard-", number: 50, expectedHeadSha: "head-sha", workContext: factoryWorkContext,
  }), /ownerApproval|approval/i);
  await assert.rejects(registry.callTool("go_hub_merge_pull_request", {
    repository: "pureekangraw-ops/standard-", number: 50, expectedHeadSha: "head-sha", ownerApproval: "GO_APPROVED", workContext: factoryWorkContext,
  }), /BIG merge approval/i);
  const result = await registry.callTool("go_hub_merge_pull_request", {
    repository: "pureekangraw-ops/standard-", number: 50, expectedHeadSha: "head-sha", ownerApproval: "BIG_APPROVED", workContext: factoryWorkContext,
  });
  assert.equal(result.structuredContent.ok, true);
  assert.equal(received.number, 50);
  assert.equal(received.ownerApproval, "BIG_APPROVED");
  assert.equal(Object.hasOwn(received, "goId"), false);
  assert.equal(Object.hasOwn(received, "jobId"), false);
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

import { createAionGate } from "./go-hub-aion.mjs";
import { readCurrentAgentMissionExposure } from "./go-hub-control-room.js";
const str = { type: "string", minLength: 1 };
const int = { type: "integer", minimum: 1 };
const revision = { type: "integer", minimum: 0 };
const obj = { type: "object" };
const priority = { type: "integer", minimum: 0, maximum: 4 };
const nullableStr = { anyOf: [{ type: "string" }, { type: "null" }] };
const broadcastRef = schemaBroadcast();
function schemaBroadcast() { return { type: "object", properties: { program: str, version: str, hash: str }, required: ["program","version","hash"], additionalProperties: false }; }
const workContext = {
  type: "object",
  properties: { workId: str, checkpointId: str },
  required: ["workId", "checkpointId"],
  additionalProperties: false,
};
const gmailAttachment = {
  type: "object",
  properties: { filename: str, mimeType: str, contentBase64: str },
  required: ["filename", "mimeType", "contentBase64"],
  additionalProperties: false,
};
const gmailDriveAttachment = {
  type: "object",
  properties: { fileId: str, filename: str, mimeType: str },
  required: ["fileId"],
  additionalProperties: false,
};
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const ann = (readOnlyHint, destructiveHint = false) => ({ readOnlyHint, destructiveHint });
const def = (name, description, operation, inputSchema, annotations) => ({
  name, description, operation, inputSchema: { ...inputSchema, properties: { ...inputSchema.properties, broadcast: broadcastRef } },
  securitySchemes: [{ type: "oauth2", scopes: ["go-hub"] }], annotations,
});

const definitions = [
  def("go_hub_broadcast_read", "Read the single GO Hub current broadcast used by version-aware speakers.", "broadcastRead", schema({}), ann(true)),
  def("go_hub_broadcast_activate", "GO changes the current GO Hub broadcast plate atomically; no Heimdall Pass or Work approval is required.", "broadcastActivate", schema({ program: str, version: str, hash: str, sourceRef: str }, ["program","version","hash","sourceRef"]), ann(false)),
  def("go_hub_inspect_repository", "Inspect repository truth and tree.", "inspect", schema({ repository: str, branch: str }, ["repository"]), ann(true)),
  def("go_hub_list_repositories", "List visible owner repositories.", "listRepositories", schema({}), ann(true)),
  def("go_hub_read_file", "Read one UTF-8 repository file.", "readFile", schema({ repository: str, path: str, ref: str }, ["repository", "path"]), ann(true)),
  def("go_hub_create_branch", "Create a non-default task branch.", "createBranch", schema({ repository: str, name: str, fromSha: str, workContext }, ["repository", "name", "fromSha", "workContext"]), ann(false)),
  def("go_hub_put_file", "Create or update one file on a task branch.", "putFile", schema({ repository: str, path: str, branch: str, expectedSha: str, content: { type: "string" }, workContext }, ["repository", "path", "branch", "content", "workContext"]), ann(false)),
  def("go_hub_delete_file", "Delete one file using exact blob SHA.", "deleteFile", schema({ repository: str, path: str, branch: str, expectedSha: str, workContext }, ["repository", "path", "branch", "expectedSha", "workContext"]), ann(false, true)),
  def("go_hub_compare_refs", "Compare base and head refs.", "compare", schema({ repository: str, base: str, head: str }, ["repository", "base", "head"]), ann(true)),
  def("go_hub_open_pull_request", "Open or update a pull request.", "openPullRequest", schema({ repository: str, branch: str, base: str, title: str, body: { type: "string" }, workContext }, ["repository", "branch", "base", "title", "workContext"]), ann(false)),
  def("go_hub_get_pull_request", "Read pull-request truth.", "getPullRequest", schema({ repository: str, number: int }, ["repository", "number"]), ann(true)),
  def("go_hub_get_ci", "Read exact-head CI evidence.", "getCI", schema({ repository: str, sha: str }, ["repository", "sha"]), ann(true)),
  def("go_hub_get_failure_evidence", "Read failed jobs and concise logs.", "getFailureEvidence", schema({ repository: str, runId: int }, ["repository", "runId"]), ann(true)),
  def("go_hub_rerun_failed_jobs", "Rerun failed workflow jobs.", "rerunFailed", schema({ repository: str, runId: int, workContext }, ["repository", "runId", "workContext"]), ann(false)),
  def("go_hub_factory_v4", "Operate the durable V4 Factory project for the same Centre Work. Work identity comes only from Work ID + Checkpoint ID.", "factoryV4", schema({ action: { type: "string", enum: ["start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish"] }, form: obj, reality: obj, inspection: obj, plan: str, result: obj, evidence: obj, checkId: str, status: str, reason: str, file: obj, ref: str, summary: str, workContext }, ["action", "workContext"]), ann(false)),
  def("go_hub_maintenance", "Run Work-bound Maintenance V4 map inspection, safe probes, repair context, or closeout planning.", "maintenance", schema({ target: { type: "string", enum: ["factory", "go-hub"] }, action: { type: "string", enum: ["inspect", "inspect_map", "run_system_check", "probe_route", "repair_context", "plan_closeout"] }, input: obj, map: obj, routeId: str, mapCheckpointId: str, projectId: str, workContext }, ["action", "workContext"]), ann(false)),
  def("go_hub_heimdall_pass", "Open or close a Work-bound Pass through Heimdall. Work identity comes only from Work ID + Checkpoint ID.", "heimdallPass", schema({ action: { type: "string", enum: ["open", "close"] }, kind: { type: "string", enum: ["WORK", "READ", "MAINTENANCE", "EMERGENCY"] }, scope: { type: "array", items: str }, destinations: { type: "array", items: str }, expiresAt: str, closeCondition: str, reason: str, audit: obj, status: str, result: obj, workContext }, ["action", "workContext"]), ann(false)),
  def("go_hub_v4_project_board", "Read Heimdall's three-way Project ref board without replacing Workspace truth.", "v4ProjectBoard", schema({ workId: str, checkpointId: str }, ["workId", "checkpointId"]), ann(true)),
  def("go_hub_aion_open", "AION ephemeral entry-only gate. Every OPEN queries CURRENT Control Room exposure, returns the current Agent Mission contract/capabilities, transfers supplied context, then closes. No stale fallback, Work creation, route selection, authority grant, monitoring, repair, or return-flow ownership.", "aionOpen", schema({ context: obj }), ann(false)),
  def("go_hub_agent_persona_room", "Explicitly enter the optional Agent Persona Room to list canonical Personas or equip one assigned Persona. This tool is never a mandatory gate, never auto-enters, and never changes Work, route, owner, or authority.", "agentPersonaRoom", schema({ action: { type:"string", enum:["list","equip"] }, agentId:str, personaId:str }, ["action"]), ann(false)),
  def("go_hub_agent_mission", "Operate HERMES Agent Mission over Centre Work Cards. New-card creation must review similar Work first; CREATE_NEW then issues canonical WORK-<KEY>-YYYYMMDD-NNN identity automatically. Supports reuse, portable context, LIGHT, HERMES-issued Standard Cards from Work truth, GO-approved route changes, touch memory, mandatory Return, and Exit. HERMES owns the user-facing route operation; Heimdall remains the internal enforcement engine and cannot expand authority beyond the confirmed card. Agent Mission does not expose a Board or mint authority.", "agentMission", schema({ action: { type:"string", enum:["find","enter","create","issue_card","prepare_route_change","confirm_route_change","select_context","note","ask_light","first_open","touch","return","update_card","exit","inspect"] }, mission:str, requestedResult:str, sessionId:str, agentId:str, workId:str, checkpointId:str, workKey:str, createDecision:{ type:"string", enum:["CREATE_NEW"] }, workType:{ type:"string", enum:["NORMAL","URGENT","MAINTENANCE","SOS"] }, destinations:{ type:"array", items:str }, scope:{ type:"array", items:str }, candidates:{ type:"array", items:obj }, selectedIds:{ type:"array", items:str }, note:str, source:str, question:str, counterId:str, confirmation:{ type:"string", enum:["GO_CONFIRMED"] }, destination:str, workspace:str, station:str, status:{ type:"string", enum:["ON PROCESS","WAIT","WAIT VERIFY","COMPLETE","CANCEL"] }, result:obj, nextAction:str, evidence:{ type:"array", items:obj }, unknowns:{ type:"array", items:str }, lastLocation:str, mode:{ type:"string", enum:["NORMAL_RETURN","RECOVERY_RETURN"] }, limit:{ type:"integer", minimum:1, maximum:20 }, threshold:{ type:"number", minimum:0, maximum:1 }, workContext }, ["action"]), ann(false)),
  def("go_hub_light_centre_v4_action", "LIGHT may inspect, claim, wait, resume, or open a Factory-scoped Work Pass for an existing V4 Work it holds. This cannot create Work, widen destinations, or Return.", "lightCentreV4Action", schema({ action: { type: "string", enum: ["v4_inspect", "v4_claim", "v4_wait", "v4_resume", "v4_open_pass"] }, workId: str, checkpointId: str, reason: str, resumeFrom: str }, ["action", "workId", "checkpointId"]), ann(false)),
  def("go_hub_light_factory_v4_action", "LIGHT may operate Factory V4 only for the same LIGHT-held Work after a Factory-scoped active Pass. Merge/delete remain unavailable.", "lightFactoryV4Action", schema({ action: { type: "string", enum: ["start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish"] }, form: obj, reality: obj, inspection: obj, plan: str, result: obj, evidence: obj, checkId: str, status: str, reason: str, file: obj, ref: str, summary: str, workContext }, ["action", "workContext"]), ann(false)),
  def("go_hub_merge_pull_request", "Merge through GitHub owner truth after exact-head CI. BIG approval is required on every merge with no exception.", "mergePullRequest", schema({ repository: str, number: int, expectedHeadSha: str, ownerApproval: { type: "string", enum: ["BIG_APPROVED"] }, goId: str, jobId: str, method: { type: "string", enum: ["merge", "squash", "rebase"] }, workContext }, ["repository", "number", "expectedHeadSha", "ownerApproval", "workContext"]), ann(false, true)),
  def("go_hub_get_workflow_runs", "Observe workflow and deployment runs.", "getWorkflowRuns", schema({ repository: str, sha: str }, ["repository", "sha"]), ann(true)),
  def("go_hub_list_workflow_artifacts", "List GitHub Actions artifacts for one workflow run, or inventory recent repository artifacts when runId is omitted.", "listWorkflowArtifacts", schema({ repository: str, runId: int }, ["repository"]), ann(true)),
  def("go_hub_archive_workflow_artifact", "Download one GitHub Actions artifact server-side, optionally extract one entry, and archive it to governed Google Drive with hash metadata and readback.", "archiveWorkflowArtifact", schema({ repository: str, runId: int, artifactId: int, parentId: str, entrySuffix: str, destinationName: str, mimeType: str, workContext }, ["repository", "runId", "artifactId", "workContext"]), ann(false)),
  def("go_hub_audit_history", "Read immutable global GO Hub audit events, optionally filtered by Work ID.", "auditHistory", schema({ workId: str, afterSequence: revision, limit: { type: "integer", minimum: 1, maximum: 200 } }), ann(true)),
  def("go_hub_centre_inspect", "Read one Centre Work truth record without allowing Centre mutation.", "centreInspect", schema({ workId: str, checkpointId: str }, ["workId", "checkpointId"]), ann(true)),
  def("go_hub_centre_audit_history", "Read Centre-only immutable audit events from the global GO Hub audit log.", "centreAuditHistory", schema({ workId: str, afterSequence: revision, limit: { type: "integer", minimum: 1, maximum: 200 } }), ann(true)),
  def("go_hub_centre_live_action", "Execute or inspect durable City/Centre live work through GO Hub.", "centreLiveAction", schema({ action: { type: "string", enum: ["start", "inspect", "claim", "renew", "release", "record_effect", "save_checkpoint", "resume_checkpoint", "review", "fit", "leave", "validate", "return", "record_reality", "cancel", "resume", "v4_create", "v4_inspect", "v4_board", "v4_claim", "v4_open_pass", "v4_update_destinations", "v4_wait", "v4_resume", "v4_return"] }, workId: str, checkpointId: str, returnAddress: str, work: obj, actor: str, status: str, kind: { type: "string", enum: ["WORK", "READ", "MAINTENANCE", "EMERGENCY"] }, destinations: { type: "array", items: str }, reason: str, result: obj, task: str, requestedResult: str, authority: str, targetId: str, personaId: str, personaReference: str, workingView: str, destination: str, payload: obj, evidence: { anyOf: [obj, { type: "array", items: obj }] }, reuseFit: { type: "boolean" }, ownerId: str, leaseId: str, expectedOwnershipRevision: revision, leaseSeconds: int, expectedEffectRevision: revision, effectId: str, effectTool: str, effectReceiptRef: str, effectStatus: str, expectedExecutionCheckpointRevision: revision, executionCheckpointId: str, resumeFrom: str, safePoint: { type: "boolean" }, snapshot: obj, reconciliationEvidence: obj }, ["action", "workId"]), ann(false)),
  def("go_hub_centre_read_only_fast_lane", "Route a pure Read -> Tell request through Centre's short read-only lane. Reads used for planning, creation, checklist work, or any mutation are escalated to normal Work.", "centreReadOnlyFastLane", schema({ purpose: { type: "string", enum: ["READ_TELL", "READ_FOR_WORK", "PLAN", "CREATE", "ACT"] }, operations: { type: "array", minItems: 1, items: { type: "string", enum: ["SEARCH", "LIST", "READ", "INSPECT", "METADATA", "CREATE", "UPDATE", "DELETE", "MOVE", "RENAME", "SHARE", "UPLOAD"] } } }, ["purpose", "operations"]), ann(true)),
  def("go_hub_lighthouse_control_port_state", "Read latest paired LIGHTHOUSE Control Port snapshot, work state, commands, and receipts.", "lighthouseControlPortState", schema({ targetId: str }, ["targetId"]), ann(true)),
  def("go_hub_lighthouse_control_port_command", "Queue one governed command for paired LIGHTHOUSE Control Port. Owner confirmation remains enforced on-device by capability guard.", "lighthouseControlPortCommand", schema({ targetId: str, requestId: str, capabilityId: str, payload: obj }, ["targetId", "requestId", "capabilityId", "payload"]), ann(false)),
  def("go_hub_project_status", "Read normalized Project Status from current GitHub truth and optional Factory task truth.", "projectStatus", schema({ targetId: str, factoryTaskId: str }, ["targetId"]), ann(true)),
  def("go_hub_board_read", "Read the GO Hub Board projection from Work truth. Work cards are primary; legacy Pin fields remain compatibility data.", "boardRead", schema({}), ann(true)),
  def("go_hub_pixie_command", "Dispatch one governed command to the pinned PIXIE LAB runtime workflow. PIXIE command allowlisting and authority boundaries remain enforced inside the PIXIE repository.", "pixieCommand", schema({ requestId: str, command: str, args: obj, workContext }, ["requestId", "command", "workContext"]), ann(false)),
  def("go_hub_pixie_go_works_action", "Operate GO WORKS directly from PIXIE LAB on the same Centre Work. The bridge preserves Work ID + Checkpoint ID, does not require a ROOM-D or local Factory Pass, and never grants merge/deploy authority.", "pixieGoWorksAction", schema({ action: { type: "string", enum: ["start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish"] }, factoryInput: obj, station: str, pixieHandoff: obj, workContext }, ["action", "factoryInput", "workContext"]), ann(false)),
  def("go_hub_pixie_debug_factory_action", "Legacy compatibility alias for the old ROOM-D bridge. It now follows the same direct PIXIE LAB → GO WORKS Work-continuity path without ROOM-D or local Pass restrictions.", "pixieDebugFactoryAction", schema({ action: { type: "string", enum: ["start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish"] }, roomId: { type: "string" }, factoryInput: obj, station: str, pixieHandoff: obj, workContext }, ["action", "factoryInput", "workContext"]), ann(false)),
  def("go_hub_pixie_result", "Read the request-bound result produced by the PIXIE LAB runtime state branch.", "pixieResult", schema({ requestId: str }, ["requestId"]), ann(true)),
  def("go_hub_counter_create", "Create one governed GO↔LIGHT Counter ticket. Authenticated MCP identity determines the sender; LIGHT creation is HANDOFF-only.", "counterCreate", schema({ counterId: str, mode: { type: "string", enum: ["SEARCH", "HANDOFF"] }, request: str, requestedResult: str, authority: str, target: str, projectRef: str, context: obj, sourceHints: { type: "array", items: str }, doNotChange: { type: "array", items: str }, workContext }, ["counterId", "request", "workContext"]), ann(false)),
  def("go_hub_counter_inbox", "List bounded pending HANDOFF Counter tickets addressed to the authenticated actor for the same WorkContext.", "counterInbox", schema({ limit: { type: "integer", minimum: 1, maximum: 50 }, workContext }, ["workContext"]), ann(true)),
  def("go_hub_counter_get", "Read the current GO↔LIGHT Counter ticket and append-only event history.", "counterGet", schema({ counterId: str, workContext }, ["counterId", "workContext"]), ann(true)),
  def("go_hub_counter_seen", "Mark one Counter ticket as seen by its authenticated recipient.", "counterSeen", schema({ counterId: str, workContext }, ["counterId", "workContext"]), ann(false)),
  def("go_hub_counter_pickup", "Explicitly accept one incoming HANDOFF Counter ticket as its authenticated recipient. This is the user-facing pickup alias for the existing SEEN transition.", "counterPickup", schema({ counterId: str, workContext }, ["counterId", "workContext"]), ann(false)),
  def("go_hub_counter_answer", "Write the authenticated recipient's bounded answer back to the same Counter ticket.", "counterAnswer", schema({ counterId: str, status: { type: "string", enum: ["ANSWERED", "WAIT", "UNKNOWN", "NEEDS_INPUT", "FAILED", "EXPIRED"] }, answer: str, sources: { type: "array", items: str }, evidence: { type: "array", items: obj }, confidence: { type: "string" }, nextRoute: { type: "string" }, workContext }, ["counterId", "status", "answer", "workContext"]), ann(false)),
  def("go_hub_counter_readback", "Record the authenticated originator's readback on the same Counter ticket and close it by default.", "counterReadback", schema({ counterId: str, evidence: obj, close: { type: "boolean" }, workContext }, ["counterId", "evidence", "workContext"]), ann(false)),
  def("go_hub_observer_latest", "Read latest sanitized Browser Observer evidence.", "observerLatest", schema({}), ann(true)),
  def("go_hub_observer_screenshot", "Read one consented Browser Observer screenshot by ref.", "observerScreenshot", schema({ screenshotRef: str }, ["screenshotRef"]), ann(true)),
  def("go_hub_linear_list_projects", "List projects scoped to the configured Linear team.", "linearListProjects", schema({}), ann(true)),
  def("go_hub_linear_get_issue", "Read one Linear issue and enforce configured-team scope.", "linearGetIssue", schema({ identifier: str }, ["identifier"]), ann(true)),
  def("go_hub_linear_create_issue", "Create a Linear issue in the configured team.", "linearCreateIssue", schema({ title: str, description: nullableStr, projectId: nullableStr, priority, workContext }, ["title", "workContext"]), ann(false)),
  def("go_hub_linear_update_issue", "Update an in-team Linear issue after a scoped read.", "linearUpdateIssue", schema({ identifier: str, title: str, description: nullableStr, priority, stateId: nullableStr, projectId: nullableStr, workContext }, ["identifier", "workContext"]), ann(false)),
  def("go_hub_cloudflare_capabilities", "Inspect GO Hub Cloudflare bridge configuration without exposing credentials.", "cloudflareCapabilities", schema({}), ann(true)),
  def("go_hub_cloudflare_health", "Verify Cloudflare account authentication and Workers API reachability without exposing credentials.", "cloudflareHealth", schema({}), ann(true)),
  def("go_hub_cloudflare_list_workers", "List sanitized Cloudflare Worker metadata for the configured account.", "cloudflareListWorkers", schema({}), ann(true)),
  def("go_hub_cloudflare_inspect_worker", "Read sanitized Worker bindings and deployment metadata without returning secret values.", "cloudflareInspectWorker", schema({ scriptName: str }, ["scriptName"]), ann(true)),
  def("go_hub_gmail_capabilities", "Inspect governed Gmail bridge configuration.", "gmailCapabilities", schema({}), ann(true)),
  def("go_hub_gmail_diagnostics", "Read sanitized Gmail OAuth diagnostics.", "gmailDiagnostics", schema({}), ann(true)),
  def("go_hub_gmail_profile", "Read Gmail profile metadata.", "gmailProfile", schema({}), ann(true)),
  def("go_hub_gmail_search", "Search Gmail messages using Gmail query syntax.", "gmailSearch", schema({ query: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 100 }, pageToken: str }), ann(true)),
  def("go_hub_gmail_get_message", "Read one Gmail message.", "gmailGetMessage", schema({ messageId: str, format: { type: "string", enum: ["minimal","full","metadata"] } }, ["messageId"]), ann(true)),
  def("go_hub_gmail_send_message", "Send one Gmail message, optionally as a threaded reply with bounded attachments, through governed mutation.", "gmailSendMessage", schema({ to: str, subject: str, body: str, threadId: str, inReplyTo: str, references: str, attachments: { type: "array", maxItems: 5, items: gmailAttachment }, driveAttachments: { type: "array", maxItems: 5, items: gmailDriveAttachment }, workContext }, ["to","subject","body","workContext"]), ann(false)),
  def("go_hub_calendar_capabilities", "Inspect governed Google Calendar bridge configuration.", "calendarCapabilities", schema({}), ann(true)),
  def("go_hub_calendar_diagnostics", "Read sanitized Calendar OAuth diagnostics.", "calendarDiagnostics", schema({}), ann(true)),
  def("go_hub_calendar_list", "List visible Google calendars.", "calendarList", schema({ maxResults: { type: "integer", minimum: 1, maximum: 250 }, pageToken: str }), ann(true)),
  def("go_hub_calendar_events", "List events from one Google calendar.", "calendarEvents", schema({ calendarId: str, timeMin: str, timeMax: str, maxResults: { type: "integer", minimum: 1, maximum: 250 }, pageToken: str }), ann(true)),
  def("go_hub_calendar_create_event", "Create one Google Calendar event through governed mutation.", "calendarCreateEvent", schema({ calendarId: str, summary: str, description: { type: "string" }, location: { type: "string" }, start: obj, end: obj, workContext }, ["summary","start","end","workContext"]), ann(false)),
  def("go_hub_drive_capabilities", "Inspect GO Hub Google Drive bridge configuration and supported operations without exposing credentials.", "driveCapabilities", schema({}), ann(true)),
  def("go_hub_drive_health", "Verify server-side Google Drive authentication and upstream API reachability without returning account data.", "driveHealth", schema({}), ann(true)),
  def("go_hub_drive_diagnostics", "Read sanitized Google Drive runtime account identity and granted OAuth scopes without exposing credentials.", "driveDiagnostics", schema({}), ann(true)),
  def("go_hub_drive_root", "Read the governed Google Drive root metadata used by GO Hub.", "driveRoot", schema({}), ann(true)),
  def("go_hub_drive_get_item", "Read normalized Google Drive item metadata by file or folder ID.", "driveGetItem", schema({ fileId: str }, ["fileId"]), ann(true)),
  def("go_hub_drive_list_children", "List normalized Google Drive children under one folder ID.", "driveListChildren", schema({ parentId: str, pageSize: { type: "integer", minimum: 1, maximum: 1000 }, pageToken: str }, ["parentId"]), ann(true)),
  def("go_hub_drive_read_document", "Read text from one native Google Doc inside the governed Drive scope.", "driveReadDocument", schema({ documentId: str, maxChars: { type: "integer", minimum: 1000, maximum: 200000 } }, ["documentId"]), ann(true)),
  def("go_hub_drive_download_file", "Download one bounded binary file from governed Google Drive with SHA-256 verification data.", "driveDownloadFile", schema({ fileId: str, maxBytes: { type: "integer", minimum: 1, maximum: 8388608 } }, ["fileId"]), ann(true)),
  def("go_hub_drive_create_folder", "Create a Google Drive folder and require destination readback before success.", "driveCreateFolder", schema({ parentId: str, name: str, workContext }, ["parentId", "name", "workContext"]), ann(false)),
  def("go_hub_drive_upload_file", "Upload one bounded file into the governed Drive scope with SHA-256 verification and destination readback.", "driveUploadFile", schema({ parentId: str, name: str, mimeType: str, contentBase64: str, sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" }, size: { type: "integer", minimum: 1, maximum: 8388608 }, workContext }, ["parentId", "name", "contentBase64", "sha256", "workContext"]), ann(false)),
  def("go_hub_drive_move_item", "Move an existing Google Drive item with native parent update and require destination readback before success.", "driveMoveItem", schema({ fileId: str, destinationFolderId: str, workContext }, ["fileId", "destinationFolderId", "workContext"]), ann(false)),
  def("go_hub_drive_rename_item", "Rename an existing Google Drive item and require readback before success.", "driveRenameItem", schema({ fileId: str, name: str, workContext }, ["fileId", "name", "workContext"]), ann(false)),
];

const factoryTools = new Set(["go_hub_create_branch", "go_hub_put_file", "go_hub_delete_file", "go_hub_open_pull_request", "go_hub_rerun_failed_jobs", "go_hub_merge_pull_request", "go_hub_factory_v4"]);
const maintenanceTools = new Set(["go_hub_maintenance"]);
const linearMutationTools = new Set(["go_hub_linear_create_issue", "go_hub_linear_update_issue"]);
const gmailMutationTools = new Set(["go_hub_gmail_send_message"]);
const calendarMutationTools = new Set(["go_hub_calendar_create_event"]);
const driveMutationTools = new Set(["go_hub_drive_create_folder", "go_hub_drive_upload_file", "go_hub_drive_move_item", "go_hub_drive_rename_item", "go_hub_archive_workflow_artifact"]);
const counterTools = new Set(["go_hub_counter_create", "go_hub_counter_inbox", "go_hub_counter_get", "go_hub_counter_seen", "go_hub_counter_answer", "go_hub_counter_readback"]);
const pixieMutationTools = new Set(["go_hub_pixie_command", "go_hub_pixie_go_works_action", "go_hub_pixie_debug_factory_action"]);

function assertArgs(definition, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("invalid MCP tool arguments");
  for (const field of definition.inputSchema.required) {
    if (!(field in args) || args[field] === "" || args[field] == null) throw new Error("missing required argument: " + field);
  }
  for (const key of Object.keys(args)) if (!Object.hasOwn(definition.inputSchema.properties, key)) throw new Error("unknown argument: " + key);
  const actionSchema = definition.inputSchema.properties.action;
  if (actionSchema?.enum && args.action != null && !actionSchema.enum.includes(args.action)) throw new Error("invalid action");
  if (definition.name === "go_hub_merge_pull_request" && args.ownerApproval !== "BIG_APPROVED") throw new Error("BIG merge approval is required");
  if (definition.inputSchema.properties.expectedRevision && args.expectedRevision != null &&
      (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0)) {
    throw new Error("invalid expectedRevision");
  }
}

function assertWork(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workContext is required");
  for (const field of workContext.required) if (!String(value[field] || "").trim()) throw new Error("workContext missing field: " + field);
  for (const key of Object.keys(value)) if (!Object.hasOwn(workContext.properties, key)) throw new Error("unknown workContext field: " + key);
}

const CARD_BOOTSTRAP_TOOLS = new Set(["go_hub_broadcast_read","go_hub_broadcast_activate","go_hub_aion_open","go_hub_agent_mission"]);
function cardToolAllowed(card, toolName) {
  const scope = String(card?.access_scope || "").trim().toUpperCase();
  if (scope === "MAINTENANCE") return true;
  if (scope !== "WORK") return false;
  return Array.isArray(card?.tool_access) && card.tool_access.includes(toolName);
}
async function assertCardAccess(lifecycle, name, args) {
  if (CARD_BOOTSTRAP_TOOLS.has(name)) return;
  assertWork(args.workContext);
  if (typeof lifecycle.agentMission !== "function") throw new Error("HERMES_CARD_READER_UNAVAILABLE");
  const response = await lifecycle.agentMission({ action:"inspect", workContext:args.workContext });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.card) throw new Error("CURRENT_HERMES_CARD_REQUIRED");
  if (!cardToolAllowed(body.card, name)) throw new Error("CARD_TOOL_ACCESS_DENIED");
}
function assertLifecycle(name, args) {
  if (factoryTools.has(name) || linearMutationTools.has(name) || maintenanceTools.has(name) ||
      driveMutationTools.has(name) || gmailMutationTools.has(name) || calendarMutationTools.has(name) ||
      counterTools.has(name) || pixieMutationTools.has(name)) assertWork(args.workContext);
}

async function toolResult(response, broadcastReadback = null) {
  const payload = await response.json().catch(() => ({ code: "INVALID_TOOL_RESPONSE" }));
  const structuredContent = payload && typeof payload === "object" && !Array.isArray(payload) && broadcastReadback
    ? { ...payload, broadcastReadback }
    : payload;
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent, ...(response.ok ? {} : { isError: true }) };
}

function speakerError(result) {
  return new Response(JSON.stringify(result), { status: 409, headers: { "content-type": "application/json; charset=utf-8" } });
}

function withoutWorkContext(definition) {
  const copy = structuredClone(definition);
  if (!copy.inputSchema?.properties?.workContext) return copy;
  delete copy.inputSchema.properties.workContext;
  copy.inputSchema.required = (copy.inputSchema.required || []).filter(field => field !== "workContext");
  return copy;
}

export function createMcpRegistry({ lifecycle, speaker = null, workContextOptionalTools = [], currentTools = null, enforceCardAccess = false } = {}) {
  if (!lifecycle) throw new Error("lifecycle service is required");
  const optionalWorkContext = new Set(workContextOptionalTools);
  const publishedDefinitions = definitions.map(item => {
    if (!enforceCardAccess || CARD_BOOTSTRAP_TOOLS.has(item.name) || optionalWorkContext.has(item.name)) {
      return optionalWorkContext.has(item.name) ? withoutWorkContext(item) : item;
    }
    const copy = structuredClone(item);
    if (!copy.inputSchema.properties.workContext) copy.inputSchema.properties.workContext = workContext;
    if (!copy.inputSchema.required.includes("workContext")) copy.inputSchema.required.push("workContext");
    return copy;
  });
  const byName = new Map(publishedDefinitions.map(item => [item.name, item]));
  return Object.freeze({
    listTools() {
      return publishedDefinitions.map(({ operation, ...tool }) => structuredClone(tool));
    },
    async callTool(name, args = {}) {
      const definition = byName.get(name);
      if (!definition) throw new Error("unknown MCP tool: " + name);
      assertArgs(definition, args);
      if (!optionalWorkContext.has(name)) assertLifecycle(name, args);
      if (enforceCardAccess) await assertCardAccess(lifecycle, name, args);
      let broadcastReadback = null;
      if (typeof speaker === "function" && name !== "go_hub_broadcast_activate") {
        const heard = await speaker({ area: definition.operation, observed: args.broadcast || null });
        if (!heard?.ok) return toolResult(speakerError(heard));
        broadcastReadback = heard.current || null;
      }
      if (name === "go_hub_aion_open") {
        const gate = createAionGate({
          queryControlRoom: async () => ({
            ...readCurrentAgentMissionExposure({
              listTools: typeof currentTools === "function"
                ? currentTools
                : () => publishedDefinitions.map(({ operation, ...tool }) => structuredClone(tool)),
            }),
            broadcast:broadcastReadback,
          }),
        });
        const opened = await gate.open(args);
        const respond = (payload, status = 200) => toolResult(new Response(JSON.stringify(payload), {
          status, headers:{ "content-type":"application/json" },
        }), broadcastReadback);
        if (!opened.ok) return respond(opened, 409);
        const context = opened.transfer.context;
        const workId = String(context.workId || "").trim();
        const checkpointId = String(context.checkpointId || "").trim();
        const mission = String(context.mission || "").trim();
        let missionInput;
        if (workId && checkpointId) {
          missionInput = { action:"enter", workId, checkpointId, agentId:"GO" };
          if (mission) missionInput.mission = mission;
          if (context.requestedResult) missionInput.requestedResult = context.requestedResult;
        } else if (!workId && !checkpointId && mission) {
          missionInput = { action:"find", mission };
        } else {
          return respond({ ...opened, ok:false, status:"UNKNOWN", reason:"MISSION_CONTEXT_REQUIRED",
            transfer:null, handoff:null }, 409);
        }
        if (typeof lifecycle.agentMission !== "function") {
          return respond({ ...opened, ok:false, status:"UNKNOWN", reason:"CURRENT_AGENT_MISSION_UNAVAILABLE",
            transfer:null, handoff:null }, 503);
        }
        const missionResponse = await lifecycle.agentMission(missionInput);
        const readback = await missionResponse.json().catch(() => ({ code:"INVALID_MISSION_READBACK" }));
        const arrived = missionResponse.ok && readback?.ok === true;
        return respond({
          ...opened, ok:arrived, status:arrived ? "CURRENT" : "UNKNOWN",
          reason:arrived ? "CURRENT_AGENT_MISSION_REACHED" : "AGENT_MISSION_HANDOFF_REJECTED",
          transfer:arrived ? opened.transfer : null,
          handoff:{ action:missionInput.action, status:arrived ? "ARRIVED" : "REJECTED", readback },
        }, arrived ? 200 : 409);
      }
      const operation = lifecycle[definition.operation];
      if (typeof operation !== "function") throw new Error("lifecycle operation unavailable: " + definition.operation);
      return toolResult(await operation(args), broadcastReadback);
    },
  });
}

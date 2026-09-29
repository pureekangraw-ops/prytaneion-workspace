export const AGENT_MISSION_ACTIONS = Object.freeze([
  "find",
  "enter",
  "create",
  "issue_card",
  "prepare_route_change",
  "confirm_route_change",
  "select_context",
  "note",
  "ask_light",
  "first_open",
  "touch",
  "return",
  "update_card",
  "exit",
  "inspect",
]);

export function isCurrentAgentMissionTool(tool) {
  const actions = tool?.inputSchema?.properties?.action?.enum;
  return tool?.name === "go_hub_agent_mission" &&
    tool?.inputSchema?.type === "object" &&
    Array.isArray(actions) &&
    tool.inputSchema.required?.includes("action") &&
    AGENT_MISSION_ACTIONS.every(action => actions.includes(action));
}

const ACTIVE_CENTRE = new Set(["ACTIVE", "ON PROCESS", "DOING", "PROCESSING"]);
const IDLE_PROJECT = new Set(["IDLE", "UNKNOWN", ""]);
const STATUS_VALUES = new Set(["PASS", "LIVE", "VERIFIED", "CONFLICT", "MISMATCH", "STALE", "UNKNOWN"]);

function text(value) { return String(value ?? "").trim(); }
function upper(value) { return text(value).toUpperCase(); }
function clone(value) { return value == null ? value : structuredClone(value); }
function timestamp(value) { const parsed = Date.parse(text(value)); return Number.isFinite(parsed) ? parsed : null; }
function evidenceRef(value) { return text(value) || null; }

function freshness(updatedAt, { now = Date.now(), staleAfterMs = 24 * 60 * 60 * 1000 } = {}) {
  const at = timestamp(updatedAt);
  if (at == null) return "UNKNOWN";
  return now - at > staleAfterMs ? "STALE" : "LIVE";
}

export function compareCentreProjectStatus({ centreStatus, projectStatus } = {}) {
  const centre = upper(centreStatus);
  const project = upper(projectStatus);
  if (!centre || !project) {
    return Object.freeze({ status: "UNKNOWN", reason: "STATUS_SOURCE_INCOMPLETE", centreStatus: centre || null, projectStatus: project || null });
  }
  if (ACTIVE_CENTRE.has(centre) && IDLE_PROJECT.has(project)) {
    return Object.freeze({ status: "CONFLICT", reason: "CENTRE_ACTIVE_PROJECT_IDLE", centreStatus: centre, projectStatus: project });
  }
  return Object.freeze({ status: "PASS", reason: "STATUS_AGREEMENT_OR_NON_CONFLICT", centreStatus: centre, projectStatus: project });
}

export function classifyBoardResidue(board = {}, options = {}) {
  if (!board || typeof board !== "object") {
    return Object.freeze({ status: "UNKNOWN", reason: "BOARD_SOURCE_UNAVAILABLE", classification: "UNKNOWN" });
  }
  const updatedAt = text(board.updatedAt || board.lastUpdated || board.observedAt);
  const stale = freshness(updatedAt, options) === "STALE";
  const residue = Boolean(board.residue || board.smokeResidue || board.legacyProjection || board.staleProjection);
  const marker = upper(board.classification);
  if (stale || residue || marker === "STALE" || marker === "RESIDUE" || marker === "LEGACY") {
    return Object.freeze({
      status: "STALE",
      reason: residue ? "BOARD_SMOKE_OR_PROJECTION_RESIDUE" : "BOARD_OBSERVATION_STALE",
      classification: residue ? "STALE_PROJECTION_RESIDUE" : "STALE",
      updatedAt: updatedAt || null,
      evidenceRef: evidenceRef(board.evidenceRef),
    });
  }
  if (!updatedAt) return Object.freeze({ status: "UNKNOWN", reason: "BOARD_TIMESTAMP_UNKNOWN", classification: "UNKNOWN" });
  return Object.freeze({ status: "PASS", reason: "BOARD_OBSERVATION_FRESH", classification: "LIVE", updatedAt, evidenceRef: evidenceRef(board.evidenceRef) });
}

export function proveDeploymentProvenance({ githubSha, cloudflareSha, cloudflareDeployment, evidenceRef: ref } = {}) {
  const github = text(githubSha);
  const cloudflare = text(cloudflareSha || cloudflareDeployment?.sha || cloudflareDeployment?.sourceSha);
  const evidence = evidenceRef(ref || cloudflareDeployment?.evidenceRef);
  if (!github || !cloudflare) {
    return Object.freeze({ status: "UNKNOWN", reason: "EXACT_SHA_LINKAGE_UNAVAILABLE", githubSha: github || null, cloudflareSha: cloudflare || null, evidenceRef: evidence });
  }
  if (github !== cloudflare) {
    return Object.freeze({ status: "MISMATCH", reason: "GITHUB_CLOUDFLARE_SHA_MISMATCH", githubSha: github, cloudflareSha: cloudflare, evidenceRef: evidence });
  }
  return Object.freeze({ status: "VERIFIED", reason: "EXACT_SHA_LINKAGE_PROVED", githubSha: github, cloudflareSha: cloudflare, evidenceRef: evidence });
}

function capabilityView(capabilities = []) {
  return (Array.isArray(capabilities) ? capabilities : [])
    .filter(item => item && typeof item === "object" && (item.available === true || item.enabled === true))
    .map(item => Object.freeze({ id: text(item.id || item.name), label: text(item.label || item.name || item.id), mode: text(item.mode) || "READ" }))
    .filter(item => item.id);
}


function responseForToolStatus(status) {
  if (status === "AUTH_REQUIRED") return Object.freeze({ owner:"GO", action:"AUTHORIZE" });
  if (status === "STALE") return Object.freeze({ owner:"SOURCE_OWNER", action:"REFRESH" });
  if (status === "OFFLINE" || status === "DEGRADED") return Object.freeze({ owner:"MAINTENANCE", action:"DIAGNOSE_REPROBE" });
  if (status === "UNKNOWN") return Object.freeze({ owner:"HERMES", action:"INSPECT_REALITY" });
  if (status === "NOT_CONFIGURED" || status === "NOT_EXPOSED") return Object.freeze({ owner:"GO", action:"DECIDE_ENABLEMENT" });
  return Object.freeze({ owner:null, action:null });
}

export function normalizeToolReality(sources = {}) {
  const entries = Object.entries(sources && typeof sources === "object" ? sources : {});
  return Object.freeze(Object.fromEntries(entries.map(([name, value]) => {
    const source = value && typeof value === "object" ? value : {};
    const exposed = source.exposed !== false;
    const configured = source.configured === true;
    const authenticated = source.authenticated === true;
    const raw = upper(source.status || source.health || source.freshness);
    let status = "UNKNOWN";
    if (!exposed) status = "NOT_EXPOSED";
    else if (!configured) status = "NOT_CONFIGURED";
    else if (source.authRequired === true || raw === "AUTH_REQUIRED") status = "AUTH_REQUIRED";
    else if (raw === "STALE") status = "STALE";
    else if (["OFFLINE","UNAVAILABLE","HUB_UNAVAILABLE","SESSION_INACTIVE"].includes(raw)) status = "OFFLINE";
    else if (["DEGRADED","CAUTION"].includes(raw)) status = "DEGRADED";
    else if (authenticated && ["LIVE","PASS","VERIFIED","CURRENT",""].includes(raw)) status = "LIVE";
    return [name, Object.freeze({
      status, exposed, configured, authenticated,
      reason:text(source.reason || source.code) || null,
      evidenceRef:evidenceRef(source.evidenceRef),
      response:responseForToolStatus(status),
    })];
  })));
}

export function correlateControlRoomTruth(input = {}, options = {}) {
  const centre = input.centre || input.centreTruth || {};
  const project = input.projectStatus || input.project || {};
  const board = input.board || input.boardTruth || {};
  const github = input.github || input.githubTruth || {};
  const cloudflare = input.cloudflare || input.cloudflareTruth || {};
  const status = compareCentreProjectStatus({
    centreStatus: centre.status || centre.workStatus,
    projectStatus: project.status || project.projectStatus,
  });
  const boardSignal = classifyBoardResidue(board, options);
  const provenance = proveDeploymentProvenance({
    githubSha: github.sha || github.headSha,
    cloudflareSha: cloudflare.sha || cloudflare.deploymentSha,
    cloudflareDeployment: cloudflare.deployment,
    evidenceRef: cloudflare.evidenceRef || github.evidenceRef,
  });
  const signals = [status, boardSignal, provenance];
  const hasConflict = signals.some(item => ["CONFLICT", "MISMATCH"].includes(item.status));
  const hasUnknown = signals.some(item => item.status === "UNKNOWN");
  return Object.freeze({
    version: 1,
    overall: hasConflict ? "CONFLICT" : (hasUnknown ? "UNKNOWN" : "LIVE"),
    centreProject: status,
    board: boardSignal,
    deploymentProvenance: provenance,
    toolReality: normalizeToolReality(input.toolReality || {}),
    sourceStatus: Object.freeze({
      centre: upper(centre.status || centre.workStatus) || "UNKNOWN",
      project: upper(project.status || project.projectStatus) || "UNKNOWN",
      github: upper(github.status || (github.headSha || github.sha ? "LIVE" : "UNKNOWN")) || "UNKNOWN",
      factory: upper((input.factory || {}).status) || "UNKNOWN",
      cloudflare: upper(cloudflare.status || (cloudflare.deployment || cloudflare.sha ? "LIVE" : "UNKNOWN")) || "UNKNOWN",
    }),
    incidents: clone(input.incidents || []),
    timeline: clone(input.timeline || []),
    availableControls: capabilityView(input.capabilities || input.controls),
    safety: Object.freeze({ mutationPerformed: false, secretsExposed: false, unknownPreserved: true, autoRefresh: input.autoRefresh === true }),
  });
}

export function createRealitySurface(correlated = {}) {
  const sourceStatus = correlated?.sourceStatus && typeof correlated.sourceStatus === "object"
    ? correlated.sourceStatus
    : {};
  const toolReality = correlated?.toolReality && typeof correlated.toolReality === "object"
    ? correlated.toolReality
    : {};
  const sources = Object.entries(sourceStatus).map(([source, status]) => Object.freeze({ source, status:upper(status) || "UNKNOWN" }));
  const tools = Object.entries(toolReality).map(([tool, value]) => Object.freeze({
    tool,
    status:upper(value?.status) || "UNKNOWN",
    response:clone(value?.response || null),
    evidenceRef:evidenceRef(value?.evidenceRef),
  }));
  const truthSignals = [
    ["CENTRE_PROJECT", correlated?.centreProject],
    ["BOARD", correlated?.board],
    ["DEPLOYMENT_PROVENANCE", correlated?.deploymentProvenance],
  ].map(([signal, value]) => Object.freeze({
    signal,
    status:upper(value?.status) || "UNKNOWN",
    reason:text(value?.reason) || null,
  }));
  const unknowns = [
    ...truthSignals.filter(item => item.status === "UNKNOWN").map(item => item.signal),
    ...sources.filter(item => item.status === "UNKNOWN").map(item => item.source),
    ...tools.filter(item => item.status === "UNKNOWN").map(item => item.tool),
  ];
  const attention = [
    ...truthSignals.filter(item => !["PASS","LIVE","VERIFIED"].includes(item.status)),
    ...tools.filter(item => !["LIVE"].includes(item.status)),
  ];
  return Object.freeze({
    kind:"GO_HUB_REALITY_SURFACE",
    mode:"READ_ONLY",
    overall:upper(correlated?.overall) || "UNKNOWN",
    sources:Object.freeze(sources),
    truthSignals:Object.freeze(truthSignals),
    tools:Object.freeze(tools),
    unknowns:Object.freeze([...new Set(unknowns)]),
    attention:Object.freeze(attention),
    incidents:Object.freeze(clone(Array.isArray(correlated?.incidents) ? correlated.incidents : [])),
    controls:Object.freeze(clone(Array.isArray(correlated?.availableControls) ? correlated.availableControls : [])),
  });
}

export function assertGoControlRoomEntry({ work, actor, authority = "GO" } = {}) {
  if (!work || !text(work.workId)) throw new Error("GO_CONTROL_ROOM_WORK_REQUIRED");
  // GO-only is an existing authority boundary, not a new holder or Pass gate.
  // LIGHT may implement/observe while the Work is held by LIGHT; the GO Hub
  // surface remains the authority-owned entry point.
  if (text(actor) && text(actor) !== "GO") throw new Error("GO_CONTROL_ROOM_GO_ONLY");
  if (text(authority) !== "GO") throw new Error("GO_CONTROL_ROOM_GO_AUTHORITY_REQUIRED");
  return true;
}

export function createGoControlRoom({ work, actor, authority = "GO", observations = {}, capabilities = [] } = {}) {
  assertGoControlRoomEntry({ work, actor, authority });
  const correlated = correlateControlRoomTruth({ ...observations, capabilities });
  return Object.freeze({
    room: "GO_CONTROL_ROOM",
    mode: "LIVE_OBSERVATION_AND_AVAILABLE_CONTROLS",
    entryAuthority: "GO",
    workId: text(work.workId),
    checkpointId: text(work.checkpointId) || null,
    sections: Object.freeze(["CENTRE", "GITHUB", "FACTORY", "CLOUDFLARE", "BOARD", "INCIDENTS", "TIMELINE"]),
    observations: correlated,
    realitySurface: createRealitySurface(correlated),
    controls: correlated.availableControls,
    refresh: Object.freeze({ mode: "AUTO_REFRESH_LIVE_OBSERVATIONS", mutates: false }),
  });
}

export function createCurrentExposureSurface(tools = []) {
  const list = Array.isArray(tools) ? tools : [];
  const rows = list
    .filter(tool => tool && typeof tool === "object" && text(tool.name))
    .map(tool => Object.freeze({
      name:text(tool.name),
      readOnly:tool?.annotations?.readOnlyHint === true,
      destructive:tool?.annotations?.destructiveHint === true,
    }));
  const currentMission = list.find(isCurrentAgentMissionTool) || null;
  return Object.freeze({
    kind:"GO_HUB_CURRENT_EXPOSURE_SURFACE",
    mode:"READ_ONLY",
    status:currentMission ? "CURRENT" : "UNKNOWN",
    counts:Object.freeze({
      total:rows.length,
      readOnly:rows.filter(item => item.readOnly).length,
      mutable:rows.filter(item => !item.readOnly).length,
      destructive:rows.filter(item => item.destructive).length,
    }),
    agentMission:currentMission ? Object.freeze({
      name:"go_hub_agent_mission",
      status:"CURRENT",
      actions:Object.freeze(clone(currentMission?.inputSchema?.properties?.action?.enum || [])),
    }) : Object.freeze({ name:"go_hub_agent_mission", status:"UNKNOWN", actions:Object.freeze([]) }),
  });
}

export function readCurrentAgentMissionExposure({ listTools, now = () => new Date().toISOString() } = {}) {
  const observedAt = now();
  let tools;
  try {
    tools = typeof listTools === "function" ? listTools() : null;
  } catch {
    tools = null;
  }
  const entry = Array.isArray(tools) ? tools.find(isCurrentAgentMissionTool) : null;
  if (!Array.isArray(tools) || !isCurrentAgentMissionTool(entry)) {
    return Object.freeze({
      status:"UNKNOWN", source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST",
      reason:"CURRENT_AGENT_MISSION_CONTRACT_UNVERIFIED", observedAt, tools:[],
      surface:createCurrentExposureSurface([]),
    });
  }
  return Object.freeze({
    status:"CURRENT", source:"GO_CONTROL_ROOM_CURRENT_MCP_LIST",
    observedAt, tools:clone(tools),
    surface:createCurrentExposureSurface(tools),
  });
}

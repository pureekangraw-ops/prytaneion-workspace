export const AGENT_FAMILY_VERSION = "AGENT_FAMILY_V1";

export const AGENT_LIFECYCLE = Object.freeze([
  "RECEIVE",
  "RESOLVE",
  "PLAN",
  "AUTHORIZE",
  "EXECUTE",
  "VERIFY",
  "RETURN",
]);

export const AGENT_EXCEPTION_STATES = Object.freeze([
  "WAIT",
  "BLOCKED",
  "UNKNOWN",
  "REPAIR_REQUIRED",
]);

export const AGENT_TERMINAL_STATES = Object.freeze(["COMPLETE", "CANCELLED"]);

export const REPORT_TARGETS = Object.freeze(["BIG", "GO", "LIGHT"]);

export const AGENT_FAMILY_POLICY = Object.freeze({
  workTruthOwner:"CENTRE",
  intakeSurface:"COUNTER",
  rule:"COUNTER_SEAT_TO_HOME_RUNTIME_TO_VERIFIED_RETURN",
  toolSuccessIsCompletion:false,
  writeRequiresReadback:true,
  riskyExternalEffectRequiresApproval:true,
  agentMayCreateSecondWorkTruth:false,
  agentMayExpandOwnAuthority:false,
  returnToCentre:["STATUS","RESULT","EVIDENCE","ARTIFACT_REF","SUMMARY","NEXT_ACTION"],
});

const freezeRole = role => Object.freeze({
  ...role,
  reportsTo:Object.freeze([...(role.reportsTo || [])]),
  capabilities:Object.freeze([...(role.capabilities || [])]),
});

export const AGENT_ROLES = Object.freeze({
  PIXIE:freezeRole({
    id:"PIXIE",
    role:"GO_SECRETARY_FACTORY_ASSISTANT",
    homeRuntime:"PIXIE_LAB_GO_WORKS",
    counterSeat:"ACTIVE",
    reportsTo:["GO"],
    capabilities:["FACTORY_EXECUTION","REQUEST_MONITORING","RESULT_READBACK","GO_OPERATIONS_BRIEF"],
  }),
  SPECTRUM:freezeRole({
    id:"SPECTRUM",
    displayName:"SPECTRUM PRIME",
    rank:"PRIME",
    role:"BIG_SECRETARY_WEB_MANAGER_CENTRE_COORDINATOR",
    homeRuntime:"WEB_OFFICE_STOREFRONT",
    counterSeat:"ACTIVE",
    reportsTo:["BIG","GO"],
    capabilities:["WEB_COORDINATION","OFFICE_REPORTING","STOREFRONT_INTAKE","BIG_STATUS_BRIEF"],
  }),
  HERMES:freezeRole({
    id:"HERMES",
    role:"CENTRAL_TRANSPORT_HANDOFF_AGENT",
    homeRuntime:"CENTRE_TRANSPORT_STATION",
    counterSeat:"ACTIVE",
    stationary:true,
    reportsTo:["BIG","GO","LIGHT"],
    capabilities:["WORK_TABLET","CONTEXT_HANDOFF","RESULT_TRANSPORT","CONTINUITY"],
  }),
  MIMIR:freezeRole({
    id:"MIMIR",
    role:"CENTRE_HOUSEKEEPING_AGENT",
    homeRuntime:"CENTRE_HOUSEKEEPING",
    counterSeat:"DEFINED_NOT_PUBLISHED",
    reportsTo:["BIG","GO","LIGHT"],
    capabilities:["ORGANIZE","CLASSIFY","DUPLICATE_SCAN","ARCHIVE_PLAN","HOUSEKEEPING_REPORT"],
  }),
  LIGHT:freezeRole({
    id:"LIGHT",
    role:"KNOWLEDGE_MANAGER",
    homeRuntime:"NOTION_KNOWLEDGE_RUNTIME",
    counterSeat:"ACTIVE",
    reportsTo:["BIG","GO"],
    capabilities:["RESEARCH","KNOWLEDGE_CURATION","KNOWLEDGE_BRIEF","EVIDENCE_GAP_REPORT"],
  }),
});

export const CURRENT_COUNTER_HELPERS = Object.freeze(
  Object.values(AGENT_ROLES)
    .filter(role => role.counterSeat === "ACTIVE")
    .map(role => role.id),
);

const LIFE = new Set(AGENT_LIFECYCLE);
const EXCEPTIONS = new Set(AGENT_EXCEPTION_STATES);
const TERMINAL = new Set(AGENT_TERMINAL_STATES);

function required(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(label + " is required");
  return result;
}

export function getAgentRole(agentId) {
  const id = required(agentId, "agentId").toUpperCase();
  const role = AGENT_ROLES[id];
  if (!role) throw new Error("AGENT_ROLE_UNKNOWN:" + id);
  return role;
}

export function isAgentState(value) {
  const state = String(value ?? "").trim().toUpperCase();
  return LIFE.has(state) || EXCEPTIONS.has(state) || TERMINAL.has(state);
}

export function createAgentWorkEnvelope(input = {}) {
  const agent = getAgentRole(input.agentId);
  const state = String(input.state || "RECEIVE").trim().toUpperCase();
  if (!isAgentState(state)) throw new Error("AGENT_STATE_INVALID:" + state);
  const workId = required(input.workId, "workId");
  const checkpointId = required(input.checkpointId, "checkpointId");
  const requestedResult = required(input.requestedResult, "requestedResult");
  return Object.freeze({
    contract:AGENT_FAMILY_VERSION,
    agentId:agent.id,
    role:agent.role,
    workId,
    checkpointId,
    requestedResult,
    state,
    counterSeat:agent.counterSeat,
    homeRuntime:agent.homeRuntime,
    reportsTo:agent.reportsTo,
    ownerSource:String(input.ownerSource || "CENTRE").trim().toUpperCase(),
    acceptanceCriteria:Object.freeze([...(input.acceptanceCriteria || [])].map(String).filter(Boolean)),
    nextAction:input.nextAction == null ? null : String(input.nextAction),
  });
}

export function nextAgentState(current, next) {
  const from = String(current ?? "").trim().toUpperCase();
  const to = String(next ?? "").trim().toUpperCase();
  if (!isAgentState(from) || !isAgentState(to)) throw new Error("AGENT_STATE_INVALID");

  if (TERMINAL.has(from)) throw new Error("AGENT_TERMINAL_STATE:" + from);
  if (EXCEPTIONS.has(to) || TERMINAL.has(to)) return to;
  if (EXCEPTIONS.has(from)) {
    if (to === "RESOLVE" || to === "PLAN" || to === "AUTHORIZE" || to === "EXECUTE" || to === "VERIFY" || to === "RETURN") return to;
    throw new Error("AGENT_RESUME_TRANSITION_INVALID:" + from + "->" + to);
  }

  const index = AGENT_LIFECYCLE.indexOf(from);
  const expected = AGENT_LIFECYCLE[index + 1];
  if (to !== expected) throw new Error("AGENT_TRANSITION_INVALID:" + from + "->" + to);
  return to;
}

export function createVerifiedReturn(input = {}) {
  const envelope = createAgentWorkEnvelope({ ...input, state:"RETURN" });
  const status = String(input.status || "").trim().toUpperCase();
  if (!["COMPLETE","BLOCKED","UNKNOWN","REPAIR_REQUIRED","WAIT"].includes(status)) {
    throw new Error("AGENT_RETURN_STATUS_INVALID:" + status);
  }
  const evidenceRefs = [...new Set((input.evidenceRefs || []).map(String).map(x => x.trim()).filter(Boolean))];
  const readback = input.readback && typeof input.readback === "object" ? structuredClone(input.readback) : null;
  if (status === "COMPLETE" && (!evidenceRefs.length || !readback)) {
    throw new Error("AGENT_COMPLETE_REQUIRES_EVIDENCE_AND_READBACK");
  }
  return Object.freeze({
    contract:AGENT_FAMILY_VERSION,
    workId:envelope.workId,
    checkpointId:envelope.checkpointId,
    agentId:envelope.agentId,
    status,
    result:input.result == null ? null : structuredClone(input.result),
    evidenceRefs:Object.freeze(evidenceRefs),
    readback:readback ? Object.freeze(readback) : null,
    summary:input.summary == null ? null : String(input.summary),
    nextAction:input.nextAction == null ? null : String(input.nextAction),
    returnOwner:"CENTRE",
  });
}

export function reportAudience(agentId) {
  return getAgentRole(agentId).reportsTo;
}


export function agentRuntimeDescriptor(agentId) {
  const role = getAgentRole(agentId);
  return Object.freeze({
    contract:AGENT_FAMILY_VERSION,
    agentId:role.id,
    role:role.role,
    counterSeat:role.counterSeat,
    homeRuntime:role.homeRuntime,
    reportsTo:role.reportsTo,
    workTruthOwner:AGENT_FAMILY_POLICY.workTruthOwner,
    intakeSurface:AGENT_FAMILY_POLICY.intakeSurface,
  });
}

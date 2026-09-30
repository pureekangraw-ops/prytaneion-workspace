import { CENTRE_STATES, createCentrePassage } from "./go-hub-centre.js";
import { routeInterruptionReturn } from "./go-hub-city-route.js";
import { createGlobalAuditService } from "./go-hub-global-audit.mjs";
import { createWorkRecord as createV4WorkRecord, claimWork as claimV4Work, updateWorkDestinations as updateV4WorkDestinations, waitForConfirmation as waitV4Work, resumeWork as resumeV4Work, reopenWork as reopenV4Work, emergencyEnterWork as emergencyEnterV4Work, emergencyExitWork as emergencyExitV4Work, returnWork as returnV4Work, boardView as v4BoardView, createCentreBackedWorkIndex } from "./go-hub-centre-v4.js";
import { createHeimdallV4 } from "./go-hub-heimdall-v4.js";
import { prepareStandardMissionTicket, issueStandardMissionTicket, replaceStandardMissionTicket, missionTicketSearchCode } from "./go-hub-mission-card.mjs";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(label + " is required"), { status: 400 });
  return text;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

const DEFAULT_LEASE_SECONDS = 15 * 60;
const CENTRE_STALE_SCAN_MS = 60_000;
const CENTRE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_LEASE_SECONDS = 24 * 60 * 60;

function leaseSeconds(value) {
  if (value == null) return DEFAULT_LEASE_SECONDS;
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > MAX_LEASE_SECONDS) {
    throw Object.assign(new Error("invalid lease seconds"), { status: 400 });
  }
  return seconds;
}

function ownershipState(state) {
  const source = state?.ownership && typeof state.ownership === "object" ? state.ownership : {};
  return {
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    enforced: source.enforced === true,
    ownerId: String(source.ownerId || "").trim() || null,
    leaseId: String(source.leaseId || "").trim() || null,
    leaseExpiresAt: String(source.leaseExpiresAt || "").trim() || null,
    claimedAt: String(source.claimedAt || "").trim() || null,
    renewedAt: String(source.renewedAt || "").trim() || null,
    releasedAt: String(source.releasedAt || "").trim() || null,
  };
}

function ownershipView(state, now = Date.now()) {
  const ownership = ownershipState(state);
  const expiry = ownership.leaseExpiresAt ? Date.parse(ownership.leaseExpiresAt) : NaN;
  const active = Boolean(ownership.ownerId && ownership.leaseId && Number.isFinite(expiry) && expiry > now);
  const expired = Boolean(ownership.ownerId && ownership.leaseId && Number.isFinite(expiry) && expiry <= now);
  return {
    ...ownership,
    status: active ? "CLAIMED" : expired ? "EXPIRED" : "OPEN",
    active,
  };
}

function expectedOwnershipRevision(input) {
  const revision = Number(input.expectedOwnershipRevision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw Object.assign(new Error("expected ownership revision is required"), { status: 400 });
  }
  return revision;
}

function assertOwnershipRevision(state, input) {
  const current = ownershipState(state);
  const expected = expectedOwnershipRevision(input);
  if (expected !== current.revision) {
    throw Object.assign(new Error("CENTRE_OWNERSHIP_STALE_REVISION"), { status: 409 });
  }
  return current;
}

function assertLeaseForMutation(state, input) {
  const current = ownershipView(state);
  if (!current.enforced) return;
  if (!current.ownerId || !current.leaseId) {
    throw Object.assign(new Error("CENTRE_WORK_UNCLAIMED"), { status: 409 });
  }
  if (!current.active) {
    throw Object.assign(new Error("CENTRE_WORK_LEASE_EXPIRED"), { status: 409 });
  }
  const ownerId = required(input.ownerId, "Owner ID");
  const leaseId = required(input.leaseId, "Lease ID");
  const revision = expectedOwnershipRevision(input);
  if (ownerId !== current.ownerId || leaseId !== current.leaseId) {
    throw Object.assign(new Error("CENTRE_WORK_OWNERSHIP_CONFLICT"), { status: 409 });
  }
  if (revision !== current.revision) {
    throw Object.assign(new Error("CENTRE_OWNERSHIP_STALE_REVISION"), { status: 409 });
  }
}

const SECRET_FIELD = /(authorization|token|secret|passcode|master.?key)/i;

function rejectSecretFields(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      throw Object.assign(new Error("SECRET_FIELD_REJECTED:" + path + "." + key), { status: 400 });
    }
    rejectSecretFields(nested, path + "." + key);
  }
}

function revisionField(value, label) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw Object.assign(new Error(label + " is required"), { status: 400 });
  }
  return revision;
}

function effectLedgerState(state) {
  const source = state?.effectLedger && typeof state.effectLedger === "object" ? state.effectLedger : {};
  return {
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    entries: Array.isArray(source.entries) ? clone(source.entries) : [],
  };
}

function executionCheckpointState(state) {
  const source = state?.executionCheckpoint && typeof state.executionCheckpoint === "object" ? state.executionCheckpoint : {};
  return {
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    latest: source.latest && typeof source.latest === "object" ? clone(source.latest) : null,
  };
}

function assertEvidence(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(label + " is required"), { status: 400 });
  }
  rejectSecretFields(value, label);
  return {
    kind: required(value.kind, label + " kind"),
    reference: required(value.reference, label + " reference"),
    observedAt: String(value.observedAt || new Date().toISOString()),
  };
}

function validationState(state) {
  return state?.validationEvidence && typeof state.validationEvidence === "object"
    ? clone(state.validationEvidence)
    : null;
}

function assertEvidenceBackedReturn(state) {
  if (state.realityExists !== true || !state.realityEvidence?.reference) {
    throw Object.assign(new Error("CENTRE_RETURN_REQUIRES_REALITY"), { status: 409 });
  }
  const validation = validationState(state);
  if (!validation) {
    throw Object.assign(new Error("CENTRE_RETURN_REQUIRES_VALIDATION"), { status: 409 });
  }
  if (validation.realityReference !== state.realityEvidence.reference ||
      Number(validation.effectRevision) !== effectLedgerState(state).revision ||
      Number(validation.executionCheckpointRevision) !== executionCheckpointState(state).revision) {
    throw Object.assign(new Error("CENTRE_VALIDATION_STALE"), { status: 409 });
  }
}

function stateView(state, extra = {}) {
  const work = clone(state.work);
  return {
    ok: true,
    phase: state.phase,
    work,
    workId: work.workId,
    checkpointId: work.checkpointId,
    returnAddress: work.checkpointId,
    realityExists: state.realityExists === true,
    realityEvidence: clone(state.realityEvidence || null),
    validationEvidence: validationState(state),
    interruption: clone(state.interruption || null),
    ownership: ownershipView(state),
    effectLedger: effectLedgerState(state),
    executionCheckpoint: executionCheckpointState(state),
    executionResume: clone(state.executionResume || null),
    lastGlobalAuditSequence: state.lastGlobalAuditSequence == null ? null : Number(state.lastGlobalAuditSequence),
    auditPending: Boolean(state.auditPendingEvent),
    ...extra,
  };
}

function assertIdentity(state, input = {}, { requireReturn = false } = {}) {
  const workId = required(input.workId, "Work ID");
  if (workId !== state.work.workId) throw Object.assign(new Error("Work ID does not match"), { status: 409 });
  if (input.checkpointId != null && String(input.checkpointId) !== state.work.checkpointId) {
    throw Object.assign(new Error("Checkpoint ID does not match"), { status: 409 });
  }
  if (requireReturn || input.returnAddress != null) {
    const returnAddress = required(input.returnAddress, "Return Address");
    if (returnAddress !== state.work.checkpointId) {
      throw Object.assign(new Error("Return Address does not match Checkpoint ID"), { status: 409 });
    }
  }
}

function assertRealityEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Reality evidence is required"), { status: 400 });
  }
  const kind = required(value.kind, "Reality evidence kind");
  const reference = required(value.reference, "Reality evidence reference");
  return { kind, reference, observedAt: String(value.observedAt || new Date().toISOString()) };
}

function missionSidecar(state) {
  const source = state?.agentMission && typeof state.agentMission === "object" ? state.agentMission : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
  return {
    version:1,
    memory:{
      mission:String(memory.mission || "").trim() || null,
      requestedResult:String(memory.requestedResult || "").trim() || null,
      selectedContext:Array.isArray(memory.selectedContext) ? clone(memory.selectedContext) : [],
      contextRefs:Array.isArray(memory.contextRefs) ? [...new Set(memory.contextRefs.map(value => String(value || "").trim()).filter(Boolean))] : [],
      notes:Array.isArray(memory.notes) ? clone(memory.notes) : [],
      lightReplies:Array.isArray(memory.lightReplies) ? clone(memory.lightReplies) : [],
      openedSpaces:memory.openedSpaces && typeof memory.openedSpaces === "object" && !Array.isArray(memory.openedSpaces) ? clone(memory.openedSpaces) : {},
      latestReality:memory.latestReality && typeof memory.latestReality === "object" ? clone(memory.latestReality) : null,
      returnHistory:Array.isArray(memory.returnHistory) ? clone(memory.returnHistory) : [],
      cardMachine:memory.cardMachine && typeof memory.cardMachine === "object" && !Array.isArray(memory.cardMachine) ? clone(memory.cardMachine) : { draft:null, current:null, audit:[] },
      revision:Number.isSafeInteger(memory.revision) && memory.revision >= 0 ? memory.revision : 0,
      lastUpdated:String(memory.lastUpdated || "").trim() || null,
    },
    session:source.session && typeof source.session === "object" ? clone(source.session) : null,
  };
}

function missionView(state) {
  return clone(missionSidecar(state));
}

function missionUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || "").trim()).filter(Boolean))];
}

function missionContextItem(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("HERMES_CONTEXT_CANDIDATE_INVALID"), { status:400 });
  }
  rejectSecretFields(value, "missionContext");
  const contextId = String(value.contextId || value.id || "").trim();
  if (!contextId) throw Object.assign(new Error("HERMES_CONTEXT_ID_REQUIRED"), { status:400 });
  return {
    contextId,
    kind:String(value.kind || value.type || "CONTEXT").trim().toUpperCase() || "CONTEXT",
    label:String(value.label || value.title || "").trim() || null,
    summary:String(value.summary || value.detail || "").trim() || null,
    target:String(value.target || value.value || "").trim() || null,
    destination:String(value.destination || "").trim() || null,
    tool:String(value.tool || value.toolName || "").trim() || null,
    ref:String(value.ref || value.url || "").trim() || null,
    refs:missionUnique(value.refs),
    source:String(value.source || "").trim() || null,
    observedAt:String(value.observedAt || "").trim() || null,
    order:index,
  };
}

function activeMissionSession(state) {
  const mission = missionSidecar(state);
  if (!mission.session) throw Object.assign(new Error("HERMES_SESSION_REQUIRED"), { status:409 });
  if (mission.session.status === "EXITED") throw Object.assign(new Error("HERMES_SESSION_EXITED"), { status:409 });
  return mission;
}

function bumpMission(mission, at = new Date().toISOString()) {
  mission.memory.revision += 1;
  mission.memory.lastUpdated = at;
  return mission;
}

function saveMission(state, mission, phase) {
  state.agentMission = clone(mission);
  state.phase = phase;
  return state;
}

function v4MissionAction(state, action, input = {}) {
  const at = new Date().toISOString();

  if (action === "v4_mission_get") {
    return { state, readOnly:true, mission:missionView(state) };
  }

  if (action === "v4_mission_emergency_enter") {
    let mission = missionSidecar(state);
    const sessionId = required(input.sessionId, "HERMES Session ID");
    const agentId = required(input.agentId || "GO", "HERMES Agent ID");
    const missionText = required(input.mission || state.work?.command || state.work?.name, "HERMES Mission");
    if (!mission.memory.mission) mission.memory.mission = missionText;
    if (!mission.memory.requestedResult) {
      mission.memory.requestedResult = String(input.requestedResult || state.work?.expectedResult || "").trim() || null;
    }
    mission.session = {
      sessionId,
      agentId,
      status:"ENTERED",
      missionInput:missionText,
      enteredAt:at,
      returnedAt:null,
      exitedAt:null,
      lastDestination:null,
      emergency:true,
    };
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_EMERGENCY_ENTERED"), mission };
  }

  if (action === "v4_mission_emergency_exit") {
    let mission = missionSidecar(state);
    if (!mission.session) return { state, mission, idempotent:true };
    mission.session.status = "EXITED";
    mission.session.exitedAt = at;
    mission.session.emergency = true;
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_EMERGENCY_EXITED"), mission };
  }

  if (action === "v4_mission_enter") {
    let mission = missionSidecar(state);
    const current = mission.session;
    if (current && current.status !== "EXITED") {
      if (current.status === "RETURNED") {
        throw Object.assign(new Error("HERMES_EXIT_REQUIRED_BEFORE_REENTER"), { status:409 });
      }
      if (String(current.agentId || "") !== String(input.agentId || "GO")) {
        throw Object.assign(new Error("HERMES_SESSION_ALREADY_ACTIVE"), { status:409 });
      }
      return { state, mission, idempotent:true };
    }
    const sessionId = required(input.sessionId, "HERMES Session ID");
    const agentId = required(input.agentId || "GO", "HERMES Agent ID");
    const missionText = required(input.mission || state.work?.command || state.work?.name, "HERMES Mission");
    if (!mission.memory.mission) mission.memory.mission = missionText;
    if (!mission.memory.requestedResult) {
      mission.memory.requestedResult = String(input.requestedResult || state.work?.expectedResult || "").trim() || null;
    }
    mission.session = {
      sessionId,
      agentId,
      status:"ENTERED",
      missionInput:missionText,
      enteredAt:at,
      returnedAt:null,
      exitedAt:null,
      lastDestination:null,
    };
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_ENTERED"), mission };
  }

  if (action === "v4_mission_card_prepare") {
    let mission = activeMissionSession(state);
    const currentMachine = mission.memory.cardMachine || { draft:null, current:null, audit:[] };
    const draft = prepareStandardMissionTicket({
      work:state.work,
      checkpointId:state.work?.checkpointId,
      destinations:missionUnique(input.destinations?.length ? input.destinations : state.work?.requestedDestinations),
      context:Array.isArray(input.context) ? input.context : mission.memory.selectedContext,
      intent:{
        mission:mission.memory.mission || state.work?.command || state.work?.name || null,
        requestedResult:mission.memory.requestedResult || state.work?.expectedResult || null,
      },
      lastReturn:mission.memory.latestReality || currentMachine.current?.last_return || null,
      accessScope:input.accessScope,
      toolAccess:missionUnique(input.toolAccess),
      snapshotKey:currentMachine.current?.snapshot_key || state.work?.snapshotKey || null,
      reason:String(input.reason || "MISSION_ENTRY").trim() || "MISSION_ENTRY",
    });
    mission.memory.cardMachine = { ...currentMachine, draft:clone(draft) };
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_CARD_DRAFT"), mission };
  }

  if (action === "v4_mission_card_issue") {
    let mission = activeMissionSession(state);
    const machine = mission.memory.cardMachine || { draft:null, current:null, audit:[] };
    if (!machine.draft) throw Object.assign(new Error("HERMES_CARD_DRAFT_REQUIRED"), { status:409 });
    const issued = issueStandardMissionTicket(machine.draft, {
      acceptedBy:String(input.acceptedBy || "HERMES").trim() || "HERMES",
    });
    state.work = { ...state.work, accessScope:issued.access_scope, toolAccess:clone(issued.tool_access || []), snapshotKey:issued.snapshot_key || null };
    mission.memory.cardMachine = { draft:null, current:clone(issued), audit:Array.isArray(machine.audit) ? machine.audit : [], lastCardUpdateAt:at };
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_CARD_ISSUED"), mission };
  }

  if (action === "v4_mission_context") {
    let mission = activeMissionSession(state);
    const candidates = (Array.isArray(input.candidates) ? input.candidates : []).map(missionContextItem);
    const selectedIds = new Set(missionUnique(input.selectedIds));
    const selected = candidates.filter(item => selectedIds.has(item.contextId));
    if (selected.length !== selectedIds.size) {
      throw Object.assign(new Error("HERMES_CONTEXT_SELECTION_UNKNOWN_ID"), { status:400 });
    }
    mission.memory.selectedContext = selected.map(({ order, ...item }) => item);
    mission.memory.contextRefs = missionUnique(selected.flatMap(item => [item.ref, ...(item.refs || [])]));
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_CONTEXT"), mission };
  }

  if (action === "v4_mission_recommended_tools") {
    let mission = activeMissionSession(state);
    mission.memory.recommendedTools = missionUnique(input.recommendedTools);
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_TOOL_DISCOVERY"), mission };
  }

  if (action === "v4_mission_note") {
    let mission = activeMissionSession(state);
    const note = required(input.note, "HERMES Note");
    mission.memory.notes = [...mission.memory.notes, {
      noteId:"NOTE-" + String(mission.memory.notes.length + 1),
      source:String(input.source || "GO").trim() || "GO",
      text:note,
      at,
    }].slice(-100);
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_NOTE"), mission };
  }

  if (action === "v4_mission_light") {
    let mission = activeMissionSession(state);
    if (!input.lightReply || typeof input.lightReply !== "object" || Array.isArray(input.lightReply)) {
      throw Object.assign(new Error("HERMES_LIGHT_REPLY_REQUIRED"), { status:400 });
    }
    rejectSecretFields(input.lightReply, "lightReply");
    mission.memory.lightReplies = [...mission.memory.lightReplies, clone(input.lightReply)].slice(-50);
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_LIGHT"), mission };
  }

  if (action === "v4_mission_first_open") {
    let mission = activeMissionSession(state);
    if (state.work?.status !== "ON PROCESS" || state.work?.pass?.state !== "ACTIVE") {
      throw Object.assign(new Error("HERMES_ACTIVE_ACCESS_REQUIRED"), { status:409 });
    }
    const destination = required(input.destination, "HERMES Destination");
    const existing = mission.memory.openedSpaces[destination] || null;
    const access = input.access && typeof input.access === "object" && !Array.isArray(input.access) ? clone(input.access) : {};
    rejectSecretFields(access, "missionAccess");
    mission.memory.openedSpaces[destination] = {
      destination,
      workspace:String(input.workspace || existing?.workspace || "").trim() || null,
      firstOpenedAt:existing?.firstOpenedAt || at,
      lastUsedAt:at,
      firstOpen:existing ? false : input.firstOpen !== false,
      openedBy:String(access.openedBy || existing?.openedBy || "heimdall").trim() || "heimdall",
      access,
    };
    mission.session.status = "IN_MISSION";
    mission.session.lastDestination = destination;
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_IN_PROGRESS"), mission };
  }

  if (action === "v4_mission_return") {
    let mission = activeMissionSession(state);
    if (mission.session.status === "RETURNED") return { state, mission, idempotent:true };
    if (["ON PROCESS","WAIT CONFIRM"].includes(String(state.work?.status || "").toUpperCase()) ||
        state.work?.holder || state.work?.pass?.state === "ACTIVE") {
      throw Object.assign(new Error("HERMES_OWNER_RETURN_READBACK_REQUIRED"), { status:409 });
    }
    const exactStatus = required(input.missionStatus, "HERMES Return Status").toUpperCase();
    if (!["ON PROCESS","WAIT","WAIT VERIFY","COMPLETE","CANCEL"].includes(exactStatus)) {
      throw Object.assign(new Error("HERMES_RETURN_STATUS_INVALID"), { status:400 });
    }
    const reality = {
      revision:mission.memory.revision + 1,
      missionStatus:exactStatus,
      sourceStatus:String(state.work?.status || "").trim() || null,
      result:clone(input.result ?? null),
      nextAction:String(input.nextAction || "").trim() || null,
      evidence:Array.isArray(input.evidence) ? clone(input.evidence) : [],
      unknowns:missionUnique(input.unknowns),
      lastLocation:String(input.lastLocation || mission.session.lastDestination || "").trim() || null,
      mode:String(input.mode || "NORMAL_RETURN").trim().toUpperCase(),
      ownerReadback:{
        workId:state.work?.workId || null,
        checkpointId:state.work?.checkpointId || null,
        sourceStatus:state.work?.status || null,
        holder:state.work?.holder || null,
        passState:state.work?.pass?.state || null,
        lastUpdated:state.work?.lastUpdated || null,
      },
      returnedAt:at,
    };
    rejectSecretFields(reality, "missionReality");
    mission.memory.latestReality = reality;
    mission.memory.returnHistory = [...mission.memory.returnHistory, reality].slice(-50);
    mission.memory.cardMachine = {
      ...(mission.memory.cardMachine || { draft:null, current:null, audit:[] }),
      lastCardUpdateAt:at,
    };
    mission.session.status = "RETURNED";
    mission.session.returnedAt = at;
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_RETURNED"), mission };
  }

  if (action === "v4_mission_card_update") {
    let mission = missionSidecar(state);
    const sessionStatus = String(mission.session?.status || "").toUpperCase();
    const emergencyExited = sessionStatus === "EXITED" && mission.session?.emergency === true;
    if (!mission.session || (sessionStatus !== "RETURNED" && !emergencyExited)) {
      throw Object.assign(new Error("HERMES_RETURN_REQUIRED_BEFORE_CARD_UPDATE"), { status:409 });
    }
    const currentUpdatedAt = Date.parse(String(mission.memory?.cardMachine?.lastCardUpdateAt || ""));
    const returnedAt = Date.parse(String(emergencyExited ? mission.session.exitedAt : mission.session.returnedAt || ""));
    if (Number.isFinite(currentUpdatedAt) && Number.isFinite(returnedAt) && currentUpdatedAt >= returnedAt) {
      return { state, mission, idempotent:true };
    }
    const machine = mission.memory.cardMachine || { draft:null,current:null,audit:[] };
    mission.memory.cardMachine = {
      ...machine,
      current:machine.current
        ? { ...clone(machine.current), last_return:mission.memory.latestReality ? clone(mission.memory.latestReality) : (machine.current.last_return || null) }
        : null,
      lastCardUpdateAt:at,
    };
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_CARD_UPDATED"), mission };
  }

  if (action === "v4_mission_exit") {
    let mission = missionSidecar(state);
    if (!mission.session) throw Object.assign(new Error("HERMES_SESSION_REQUIRED"), { status:409 });
    if (mission.session.status === "EXITED") return { state, mission, idempotent:true };
    if (mission.session.status !== "RETURNED") {
      throw Object.assign(new Error("HERMES_RETURN_REQUIRED_BEFORE_EXIT"), { status:409 });
    }
    const returnedAt = Date.parse(String(mission.session.returnedAt || ""));
    const cardUpdatedAt = Date.parse(String(mission.memory?.cardMachine?.lastCardUpdateAt || ""));
    if (!Number.isFinite(cardUpdatedAt) || !Number.isFinite(returnedAt) || cardUpdatedAt < returnedAt) {
      throw Object.assign(new Error("HERMES_CARD_UPDATE_REQUIRED_BEFORE_EXIT"), { status:409 });
    }
    mission.session.status = "EXITED";
    mission.session.exitedAt = at;
    bumpMission(mission, at);
    return { state:saveMission(state, mission, "V4_MISSION_EXITED"), mission };
  }

  return null;
}

export class GoHubCentreState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.centre = createCentrePassage();
    this.audit = createGlobalAuditService({ namespace: env?.GO_HUB_GLOBAL_AUDIT });
    this.currentAction = null;
  }

  async load() {
    const current = (await this.ctx.storage.get("state")) || null;
    if (!current || current.v4 !== true || !current.work?.workId || current.work.checkpointId) return current;
    const next = clone(current);
    next.work.checkpointId = "CP-" + String(next.work.workId);
    if (next.auditPendingEvent && !next.auditPendingEvent.checkpointId) {
      next.auditPendingEvent.checkpointId = next.work.checkpointId;
    }
    await this.ctx.storage.put("state", clone(next));
    return next;
  }

  auditEvent(state) {
    const work = state?.work || {};
    return {
      eventId: "AUDIT-" + crypto.randomUUID(),
      type: "CENTRE_" + String(this.currentAction || "MUTATION").toUpperCase(),
      workId: work.workId,
      checkpointId: work.checkpointId || (work.workId ? "CP-" + String(work.workId) : null),
      phase: state?.phase || null,
      targetId: work.targetId || null,
      at: new Date().toISOString(),
      details: {
        workStatus: work.status || null,
        ownershipRevision: ownershipState(state).revision,
        ownerId: ownershipState(state).ownerId,
        effectRevision: effectLedgerState(state).revision,
        executionCheckpointId: executionCheckpointState(state).latest?.executionCheckpointId || null,
        realityReference: state?.realityEvidence?.reference || null,
        validationReference: state?.validationEvidence?.reference || null,
      },
    };
  }

  async flushPendingAudit(state) {
    if (!state?.auditPendingEvent || !this.audit.configured()) return state;
    const response = await this.audit.append(state.auditPendingEvent);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error("CENTRE_AUDIT_RECONCILIATION_REQUIRED"), { status: 502 });
    }
    const next = clone(state);
    next.lastGlobalAuditSequence = Number(payload.sequence);
    next.auditPendingEvent = null;
    state.lastGlobalAuditSequence = next.lastGlobalAuditSequence;
    state.auditPendingEvent = null;
    await this.ctx.storage.put("state", clone(next));
    return next;
  }

  v4Heimdall(work) {
    return createHeimdallV4({
      works: work ? [work] : [],
      workIndex: createCentreBackedWorkIndex({ storage: this.ctx.storage }),
    });
  }

  async save(state) {
    const next = clone(state);
    if (this.audit.configured()) next.auditPendingEvent = this.auditEvent(next);
    await this.ctx.storage.put("state", clone(next));
    if (this.ctx.storage?.setAlarm && next?.v4 === true && ["OPEN","ON PROCESS","WAIT CONFIRM"].includes(String(next.work?.status || ""))) {
      await this.ctx.storage.setAlarm(Date.now() + CENTRE_STALE_SCAN_MS);
    }
    if (!this.audit.configured()) return next;
    const response = await this.audit.append(next.auditPendingEvent);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error("CENTRE_AUDIT_RECONCILIATION_REQUIRED"), { status: 502 });
    }
    next.lastGlobalAuditSequence = Number(payload.sequence);
    next.auditPendingEvent = null;
    state.lastGlobalAuditSequence = next.lastGlobalAuditSequence;
    state.auditPendingEvent = null;
    await this.ctx.storage.put("state", clone(next));
    return next;
  }

  async alarm() {
    const state = await this.load();
    if (!state?.v4 || !state.work?.workId) return;
    const heimdall = this.v4Heimdall(state.work);
    const scan = await heimdall.scan({ staleAfterMs:CENTRE_STALE_AFTER_MS });
    const stale = scan.cautions?.find(item => item.kind === "STALE" && item.workId === state.work.workId);
    if (stale) {
      const next = clone(state);
      next.work.attention = "STALE";
      next.work.readback = { type:"STALE", owner:"SOURCE_OWNER", action:"REFRESH", detectedAt:new Date().toISOString(), lastUpdated:stale.lastUpdated || null };
      this.currentAction = "v4_stale_scan";
      await this.save(next);
      return;
    }
    if (["OPEN","ON PROCESS","WAIT CONFIRM"].includes(String(state.work.status || "")) && this.ctx.storage?.setAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + CENTRE_STALE_SCAN_MS);
    }
  }

  async act(input = {}) {
    const action = required(input.action, "Centre action");
    this.currentAction = action;
    let state = await this.load();
    if (state?.auditPendingEvent) state = await this.flushPendingAudit(state);

    if (action === "v4_create") {
      if (state) throw Object.assign(new Error("CENTRE_WORK_ALREADY_EXISTS"), { status: 409 });
      const supplied = input.work || input;
      if (supplied.workId && supplied.workId !== input.workId) {
        throw Object.assign(new Error("CENTRE_IDENTITY_CONFLICT"), { status: 409 });
      }
      const work = createV4WorkRecord({ ...supplied, workId: input.workId });
      await createCentreBackedWorkIndex({ storage: this.ctx.storage }).put(work);
      state = await this.save({ v4: true, work, phase: "V4_OPEN", ownership: { revision: 0, enforced: false }, effectLedger: { revision: 0, entries: [] }, executionCheckpoint: { revision: 0, latest: null } });
      return json({ ok: true, v4: true, work });
    }

    if (action === "start") {
      const workId = required(input.workId, "Work ID");
      const checkpointId = required(input.checkpointId, "Checkpoint ID");
      const returnAddress = required(input.returnAddress, "Return Address");
      if (checkpointId !== returnAddress) {
        throw Object.assign(new Error("Return Address does not match Checkpoint ID"), { status: 409 });
      }
      if (state) {
        if (state.work.workId !== workId || state.work.checkpointId !== checkpointId) {
          throw Object.assign(new Error("CENTRE_IDENTITY_CONFLICT"), { status: 409 });
        }
        return stateView(state, { resumed: true });
      }
      state = await this.save({
        work: this.centre.enter({ workId, checkpointId }),
        phase: "ARRIVED",
        realityExists: false,
        realityEvidence: null,
        validationEvidence: null,
        interruption: null,
        ownership: {
          revision: 0,
          enforced: false,
          ownerId: null,
          leaseId: null,
          leaseExpiresAt: null,
          claimedAt: null,
          renewedAt: null,
          releasedAt: null,
        },
        effectLedger: { revision: 0, entries: [] },
        executionCheckpoint: { revision: 0, latest: null },
        executionResume: null,
      });
      return stateView(state, { resumed: false });
    }

    if (!state) throw Object.assign(new Error("CENTRE_WORK_NOT_FOUND"), { status: 404 });
    if (state.v4 === true) {
      if (action === "v4_inspect") return json({ ok: true, v4: true, work: clone(state.work) });
      if (action === "v4_board") return json({ ok: true, v4: true, board: v4BoardView([state.work]) });

      if (action === "v4_mission_card_replace") {
        let mission = activeMissionSession(state);
        const machine = mission.memory.cardMachine || { draft:null, current:null, audit:[] };
        if (!machine.current) throw Object.assign(new Error("HERMES_CURRENT_CARD_REQUIRED"), { status:409 });
        if (!machine.draft) throw Object.assign(new Error("HERMES_CARD_DRAFT_REQUIRED"), { status:409 });
        if (String(input.confirmation || "").trim().toUpperCase() !== "GO_CONFIRMED") {
          throw Object.assign(new Error("HERMES_GO_FINAL_CONFIRMATION_REQUIRED"), { status:409 });
        }
        const replaced = replaceStandardMissionTicket(machine.current, machine.draft, {
          confirmation:"GO_CONFIRMED",
          routeOpened:true,
        });
        state.work = {
          ...state.work,
          requestedDestinations:missionUnique(replaced.current.destinations),
          accessScope:replaced.current.access_scope,
          toolAccess:clone(replaced.current.tool_access || []),
          snapshotKey:replaced.current.snapshot_key || state.work?.snapshotKey || null,
        };
        mission.memory.cardMachine = {
          draft:null,
          current:clone(replaced.current),
          audit:[...(Array.isArray(machine.audit) ? machine.audit : []), clone(replaced.audit)].slice(-50),
          lastCardUpdateAt:new Date().toISOString(),
        };
        bumpMission(mission);
        state = saveMission(state, mission, "V4_MISSION_CARD_REPLACED");
        await createCentreBackedWorkIndex({ storage:this.ctx.storage }).replace(state.work);
        await this.save(state);
        return json({ ok:true, v4:true, work:clone(state.work), mission:clone(mission), card:clone(replaced.current), audit:clone(replaced.audit) });
      }

      const missionAction = v4MissionAction(state, action, input);
      if (missionAction) {
        if (missionAction.readOnly) {
          return json({ ok:true, v4:true, work:clone(state.work), mission:clone(missionAction.mission) });
        }
        state = missionAction.state;
        if (action === "v4_mission_card_issue") {
          await createCentreBackedWorkIndex({ storage:this.ctx.storage }).replace(state.work);
        }
        await this.save(state);
        return json({
          ok:true,
          v4:true,
          work:clone(state.work),
          mission:clone(missionAction.mission),
          ...(missionAction.idempotent ? { idempotent:true } : {}),
        });
      }

      if (action === "v4_claim") state.work = claimV4Work(state.work, { actor: input.actor });
      else if (action === "v4_open_pass") state.work = await this.v4Heimdall(state.work).openPass(state.work.workId, { kind: input.kind, destinations: input.destinations, scope: input.scope, holder: input.actor, actor: input.actor, expiresAt: input.expiresAt, closeCondition: input.closeCondition, returnAddress: input.returnAddress, reason: input.reason, audit: input.audit });
      else if (action === "v4_update_destinations") state.work = updateV4WorkDestinations(state.work, { destinations: input.destinations });
      else if (action === "v4_wait") state.work = waitV4Work(state.work, { reason: input.reason });
      else if (action === "v4_resume") state.work = resumeV4Work(state.work, { actor: input.actor });
      else if (action === "v4_reopen") state.work = reopenV4Work(state.work, { actor: input.actor });
      else if (action === "v4_emergency_enter") state.work = emergencyEnterV4Work(state.work);
      else if (action === "v4_emergency_exit") state.work = emergencyExitV4Work(state.work);
      else if (action === "v4_return") state.work = await this.v4Heimdall(state.work).closePass(state.work.workId, { actor: input.actor, holder: input.actor, status: input.status, result: input.result, evidence: input.evidence });
      else throw Object.assign(new Error("unsupported Centre V4 action"), { status: 400 });
      await createCentreBackedWorkIndex({ storage: this.ctx.storage }).replace(state.work);
      state.phase = "V4_" + action.slice(3).toUpperCase();
      await this.save(state);
      return json({ ok: true, v4: true, work: clone(state.work) });
    }
    assertIdentity(state, input);

    if (action === "inspect") return stateView(state, { resumed: true });

    if (action === "claim") {
      const current = assertOwnershipRevision(state, input);
      const view = ownershipView(state);
      if (view.active) {
        throw Object.assign(new Error("CENTRE_WORK_ALREADY_CLAIMED"), { status: 409 });
      }
      const ownerId = required(input.ownerId, "Owner ID");
      const now = new Date();
      const seconds = leaseSeconds(input.leaseSeconds);
      state.ownership = {
        revision: current.revision + 1,
        enforced: true,
        ownerId,
        leaseId: crypto.randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + seconds * 1000).toISOString(),
        claimedAt: now.toISOString(),
        renewedAt: null,
        releasedAt: null,
      };
      await this.save(state);
      return stateView(state, { ownershipChanged: "CLAIMED" });
    }

    if (action === "renew") {
      const current = assertOwnershipRevision(state, input);
      const view = ownershipView(state);
      if (!view.ownerId || !view.leaseId || !view.active) {
        throw Object.assign(new Error("CENTRE_WORK_LEASE_EXPIRED"), { status: 409 });
      }
      const ownerId = required(input.ownerId, "Owner ID");
      const leaseId = required(input.leaseId, "Lease ID");
      if (ownerId !== view.ownerId || leaseId !== view.leaseId) {
        throw Object.assign(new Error("CENTRE_WORK_OWNERSHIP_CONFLICT"), { status: 409 });
      }
      const now = new Date();
      state.ownership = {
        ...current,
        revision: current.revision + 1,
        enforced: true,
        ownerId,
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds(input.leaseSeconds) * 1000).toISOString(),
        renewedAt: now.toISOString(),
        releasedAt: null,
      };
      await this.save(state);
      return stateView(state, { ownershipChanged: "RENEWED" });
    }

    if (action === "release") {
      const current = assertOwnershipRevision(state, input);
      const ownerId = required(input.ownerId, "Owner ID");
      const leaseId = required(input.leaseId, "Lease ID");
      if (!current.ownerId || !current.leaseId || ownerId !== current.ownerId || leaseId !== current.leaseId) {
        throw Object.assign(new Error("CENTRE_WORK_OWNERSHIP_CONFLICT"), { status: 409 });
      }
      state.ownership = {
        ...current,
        revision: current.revision + 1,
        enforced: true,
        ownerId: null,
        leaseId: null,
        leaseExpiresAt: null,
        releasedAt: new Date().toISOString(),
      };
      await this.save(state);
      return stateView(state, { ownershipChanged: "RELEASED" });
    }

    if (action === "record_effect") {
      assertLeaseForMutation(state, input);
      const ledger = effectLedgerState(state);
      const expected = revisionField(input.expectedEffectRevision, "expected effect revision");
      if (expected !== ledger.revision) {
        throw Object.assign(new Error("CENTRE_EFFECT_STALE_REVISION"), { status: 409 });
      }
      const effect = {
        effectId: required(input.effectId, "Effect ID"),
        tool: required(input.effectTool, "Effect tool"),
        receiptRef: required(input.effectReceiptRef, "Effect receipt reference"),
        status: required(input.effectStatus, "Effect status").toUpperCase(),
      };
      if (!["DONE", "NOOP"].includes(effect.status)) {
        throw Object.assign(new Error("invalid effect status"), { status: 400 });
      }
      const existing = ledger.entries.find(item => item.effectId === effect.effectId);
      if (existing) {
        if (existing.tool !== effect.tool || existing.receiptRef !== effect.receiptRef || existing.status !== effect.status) {
          throw Object.assign(new Error("CENTRE_EFFECT_ID_CONFLICT"), { status: 409 });
        }
        return stateView(state, { effectRecorded: "IDEMPOTENT", effect: clone(existing) });
      }
      const entry = { ...effect, recordedAt: new Date().toISOString() };
      state.effectLedger = {
        revision: ledger.revision + 1,
        entries: [...ledger.entries, entry],
      };
      await this.save(state);
      return stateView(state, { effectRecorded: "RECORDED", effect: clone(entry) });
    }

    if (action === "save_checkpoint") {
      assertLeaseForMutation(state, input);
      const checkpoint = executionCheckpointState(state);
      const expectedCheckpoint = revisionField(
        input.expectedExecutionCheckpointRevision,
        "expected execution checkpoint revision",
      );
      if (expectedCheckpoint !== checkpoint.revision) {
        throw Object.assign(new Error("CENTRE_EXEC_CHECKPOINT_STALE_REVISION"), { status: 409 });
      }
      const ledger = effectLedgerState(state);
      const expectedEffects = revisionField(input.expectedEffectRevision, "expected effect revision");
      if (expectedEffects !== ledger.revision) {
        throw Object.assign(new Error("CENTRE_EFFECT_STALE_REVISION"), { status: 409 });
      }
      if (input.safePoint !== true) {
        throw Object.assign(new Error("execution checkpoint must be a safe point"), { status: 409 });
      }
      if (!input.snapshot || typeof input.snapshot !== "object" || Array.isArray(input.snapshot)) {
        throw Object.assign(new Error("Execution snapshot is required"), { status: 400 });
      }
      rejectSecretFields(input.snapshot, "snapshot");
      const latest = {
        executionCheckpointId: required(input.executionCheckpointId, "Execution Checkpoint ID"),
        createdAt: new Date().toISOString(),
        safePoint: true,
        resumeFrom: required(input.resumeFrom, "Resume From"),
        snapshot: clone(input.snapshot),
        effectRevision: ledger.revision,
        effectIds: ledger.entries.map(item => item.effectId),
      };
      state.executionCheckpoint = { revision: checkpoint.revision + 1, latest };
      state.executionResume = null;
      state.validationEvidence = null;
      await this.save(state);
      return stateView(state, { executionCheckpointChanged: "SAVED" });
    }

    if (action === "resume_checkpoint") {
      assertLeaseForMutation(state, input);
      const checkpoint = executionCheckpointState(state);
      const expectedCheckpoint = revisionField(
        input.expectedExecutionCheckpointRevision,
        "expected execution checkpoint revision",
      );
      if (expectedCheckpoint !== checkpoint.revision) {
        throw Object.assign(new Error("CENTRE_EXEC_CHECKPOINT_STALE_REVISION"), { status: 409 });
      }
      if (!checkpoint.latest) {
        throw Object.assign(new Error("CENTRE_EXEC_CHECKPOINT_NOT_FOUND"), { status: 404 });
      }
      const executionCheckpointId = required(input.executionCheckpointId, "Execution Checkpoint ID");
      if (executionCheckpointId !== checkpoint.latest.executionCheckpointId) {
        throw Object.assign(new Error("CENTRE_EXEC_CHECKPOINT_ID_MISMATCH"), { status: 409 });
      }
      const reconciliationEvidence = assertEvidence(input.reconciliationEvidence, "Reconciliation evidence");
      const ledger = effectLedgerState(state);
      const resumePlan = {
        executionCheckpointId,
        resumeFrom: checkpoint.latest.resumeFrom,
        snapshot: clone(checkpoint.latest.snapshot),
        checkpointEffectRevision: checkpoint.latest.effectRevision,
        currentEffectRevision: ledger.revision,
        skipEffectIds: ledger.entries.map(item => item.effectId),
        reconciliationEvidence,
      };
      state.executionResume = {
        ...clone(resumePlan),
        resumedAt: new Date().toISOString(),
      };
      state.validationEvidence = null;
      state.phase = "EXECUTION_RESUME";
      await this.save(state);
      return stateView(state, { resumePlan });
    }

    if (action === "review") {
      assertLeaseForMutation(state, input);
      state.work = this.centre.review(state.work, {
        task: input.task,
        requestedResult: input.requestedResult,
        authority: input.authority,
        targetId: input.targetId,
      });
      state.phase = "REVIEW";
      await this.save(state);
      return stateView(state);
    }

    if (action === "fit") {
      assertLeaseForMutation(state, input);
      if (input.lensId != null || input.lensReference != null || input.fittedView != null) {
        throw Object.assign(new Error("LEGACY_LENS_CONTRACT_REJECTED"), { status: 400 });
      }
      state.work = this.centre.fit(state.work, {
        personaId: input.personaId,
        personaReference: input.personaReference,
        workingView: input.workingView,
      });
      state.phase = "FIT";
      await this.save(state);
      return stateView(state);
    }

    if (action === "leave") {
      assertLeaseForMutation(state, input);
      const result = this.centre.leave(state.work, {
        destination: required(input.destination, "Destination"),
        targetId: input.targetId,
      });
      state.work = result.work;
      state.phase = "AWAY";
      await this.save(state);
      return stateView(state, { envelope: result.envelope });
    }

    if (action === "validate") {
      assertLeaseForMutation(state, input);
      if (state.work.status !== CENTRE_STATES.AWAY) {
        throw Object.assign(new Error("Validation can only be recorded while work is AWAY"), { status: 409 });
      }
      if (state.realityExists !== true || !state.realityEvidence?.reference) {
        throw Object.assign(new Error("CENTRE_VALIDATION_REQUIRES_REALITY"), { status: 409 });
      }
      const evidence = assertEvidence(input.evidence, "Validation evidence");
      state.validationEvidence = {
        ...evidence,
        realityReference: state.realityEvidence.reference,
        effectRevision: effectLedgerState(state).revision,
        executionCheckpointRevision: executionCheckpointState(state).revision,
        validatedAt: new Date().toISOString(),
      };
      state.phase = "VALIDATED";
      await this.save(state);
      return stateView(state);
    }

    if (action === "return") {
      assertLeaseForMutation(state, input);
      assertIdentity(state, input, { requireReturn: true });
      assertEvidenceBackedReturn(state);
      state.work = this.centre.return(state.work, {
        workId: state.work.workId,
        checkpointId: state.work.checkpointId,
        payload: clone(input.payload ?? null),
      });
      state.phase = "RETURNED";
      await this.save(state);
      return stateView(state);
    }

    if (action === "record_reality") {
      assertLeaseForMutation(state, input);
      if (state.work.status !== CENTRE_STATES.AWAY) {
        throw Object.assign(new Error("Reality can only be recorded while work is AWAY"), { status: 409 });
      }
      state.realityExists = true;
      state.realityEvidence = assertRealityEvidence(input.evidence);
      state.validationEvidence = null;
      state.phase = "REALITY";
      await this.save(state);
      return stateView(state);
    }

    if (action === "cancel") {
      assertLeaseForMutation(state, input);
      assertIdentity(state, input, { requireReturn: true });
      const routed = routeInterruptionReturn({
        workId: state.work.workId,
        checkpointId: state.work.checkpointId,
        returnAddress: state.work.checkpointId,
        requested: "CANCEL",
        realityExists: state.realityExists === true,
      });
      state.interruption = routed.interruption;
      if (routed.interruption.state === "RECOVERY_REQUIRED") {
        state.phase = "RECOVERY_REQUIRED";
        await this.save(state);
        return stateView(state);
      }
      if (state.work.status === CENTRE_STATES.AWAY) {
        state.work = this.centre.return(state.work, {
          workId: state.work.workId,
          checkpointId: state.work.checkpointId,
          payload: { kind: "WORK_INTERRUPTION_RETURN", interruption: routed.interruption },
        });
      }
      state.phase = routed.interruption.state;
      await this.save(state);
      return stateView(state);
    }

    if (action === "resume") {
      assertLeaseForMutation(state, input);
      if (state.work.status !== CENTRE_STATES.RETURNED) {
        throw Object.assign(new Error("Centre work must be RETURNED"), { status: 409 });
      }
      state.work = this.centre.resume(state.work, { reuseFit: input.reuseFit === true });
      state.phase = "RESUMED";
      state.interruption = null;
      state.realityExists = false;
      state.realityEvidence = null;
      state.validationEvidence = null;
      await this.save(state);
      return stateView(state);
    }

    throw Object.assign(new Error("unsupported Centre live action"), { status: 400 });
  }

  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
      const input = await request.json().catch(() => null);
      if (!input || typeof input !== "object" || Array.isArray(input)) return json({ code: "INVALID_JSON" }, 400);
      const result = await this.act(input);
      return result instanceof Response ? result : json(result, 200);
    } catch (error) {
      return json({ code: error?.message || "CENTRE_LIVE_ERROR" }, error?.status || 400);
    }
  }
}

function centreStub(namespace, workId) {
  if (!namespace || typeof namespace.getByName !== "function") return null;
  return namespace.getByName(workId);
}

export function createCentreLiveService({ namespace } = {}) {
  return Object.freeze({
    async action(input = {}) {
      const workId = required(input.workId, "Work ID");
      const stub = centreStub(namespace, workId);
      if (!stub || typeof stub.fetch !== "function") return json({ code: "CENTRE_STATE_NOT_CONFIGURED" }, 503);
      return stub.fetch(new Request("https://centre-state.internal/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }));
    },
  });
}

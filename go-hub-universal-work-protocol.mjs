export const UNIVERSAL_WORK_PROTOCOL_VERSION = "UNIVERSAL_WORK_PROTOCOL_V1";

export const UNIVERSAL_WORK_EVENTS = Object.freeze([
  "CREATE",
  "RECEIVED",
  "RESUME",
  "EXECUTE",
  "RETURN",
  "VERIFY",
  "CLOSE",
]);

export const UNIVERSAL_WORK_HANDOFF_EVENTS = Object.freeze([
  "ACKNOWLEDGE",
]);

export const UNIVERSAL_WORK_EXCEPTION_EVENTS = Object.freeze([
  "WAIT",
  "BLOCKED",
  "UNKNOWN",
  "REPAIR_REQUIRED",
  "INTERRUPTED",
  "EJECTED",
  "CANCELLED",
]);

export const UNIVERSAL_WORK_STATUSES = Object.freeze([
  "OPEN",
  "IN_PROGRESS",
  "WAIT",
  "WAIT_VERIFY",
  "RETURNED",
  "BLOCKED",
  "UNKNOWN",
  "VERIFIED",
  "CLOSED",
  "CANCELLED",
]);

export const UNIVERSAL_WORK_ACTORS = Object.freeze([
  "GO",
  "LIGHT",
  "PIXIE",
  "SPECTRUM",
  "HERMES",
  "MIMIR",
  "HUMAN",
]);

const ALL_EVENTS = new Set([
  ...UNIVERSAL_WORK_EVENTS,
  ...UNIVERSAL_WORK_HANDOFF_EVENTS,
  ...UNIVERSAL_WORK_EXCEPTION_EVENTS,
]);
const STATUS_SET = new Set(UNIVERSAL_WORK_STATUSES);
const ACTOR_SET = new Set(UNIVERSAL_WORK_ACTORS);

const ACTOR_ACTION_MAP = Object.freeze({
  COUNTER: Object.freeze({
    create: "CREATE",
    seen: "RECEIVED",
    pickup: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    answer: "RETURN",
    readback: "VERIFY",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
  GO: Object.freeze({
    create: "CREATE",
    receive: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    execute: "EXECUTE",
    return: "RETURN",
    verify: "VERIFY",
    verification: "VERIFY",
    close: "CLOSE",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
  LIGHT: Object.freeze({
    claim: "RECEIVED",
    pickup: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    execute: "EXECUTE",
    wait: "WAIT",
    answer: "RETURN",
    return: "RETURN",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
  PIXIE: Object.freeze({
    dispatch: "RECEIVED",
    receive: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    execute: "EXECUTE",
    result: "RETURN",
    result_packet: "RETURN",
    return: "RETURN",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
  SPECTRUM: Object.freeze({
    intake: "RECEIVED",
    receive: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    execute: "EXECUTE",
    status_brief: "RETURN",
    return: "RETURN",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
  HERMES: Object.freeze({
    create_tablet: "CREATE",
    pickup_tablet: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    update_tablet: "EXECUTE",
    return_tablet: "RETURN",
    eject_tablet: "EJECTED",
    interrupt: "INTERRUPTED",
    verify: "VERIFY",
  }),
  MIMIR: Object.freeze({
    receive: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    execute: "EXECUTE",
    housekeeping_report: "RETURN",
    return: "RETURN",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
  HUMAN: Object.freeze({
    create: "CREATE",
    receive: "RECEIVED",
    acknowledge: "ACKNOWLEDGE",
    resume: "RESUME",
    execute: "EXECUTE",
    return: "RETURN",
    verify: "VERIFY",
    close: "CLOSE",
    interrupt: "INTERRUPTED",
    eject: "EJECTED",
  }),
});

const NEXT_EVENTS = Object.freeze({
  CREATE: new Set(["RECEIVED", "ACKNOWLEDGE", "WAIT", "BLOCKED", "UNKNOWN"]),
  RECEIVED: new Set(["ACKNOWLEDGE", "RESUME", "EXECUTE", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  ACKNOWLEDGE: new Set(["RESUME", "EXECUTE", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  RESUME: new Set(["EXECUTE", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  EXECUTE: new Set(["EXECUTE", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  RETURN: new Set(["VERIFY", "RESUME", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  VERIFY: new Set(["CLOSE", "RESUME", "RETURN", "WAIT", "BLOCKED", "UNKNOWN"]),
  WAIT: new Set(["RESUME", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  BLOCKED: new Set(["RESUME", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "REPAIR_REQUIRED", "INTERRUPTED"]),
  UNKNOWN: new Set(["RESUME", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "REPAIR_REQUIRED", "INTERRUPTED"]),
  REPAIR_REQUIRED: new Set(["RESUME", "RETURN", "WAIT", "BLOCKED", "UNKNOWN", "INTERRUPTED"]),
  INTERRUPTED: new Set(["EJECTED", "RESUME", "WAIT", "RETURN", "BLOCKED", "UNKNOWN"]),
  EJECTED: new Set(["VERIFY", "RESUME", "WAIT", "RETURN", "BLOCKED", "UNKNOWN"]),
});

function freezeArray(values = []) {
  return Object.freeze([
    ...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean)),
  ]);
}

function required(value, label) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(label + " is required");
  return result;
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeAction(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeEvent(value) {
  const event = normalizeToken(value);
  if (!ALL_EVENTS.has(event)) throw new Error("UNIVERSAL_WORK_EVENT_INVALID:" + event);
  return event;
}

function normalizeStatus(value) {
  const status = normalizeToken(value);
  if (!STATUS_SET.has(status)) throw new Error("UNIVERSAL_WORK_STATUS_INVALID:" + status);
  return status;
}

function normalizeActor(value) {
  const actor = normalizeToken(value);
  if (!ACTOR_SET.has(actor) && actor !== "COUNTER") {
    throw new Error("UNIVERSAL_WORK_ACTOR_INVALID:" + actor);
  }
  return actor;
}

export function createWorkEnvelope(input = {}) {
  const workId = required(input.workId, "workId");
  const checkpointId = required(input.checkpointId, "checkpointId");
  const requestedResult = required(input.requestedResult, "requestedResult");
  const currentState = normalizeStatus(input.currentState || "OPEN");
  const actor = input.actor == null ? null : normalizeActor(input.actor);

  return Object.freeze({
    contract: UNIVERSAL_WORK_PROTOCOL_VERSION,
    identity: Object.freeze({ workId, checkpointId }),
    intent: Object.freeze({
      requestedResult,
      scope: input.scope == null ? null : String(input.scope),
    }),
    ownership: Object.freeze({
      owner: required(input.owner || "CENTRE", "owner"),
      origin: required(input.origin || "UNKNOWN", "origin"),
      target: required(input.target || "UNKNOWN", "target"),
    }),
    execution: Object.freeze({
      actor,
      authority: input.authority == null ? null : String(input.authority),
      lastAction: input.lastAction == null ? null : String(input.lastAction),
      nextAction: input.nextAction == null ? null : String(input.nextAction),
    }),
    evidence: Object.freeze({
      artifactRefs: freezeArray(input.artifactRefs),
      observationRefs: freezeArray(input.observationRefs),
      unknowns: freezeArray(input.unknowns),
    }),
    lifecycle: Object.freeze({
      currentState,
      lastEvent: null,
      transitionReason: null,
      history: Object.freeze([]),
    }),
  });
}

export function adaptActorAction({ actor, action, sourceEvent = action } = {}) {
  const actorId = normalizeActor(actor);
  const actionKey = normalizeAction(action);
  const event = ACTOR_ACTION_MAP[actorId]?.[actionKey];
  if (!event) {
    throw new Error("UNIVERSAL_WORK_ACTOR_ACTION_UNKNOWN:" + actorId + ":" + actionKey);
  }
  return Object.freeze({
    adapter: actorId + "_ADAPTER",
    actor: actorId,
    actorAction: String(action ?? "").trim(),
    actorActionKey: actionKey,
    sourceEvent: String(sourceEvent ?? action ?? "").trim(),
    event,
  });
}

export function canAppendWorkEvent(currentEvent, nextEvent) {
  const next = normalizeEvent(nextEvent);
  if (currentEvent == null || String(currentEvent).trim() === "") {
    return next === "CREATE" || next === "RECEIVED";
  }
  const current = normalizeEvent(currentEvent);
  return NEXT_EVENTS[current]?.has(next) === true;
}

export function createLifecycleEvent(input = {}) {
  const event = normalizeEvent(input.event);
  const actor = normalizeActor(input.actor);
  const workId = required(input.workId, "workId");
  const checkpointId = required(input.checkpointId, "checkpointId");
  const actorAction = required(input.actorAction || input.action, "actorAction");
  const sourceEvent = required(input.sourceEvent || actorAction, "sourceEvent");

  return Object.freeze({
    protocol: UNIVERSAL_WORK_PROTOCOL_VERSION,
    sequence: Number.isInteger(input.sequence) ? input.sequence : null,
    workId,
    checkpointId,
    event,
    actor,
    actorAction,
    actorActionKey: normalizeAction(actorAction),
    sourceEvent,
    reason: input.reason == null ? null : String(input.reason),
    evidenceRefs: freezeArray(input.evidenceRefs),
    receiptRef: input.receiptRef == null ? null : String(input.receiptRef),
    readback: input.readback == null ? null : String(input.readback),
    handoffComplete: input.handoffComplete === true,
    occurredAt: input.occurredAt == null ? null : String(input.occurredAt),
  });
}

export function applyActorAction(envelope, input = {}) {
  const adapted = adaptActorAction(input);
  return appendLifecycleEvent(envelope, {
    ...input,
    ...adapted,
    workId: input.workId ?? envelope.identity?.workId,
    checkpointId: input.checkpointId ?? envelope.identity?.checkpointId,
  });
}

export function appendLifecycleEvent(envelope, input = {}) {
  if (!envelope?.identity?.workId || !envelope?.identity?.checkpointId) {
    throw new Error("UNIVERSAL_WORK_ENVELOPE_INVALID");
  }

  const event = input.event
    ? createLifecycleEvent(input)
    : createLifecycleEvent({
        ...input,
        ...adaptActorAction(input),
      });
  const { workId, checkpointId } = envelope.identity;

  if (event.workId !== workId || event.checkpointId !== checkpointId) {
    throw new Error("UNIVERSAL_WORK_IDENTITY_MISMATCH");
  }

  const previous = envelope.lifecycle.lastEvent?.event || null;
  if (!canAppendWorkEvent(previous, event.event)) {
    throw new Error("UNIVERSAL_WORK_TRANSITION_INVALID:" + (previous || "START") + "->" + event.event);
  }

  const currentState = input.nextStatus == null
    ? envelope.lifecycle.currentState
    : normalizeStatus(input.nextStatus);
  const history = [...(envelope.lifecycle.history || []), event];
  const evidence = event.evidenceRefs;

  return Object.freeze({
    ...envelope,
    execution: Object.freeze({
      ...envelope.execution,
      actor: event.actor,
      lastAction: event.actorAction,
      nextAction: input.nextAction == null
        ? envelope.execution.nextAction
        : String(input.nextAction),
    }),
    evidence: Object.freeze({
      ...envelope.evidence,
      artifactRefs: freezeArray([
        ...(envelope.evidence.artifactRefs || []),
        ...(input.artifactRefs || []),
      ]),
      observationRefs: freezeArray([
        ...(envelope.evidence.observationRefs || []),
        ...(input.observationRefs || []),
      ]),
      unknowns: freezeArray([
        ...(envelope.evidence.unknowns || []),
        ...(input.unknowns || []),
      ]),
    }),
    lifecycle: Object.freeze({
      ...envelope.lifecycle,
      currentState,
      lastEvent: event,
      transitionReason: input.transitionReason == null
        ? event.reason
        : String(input.transitionReason),
      history: Object.freeze(history),
    }),
  });
}

export function universalWorkProtocolOverview() {
  return Object.freeze({
    contract: UNIVERSAL_WORK_PROTOCOL_VERSION,
    events: UNIVERSAL_WORK_EVENTS,
    handoffEvents: UNIVERSAL_WORK_HANDOFF_EVENTS,
    exceptionEvents: UNIVERSAL_WORK_EXCEPTION_EVENTS,
    statuses: UNIVERSAL_WORK_STATUSES,
    actors: UNIVERSAL_WORK_ACTORS,
    invariants: Object.freeze([
      "LIFECYCLE_EVENT_IS_NOT_WORK_STATUS",
      "LIFECYCLE_EVENT_IS_NOT_ACTOR_ACTION",
      "HANDOFF_IS_NOT_NEW_WORK",
      "SEND_IS_NOT_HANDOFF_COMPLETE",
      "RETURN_IS_NOT_COMPLETE",
      "RESUME_IS_NOT_NEW_OWNER",
      "HOLD_IS_HERMES_RECOVERY_CUSTODY",
      "RETURN_IS_NOT_COMPLETE",
      "VERIFY_IS_NOT_EXECUTE_AUTHORITY",
      "CONTEXT_IS_NOT_CURRENT_TRUTH",
    ]),
  });
}

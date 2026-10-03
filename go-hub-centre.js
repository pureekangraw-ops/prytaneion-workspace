import { createId, nowIso } from "./go-hub-utils.js";
import { createReturnEnvelope, planReturnHousekeeping, assertMimirHousekeepingSafety } from "./go-hub-mimir-logic-v1.mjs";

export const CENTRE_STATES = Object.freeze({
  ARRIVED: "ARRIVED",
  WAIT: "WAIT",
  READY: "READY",
  AWAY: "AWAY",
  RETURNED: "RETURNED",
});

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function optional(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function snapshot(value) {
  return freeze(structuredClone(value));
}

function assertState(work, expected) {
  if (!work || work.status !== expected) {
    throw new Error(`Centre work must be ${expected}`);
  }
}

export function createCheckpoint(input = {}) {
  const checkpointId = String(input.checkpointId || createId("CENTRE")).trim();
  const workId = String(input.workId || createId("WORK")).trim();
  return snapshot({
    checkpointId: required(checkpointId, "Checkpoint ID"),
    workId: required(workId, "Work ID"),
    createdAt: String(input.createdAt || nowIso()),
    status: CENTRE_STATES.ARRIVED,
    task: null,
    requestedResult: null,
    authority: null,
    targetId: null,
    persona: null,
    handoff: null,
    returnedPayload: null,
    mimirHousekeeping: null,
  });
}

export function intakeTask(work, input = {}) {
  assertState(work, CENTRE_STATES.ARRIVED);
  const next = structuredClone(work);
  next.task = String(input.task || "").trim() || null;
  next.requestedResult = String(input.requestedResult || "").trim() || null;
  next.authority = String(input.authority || "").trim() || null;
  next.targetId = optional(input.targetId ?? work.targetId);
  next.status = next.task && next.requestedResult && next.authority
    ? CENTRE_STATES.READY
    : CENTRE_STATES.WAIT;
  return snapshot(next);
}

export function resumeIntake(work, input = {}) {
  assertState(work, CENTRE_STATES.WAIT);
  const next = structuredClone(work);
  next.status = CENTRE_STATES.ARRIVED;
  return intakeTask(next, {
    task: input.task ?? work.task,
    requestedResult: input.requestedResult ?? work.requestedResult,
    authority: input.authority ?? work.authority,
    targetId: input.targetId ?? work.targetId,
  });
}

export function fitPersona(work, input = {}) {
  assertState(work, CENTRE_STATES.READY);
  const next = structuredClone(work);
  next.persona = {
    personaId: required(input.personaId, "Persona ID"),
    personaReference: required(input.personaReference, "Persona Reference"),
    workingView: required(input.workingView, "Working View"),
  };
  return snapshot(next);
}

function activeFit(work) {
  if (!work?.persona) return null;
  return {
    personaReference: work.persona.personaReference,
    workingView: work.persona.workingView,
  };
}

export function createHandoff(work, input = {}) {
  assertState(work, CENTRE_STATES.READY);
  const fit = activeFit(work);
  if (!fit) throw new Error("fitted Persona is required before handoff");
  const destination = required(input.destination, "Destination");
  const targetId = optional(input.targetId ?? work.targetId);
  const envelope = {
    workId: work.workId,
    checkpointId: work.checkpointId,
    task: work.task,
    requestedResult: work.requestedResult,
    targetId,
    personaReference: fit.personaReference,
    workingView: fit.workingView,
    destination,
    returnAddress: work.checkpointId,
  };
  const next = structuredClone(work);
  next.targetId = targetId;
  next.handoff = envelope;
  next.status = CENTRE_STATES.AWAY;
  return snapshot({ work: next, envelope });
}


function returnRef(work, suffix) {
  return `mimir-return://${encodeURIComponent(work.workId)}/${encodeURIComponent(work.checkpointId)}/${suffix}`;
}

function returnedItems(work, payload) {
  const value = payload === undefined ? null : structuredClone(payload);
  const items = [{
    itemId: "result",
    kind: "RESULT",
    ref: returnRef(work, "result"),
    lifecycleStatus: "current",
    payload: value,
  }];

  if (!value || typeof value !== "object" || Array.isArray(value)) return items;

  if (value.status != null) {
    items.push({
      itemId: "status",
      kind: "STATUS",
      ref: returnRef(work, "status"),
      lifecycleStatus: "current",
      payload: { status: value.status },
    });
  }

  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  evidence.forEach((entry, index) => {
    items.push({
      itemId: `evidence-${index + 1}`,
      kind: "EVIDENCE",
      ref: returnRef(work, `evidence/${index + 1}`),
      lifecycleStatus: "current",
      payload: entry,
    });
  });

  const artifactEntries = [
    ["artifact", value.artifact],
    ["build-artifact", value.buildArtifact],
    ["signed-artifact", value.signedArtifact],
  ].filter(([, artifact]) => artifact != null);
  artifactEntries.forEach(([name, artifact]) => {
    items.push({
      itemId: name,
      kind: "ARTIFACT",
      ref: returnRef(work, name),
      lifecycleStatus: "current",
      payload: artifact,
    });
  });

  if (value.receipt != null) {
    items.push({
      itemId: "receipt",
      kind: "RECEIPT",
      ref: returnRef(work, "receipt"),
      lifecycleStatus: "current",
      payload: value.receipt,
    });
  }
  if (value.readback != null) {
    items.push({
      itemId: "readback",
      kind: "RECEIPT",
      ref: returnRef(work, "readback"),
      lifecycleStatus: "current",
      payload: value.readback,
    });
  }
  if (value.refs != null) {
    items.push({
      itemId: "refs",
      kind: "METADATA",
      ref: returnRef(work, "refs"),
      lifecycleStatus: "current",
      payload: value.refs,
    });
  }
  if (Array.isArray(value.lessons)) {
    value.lessons.forEach((lesson, index) => {
      items.push({
        itemId: `knowledge-${index + 1}`,
        kind: "KNOWLEDGE",
        ref: returnRef(work, `knowledge/${index + 1}`),
        lifecycleStatus: "current",
        payload: lesson,
      });
    });
  }
  return items;
}

function createMimirReturnHousekeeping(work, returned) {
  const envelope = createReturnEnvelope({
    returnId: `RETURN:${work.workId}:${work.checkpointId}`,
    workId: work.workId,
    checkpointId: work.checkpointId,
    source: work.handoff?.destination || "destination://unknown",
    receivedAt: nowIso(),
    items: returnedItems(work, returned.payload),
  });
  const plan = planReturnHousekeeping({
    planId: `HOUSEKEEPING:${work.workId}:${work.checkpointId}`,
    returnEnvelope: envelope,
    policy: {
      policyRef: "policy://centre/mimir-return/v1",
      allowDeleteCandidates: false,
    },
  });
  assertMimirHousekeepingSafety(plan);
  return snapshot({ envelope, plan });
}

export function receiveReturn(work, returned = {}) {
  assertState(work, CENTRE_STATES.AWAY);
  if (String(returned.workId || "") !== work.workId) {
    throw new Error("returned Work ID does not match");
  }
  if (String(returned.checkpointId || "") !== work.checkpointId) {
    throw new Error("returned Checkpoint ID does not match Return Address");
  }
  const next = structuredClone(work);
  next.status = CENTRE_STATES.RETURNED;
  next.returnedPayload = returned.payload === undefined
    ? null
    : structuredClone(returned.payload);
  next.mimirHousekeeping = createMimirReturnHousekeeping(work, returned);
  return snapshot(next);
}

export function resumeReturnedWork(work, { reuseFit = false } = {}) {
  assertState(work, CENTRE_STATES.RETURNED);
  const next = structuredClone(work);
  next.status = CENTRE_STATES.READY;
  next.handoff = null;
  if (!reuseFit) next.persona = null;
  return snapshot(next);
}

export function createTestDestinationAdapter(handler = envelope => ({ received: envelope.task })) {
  if (typeof handler !== "function") throw new Error("test destination handler is required");
  return freeze({
    accept(envelope) {
      const payload = handler(snapshot(envelope));
      return snapshot({
        workId: envelope.workId,
        checkpointId: envelope.returnAddress,
        payload,
      });
    },
  });
}

export function createCentrePassage() {
  return freeze({
    enter(input = {}) { return createCheckpoint(input); },
    review(work, input = {}) {
      if (work?.status === CENTRE_STATES.WAIT) return resumeIntake(work, input);
      return intakeTask(work, input);
    },
    fit(work, input = {}) { return fitPersona(work, input); },
    leave(work, input = {}) { return createHandoff(work, input); },
    return(work, returned = {}) { return receiveReturn(work, returned); },
    resume(work, input = {}) { return resumeReturnedWork(work, input); },
  });
}

export function validateCentreWork(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Centre work snapshot is required");
  }
  required(value.checkpointId, "Checkpoint ID");
  required(value.workId, "Work ID");
  required(value.createdAt, "Created At");
  if (!Object.values(CENTRE_STATES).includes(value.status)) {
    throw new Error("Centre status is invalid");
  }
  if (value.status === CENTRE_STATES.AWAY) {
    if (!value.handoff || value.handoff.workId !== value.workId ||
        value.handoff.checkpointId !== value.checkpointId ||
        value.handoff.returnAddress !== value.checkpointId) {
      throw new Error("AWAY work requires an exact Centre handoff");
    }
    if (value.targetId && value.handoff.targetId !== value.targetId) {
      throw new Error("AWAY work target does not match Centre handoff");
    }
  }
  return snapshot(value);
}

export function createCentreSession({ persistence, initial = {}, passage = createCentrePassage() } = {}) {
  if (!persistence || typeof persistence.loadState !== "function" ||
      typeof persistence.commitState !== "function") {
    throw new TypeError("Centre persistence port is required");
  }
  return freeze({
    async load() {
      const stored = await persistence.loadState();
      return stored ? validateCentreWork(stored) : passage.enter(initial);
    },
    async save(work, commandType = "SAVE_CENTRE_WORK") {
      const proposed = validateCentreWork(work);
      return persistence.commitState({
        proposed,
        command: { type: commandType },
      });
    },
  });
}

export function admitDestination(work, { destination, capability } = {}) {
  assertState(work, CENTRE_STATES.AWAY);
  const target = required(destination, "Destination");
  if (work.handoff?.destination !== target) {
    throw new Error("Destination does not match the Centre handoff");
  }
  if (!capability || typeof capability !== "object") {
    throw new Error("Destination capability is required");
  }
  return Object.freeze({
    workId: work.workId,
    checkpointId: work.checkpointId,
    returnAddress: work.handoff.returnAddress,
    destination: target,
    envelope: snapshot(work.handoff),
    capability,
  });
}

export function createReturnPacket(access, payload = null) {
  if (!access || access.checkpointId !== access.returnAddress) {
    throw new Error("Destination access has no valid Return Address");
  }
  return snapshot({
    workId: access.workId,
    checkpointId: access.returnAddress,
    payload,
  });
}

export const MASTER_ARCHITECTURE_VERSION = "GO_HUB_MASTER_ARCHITECTURE_V1";

export const HUB_TRUTH_OWNERS = Object.freeze({
  CENTRE: "LIFECYCLE",
  HERMES: "CONTINUITY",
  PIXIE: "TECHNICAL_KNOWLEDGE",
  SPECTRUM_PRIME: "OPERATIONS_INTELLIGENCE",
  LIGHT: "INTELLIGENCE",
  MIMIR: "ORGANIZATION",
  GO: "COMMAND_DECISION_VERIFICATION",
  OLYMPUS: "RELEASED_CURRENT_VERSION",
});

export const UNIVERSAL_WORK_SEQUENCE = Object.freeze([
  "RECEIVE",
  "ACKNOWLEDGE",
  "RESUME",
  "EXECUTE",
  "RETURN",
  "READBACK",
  "VERIFY",
]);

export const INTERRUPTION_ROUTE = Object.freeze([
  "SAFE_STOP",
  "INTERRUPTED",
  "FREEZE_LAST_KNOWN_STATE",
  "RECOVERY_TABLET",
  "HERMES_HOLD",
  "INSPECT_RECONCILE",
  "RESUME_OR_EJECT",
]);

export const WORK_LINEAGE_FIELDS = Object.freeze([
  "continuedFrom",
  "derivedFrom",
  "relatedTo",
]);

const text = value => String(value ?? "").trim();
const unique = values => [...new Set((Array.isArray(values) ? values : [values]).map(text).filter(Boolean))];
const clone = value => value == null ? value : structuredClone(value);
const freeze = value => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};
const required = (value, label) => {
  const result = text(value);
  if (!result) throw new Error(label + " is required");
  return result;
};

export function normalizeWorkLineage(value = {}) {
  const source = value?.lineage && typeof value.lineage === "object" ? value.lineage : value;
  return freeze({
    continuedFrom: text(source?.continuedFrom) || null,
    derivedFrom: text(source?.derivedFrom) || null,
    relatedTo: unique(source?.relatedTo),
  });
}

export function classifyWorkContinuation({ previousStatus, requestedResultSame = false, interrupted = false } = {}) {
  const status = text(previousStatus).toUpperCase();
  if (interrupted || ["WAIT", "WAIT_CONFIRM", "BLOCKED", "UNKNOWN"].includes(status)) {
    return freeze({ kind:"RESUME", sameWork:true, requiresLineage:false, reason:"SAME_INTENT_INTERRUPTED" });
  }
  if (status === "COMPLETE" && requestedResultSame === true) {
    return freeze({ kind:"REOPEN", sameWork:true, requiresLineage:false, reason:"SAME_INTENT_AFTER_COMPLETE" });
  }
  if (status === "COMPLETE") {
    return freeze({ kind:"NEW_WORK", sameWork:false, requiresLineage:true, reason:"NEW_INTENT_AFTER_COMPLETE" });
  }
  return freeze({ kind:"CONTINUE", sameWork:true, requiresLineage:false, reason:"ACTIVE_WORK" });
}

export function createInterruptionRecovery(input = {}) {
  const workId = required(input.workId, "workId");
  const checkpointId = required(input.checkpointId, "checkpointId");
  const observedAt = required(input.observedAt || input.timestamp, "observedAt");
  return freeze({
    contract:MASTER_ARCHITECTURE_VERSION,
    kind:"INTERRUPTION_RECOVERY",
    mode:text(input.mode) || "INTERRUPTED",
    identity:freeze({ workId, checkpointId }),
    custody:"HERMES",
    status:"HOLD",
    actor:text(input.actor) || "UNKNOWN",
    lastSafePoint:text(input.lastSafePoint || input.safePoint) || null,
    lastAction:text(input.lastAction) || null,
    lastLocation:text(input.lastLocation) || null,
    observedAt,
    timestamp:observedAt,
    evidenceRefs:freeze(clone(input.evidenceRefs || [])),
    receipt:clone(input.receipt || null),
    repo:text(input.repo) || null,
    pr:text(input.pr) || null,
    sha:text(input.sha) || null,
    unknownGap:freeze(unique(input.unknownGap)),
    interruptCause:text(input.interruptCause) || "UNKNOWN",
    autoRetry:false,
    autoRollback:false,
  });
}

export function reconcileContinuityOrganization({ movementRecords = [], indexedRecords = [] } = {}) {
  const keyOf = item => `${text(item?.workId)}:${text(item?.checkpointId)}`;
  const movement = new Map(movementRecords.map(item => [keyOf(item), item]).filter(([key]) => key !== ":"));
  const index = new Map(indexedRecords.map(item => [keyOf(item), item]).filter(([key]) => key !== ":"));
  const missingFromIndex = [...movement.keys()].filter(key => !index.has(key));
  const orphanIndex = [...index.keys()].filter(key => !movement.has(key));
  return freeze({
    movementCount:movement.size,
    indexedCount:index.size,
    missingFromIndex,
    orphanIndex,
    dropDetected:missingFromIndex.length > 0,
    orphanDetected:orphanIndex.length > 0,
    status:missingFromIndex.length || orphanIndex.length ? "RECONCILIATION_REQUIRED" : "RECONCILED",
  });
}

export function assertTruthOwner(actor, concern) {
  const actorKey = text(actor).toUpperCase();
  const concernKey = text(concern).toUpperCase();
  const owner = Object.entries(HUB_TRUTH_OWNERS).find(([, value]) => value === concernKey)?.[0] || null;
  if (!owner) throw new Error("MASTER_ARCHITECTURE_CONCERN_UNKNOWN:" + concernKey);
  if (actorKey !== owner) throw new Error(`MASTER_ARCHITECTURE_TRUTH_OWNER_MISMATCH:${concernKey}:${owner}`);
  return true;
}

export function masterArchitectureOverview() {
  return freeze({
    version:MASTER_ARCHITECTURE_VERSION,
    truthOwners:HUB_TRUTH_OWNERS,
    universalWorkSequence:UNIVERSAL_WORK_SEQUENCE,
    interruptionRoute:INTERRUPTION_ROUTE,
    invariants:Object.freeze([
      "ONE_WORK_ONE_IDENTITY_WITHIN_LIFECYCLE",
      "RESUME_DOES_NOT_CREATE_NEW_WORK",
      "NEW_INTENT_AFTER_COMPLETE_REQUIRES_LINEAGE",
      "SEND_IS_NOT_HANDOFF_COMPLETE",
      "RETURN_IS_NOT_COMPLETE",
      "HERMES_OWNS_HOLD_RECOVERY_CUSTODY",
      "MIMIR_DOES_NOT_DECIDE_TRUTH_CONFLICT",
      "SPECTRUM_DOES_NOT_EXECUTE_WORK",
      "ANALYSIS_IS_NOT_EXECUTION",
    ]),
  });
}

export const ACTION_CRITICAL_FIELDS = Object.freeze({
  RECEIVE: Object.freeze(["workId", "checkpointId", "requestedResult"]),
  HANDOFF: Object.freeze(["workId", "checkpointId", "receipt"]),
  BRIEF: Object.freeze(["requestedResult"]),
  RETURN: Object.freeze(["workId", "checkpointId", "result", "evidence"]),
  MERGE: Object.freeze(["repo", "branch", "sha", "pr"]),
  RELEASE: Object.freeze(["repo", "sha", "version"]),
});

export function criticalFieldsForAction(action) {
  return ACTION_CRITICAL_FIELDS[text(action).toUpperCase()] || Object.freeze([]);
}

export function validateCriticalFields(action, payload = {}) {
  const requiredFields = criticalFieldsForAction(action);
  const missing = requiredFields.filter(field => {
    const value = payload?.[field];
    return value == null || (Array.isArray(value) ? value.length === 0 : text(value) === "");
  });
  return freeze({
    action:text(action).toUpperCase(),
    policy:"ACTION_DEPENDENT",
    requiredFields,
    missing,
    complete:missing.length === 0,
  });
}

export function assertHandoffIdentity({ sent = {}, acknowledged = {} } = {}) {
  const sentWork = required(sent.workId, "sent.workId");
  const sentCheckpoint = required(sent.checkpointId, "sent.checkpointId");
  const ackWork = required(acknowledged.workId, "acknowledged.workId");
  const ackCheckpoint = required(acknowledged.checkpointId, "acknowledged.checkpointId");
  if (sentWork !== ackWork || sentCheckpoint !== ackCheckpoint) {
    throw new Error("HANDOFF_IDENTITY_MISMATCH");
  }
  return freeze({ workId:sentWork, checkpointId:sentCheckpoint, matched:true });
}

export function createGapConfirmation({ actor, confirmedAt, missingFields = [] } = {}) {
  return freeze({
    actor:required(actor, "gap confirmation actor"),
    confirmedAt:required(confirmedAt, "gap confirmation time"),
    missingFields:freeze(unique(missingFields)),
    action:"BACKFILL_ALLOWED",
  });
}

export function resolveBranchContinuity({ requestedBranch, candidates = [] } = {}) {
  const requested = text(requestedBranch);
  const matches = candidates.filter(candidate => text(candidate?.branch) === requested);
  if (!requested) return freeze({ decision:"UNKNOWN", reuseAllowed:false, reason:"BRANCH_REQUIRED", createAllowed:false });
  if (matches.length > 1) return freeze({ decision:"CONFLICT", reuseAllowed:false, reason:"MULTIPLE_BRANCH_OWNERS", createAllowed:false });
  if (!matches.length) return freeze({ decision:"NOT_FOUND", reuseAllowed:false, reason:"INSPECT_REQUIRED", createAllowed:false });
  const branch = matches[0];
  const status = text(branch.status).toUpperCase();
  if (["ACTIVE", "OPEN", "READY"].includes(status) && branch.conflict !== true) {
    return freeze({ decision:"REUSE", reuseAllowed:true, reason:"EXISTING_BRANCH_USABLE", createAllowed:false, branch:requested, sha:text(branch.sha) || null });
  }
  if (branch.conflict === true) return freeze({ decision:"CONFLICT", reuseAllowed:false, reason:"BRANCH_CONFLICT", createAllowed:false, branch:requested });
  return freeze({ decision:"UNKNOWN", reuseAllowed:false, reason:"BRANCH_REQUIRES_INSPECTION", createAllowed:false, branch:requested });
}

export function createHermesMovementRecord(input = {}) {
  const movement = {
    contract:MASTER_ARCHITECTURE_VERSION,
    workId:required(input.workId, "movement.workId"),
    checkpointId:required(input.checkpointId, "movement.checkpointId"),
    from:required(input.from, "movement.from"),
    to:required(input.to, "movement.to"),
    actionType:required(input.actionType, "movement.actionType"),
    subject:text(input.subject) || null,
    before:clone(input.before || null),
    changed:clone(input.changed || null),
    after:clone(input.after || null),
    evidence:clone(input.evidence || []),
    receipt:clone(input.receipt || null),
    repo:text(input.repo) || null,
    pr:text(input.pr) || null,
    sha:text(input.sha) || null,
    occurredAt:required(input.occurredAt, "movement.occurredAt"),
    semanticTruthOwner:text(input.semanticTruthOwner) || null,
    semanticMutation:false,
  };
  return freeze(movement);
}

export function assertHermesSemanticBoundary(movement = {}) {
  if (movement.semanticMutation === true || movement.mutatesSemanticTruth === true) {
    throw new Error("HERMES_SEMANTIC_TRUTH_MUTATION_FORBIDDEN");
  }
  return true;
}

export function classifyMimirRelation({ explicitDuplicate = false, lineage = null, conflict = false } = {}) {
  if (conflict) return "CONFLICT_QUARANTINE";
  if (lineage && (text(lineage.continuedFrom) || text(lineage.derivedFrom) || unique(lineage.relatedTo).length)) return "LINEAGE";
  if (explicitDuplicate) return "DUPLICATE_CANDIDATE";
  return "UNKNOWN_REQUIRES_OWNER";
}

export function normalizeSpectrumSignal({ source, sourceReceipt, payload, observedAt } = {}) {
  return freeze({
    source:required(source, "signal.source"),
    sourceReceipt:clone(sourceReceipt || null),
    payload:clone(payload || null),
    observedAt:required(observedAt, "signal.observedAt"),
    receiptPreserved:sourceReceipt != null,
    status:sourceReceipt == null ? "UNKNOWN" : "RECEIVED",
  });
}

export function projectOwnerTruth({ value, observedAt, now, maxAgeMs = null } = {}) {
  if (value === undefined || value === null) return freeze({ status:"UNKNOWN", value:null, observedAt:null });
  const observed = Date.parse(text(observedAt));
  const current = Date.parse(text(now));
  if (maxAgeMs != null && Number.isFinite(observed) && Number.isFinite(current) && current - observed > Number(maxAgeMs)) {
    return freeze({ status:"STALE", value:clone(value), observedAt:text(observedAt) || null });
  }
  return freeze({ status:"KNOWN", value:clone(value), observedAt:text(observedAt) || null });
}

export function legacyCapabilityBoundary() {
  return freeze({ executableAuthority:0, canRoute:false, canMutateTruth:false, status:"HISTORY_ONLY" });
}

const STAGES = Object.freeze(["PLAN", "BUILD", "ASSEMBLY", "MERGE", "CHECK", "OUTPUT"]);
const OUTPUT_TYPES = new Set(["FILE", "REF"]);
const CHECK_STATUSES = new Set(["PENDING", "PASS", "FAIL", "UNKNOWN"]);
const GO_WORKS_DISPLAY_NAME = "GO WORKS";
const GO_WORKS_FLOW_VERSION = "GO_WORKS_V2";

function text(value) {
  return String(value ?? "").trim();
}

function required(value, label) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function snap(value) {
  return freeze(clone(value));
}

function hasEvidence(value) {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(text(value));
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function requireActiveWork(work = {}) {
  if (!text(work.workId)) throw new Error("GO WORKS requires Work ID");
  if (text(work.status) !== "ON PROCESS") throw new Error("GO WORKS requires ON PROCESS Work");
  if (!text(work.holder)) throw new Error("GO WORKS requires Work holder");
  return true;
}

function normalizeChecklist(items = []) {
  return (Array.isArray(items) ? items : []).map(item => {
    const status = text(item.status).toUpperCase() || "PENDING";
    if (!CHECK_STATUSES.has(status)) throw new Error("Critical Checklist status is invalid");
    return {
      id: required(item.id, "Checklist ID"),
      label: required(item.label, "Checklist label"),
      status,
      evidence: item.evidence ?? null,
    };
  });
}

function createIntake(work, form, inputReferences) {
  const legacyForge = form.forgeHandoff == null ? null : clone(form.forgeHandoff);
  const pixieHandoff = form.pixieHandoff == null
    ? (legacyForge ? { ...legacyForge, source: "PIXIE_LAB", station: "FORGE_BENCH" } : null)
    : clone(form.pixieHandoff);

  if (!pixieHandoff) {
    return {
      source: "DIRECT_GOVERNED_ENTRY",
      station: null,
      continuity: "SAME_WORK",
      workId: work.workId,
      checkpointId: text(work.checkpointId) || null,
      inputReferences: clone(inputReferences),
      pixieHandoff: null,
    };
  }

  const source = text(pixieHandoff.source || "PIXIE_LAB").toUpperCase();
  if (source !== "PIXIE_LAB") throw new Error("PIXIE_LAB_HANDOFF_SOURCE_INVALID");
  const handoffWorkId = text(pixieHandoff.workId || work.workId);
  if (handoffWorkId !== text(work.workId)) throw new Error("PIXIE_LAB_WORK_MISMATCH");
  const handoffCheckpointId = text(pixieHandoff.checkpointId || work.checkpointId);
  if (text(work.checkpointId) && handoffCheckpointId && handoffCheckpointId !== text(work.checkpointId)) {
    throw new Error("PIXIE_LAB_CHECKPOINT_MISMATCH");
  }

  return {
    source: "PIXIE_LAB",
    station: text(pixieHandoff.station || "LAB_EXIT"),
    continuity: "SAME_WORK",
    workId: work.workId,
    checkpointId: text(work.checkpointId) || handoffCheckpointId || null,
    inputReferences: clone(inputReferences),
    pixieHandoff,
  };
}

function normalizePreProductionInspection(inspection = {}) {
  const inspectionStatus = text(inspection.inspectionStatus || inspection.status).toUpperCase() || "PENDING";
  const sanitizationStatus = text(inspection.sanitizationStatus || inspection.sanitizeStatus).toUpperCase() || "PENDING";
  if (!CHECK_STATUSES.has(inspectionStatus) || !CHECK_STATUSES.has(sanitizationStatus)) {
    throw new Error("Pre-production inspection status is invalid");
  }
  const evidence = inspection.evidence ?? null;
  if ((inspectionStatus === "PASS" || sanitizationStatus === "PASS") && !hasEvidence(evidence)) {
    throw new Error("Pre-production PASS requires evidence");
  }
  return {
    inspectionStatus,
    sanitizationStatus,
    evidence,
    notes: text(inspection.notes) || null,
  };
}

export function enterFactoryV4({ work, form = {} } = {}) {
  requireActiveWork(work);
  const outputType = text(form.outputType).toUpperCase();
  if (!OUTPUT_TYPES.has(outputType)) throw new Error("Output Type must be FILE or REF");

  const projectId = text(form.projectId) || `FACTORY-${work.workId}`;
  const inputReferences = Array.isArray(form.inputReferences) ? form.inputReferences : [];
  return snap({
    workId: work.workId,
    projectId,
    factoryProjectId: projectId,
    displayName: GO_WORKS_DISPLAY_NAME,
    flowVersion: GO_WORKS_FLOW_VERSION,
    projectRef: {
      type: "FACTORY",
      ref: projectId,
      status: "ACTIVE",
      destination: "destination://factory",
      displayName: GO_WORKS_DISPLAY_NAME,
    },
    holder: work.holder,
    stage: "PLAN",
    intake: createIntake(work, form, inputReferences),
    preProductionInspection: normalizePreProductionInspection(form.preProductionInspection || {}),
    form: {
      goal: required(form.goal || work.command, "Goal/Command"),
      repository: required(form.repository, "Repository"),
      branch: required(form.branch, "Branch"),
      inputReferences,
      expectedOutput: required(form.expectedOutput || work.expectedResult, "Expected Output"),
      criticalChecklist: normalizeChecklist(form.criticalChecklist),
      outputType,
      mergeAuthority: "EXTERNAL_OWNER_GATE",
    },
    reality: null,
    build: null,
    assembly: null,
    check: null,
    merge: null,
    output: null,
    rollback: null,
    diagnosticEvidence: [],
  });
}

export function recordFactoryReality(state, reality = {}) {
  if (state.stage !== "PLAN") throw new Error("Reality inspection belongs to PRE_PRODUCTION_INSPECTION");
  const next = clone(state);
  next.reality = {
    repository: required(reality.repository, "Reality repository"),
    branch: required(reality.branch, "Reality branch"),
    headSha: required(reality.headSha, "Reality HEAD SHA"),
    changedFiles: Array.isArray(reality.changedFiles) ? reality.changedFiles : [],
    commits: Array.isArray(reality.commits) ? reality.commits : [],
    pullRequest: reality.pullRequest ?? null,
    checks: reality.checks ?? null,
    build: reality.build ?? null,
    artifact: reality.artifact ?? null,
    deployment: reality.deployment ?? null,
    release: reality.release ?? null,
    lastUpdated: required(reality.lastUpdated, "Reality Last Updated"),
  };
  return snap(next);
}

export function setFactoryPreProductionInspection(state, { inspection } = {}) {
  if (state.stage !== "PLAN") throw new Error("Pre-production inspection belongs to PRE_PRODUCTION_INSPECTION");
  const next = clone(state);
  next.preProductionInspection = normalizePreProductionInspection(inspection || {});
  return snap(next);
}

export function setFactoryPlan(state, { plan } = {}) {
  if (state.stage !== "PLAN") throw new Error("Legacy plan note belongs to PRE_PRODUCTION_INSPECTION");
  const next = clone(state);
  next.legacyPlanNote = required(plan, "Legacy plan note");
  return snap(next);
}

export function advanceFactory(state, { result = null, evidence = null } = {}) {
  const index = STAGES.indexOf(state.stage);
  if (index < 0) throw new Error("Factory stage is invalid");

  if (state.stage === "PLAN") {
    if (!state.reality) throw new Error("PRE_PRODUCTION_INSPECTION requires Reality before BUILD");
    const inspection = state.preProductionInspection || {};
    if (inspection.inspectionStatus !== "PASS" || inspection.sanitizationStatus !== "PASS") {
      throw new Error("PRE_PRODUCTION_INSPECTION must PASS inspection and sanitization before BUILD");
    }
    if (!hasEvidence(inspection.evidence)) {
      throw new Error("PRE_PRODUCTION_INSPECTION PASS requires evidence");
    }
  }

  if (state.stage === "CHECK") {
    const incomplete = state.form.criticalChecklist.filter(item => item.status !== "PASS");
    if (incomplete.length) throw new Error("Critical Checklist is not PASS");
    const missingEvidence = state.form.criticalChecklist.filter(item => !hasEvidence(item.evidence));
    if (missingEvidence.length) throw new Error("Critical Checklist PASS requires evidence");
  }

  if (state.stage === "OUTPUT") throw new Error("Factory is already at OUTPUT");

  const next = clone(state);
  if (state.stage === "BUILD") next.build = result;
  if (state.stage === "ASSEMBLY") next.assembly = result;
  if (state.stage === "CHECK") {
    next.check = {
      status: "PASS",
      checklist: clone(state.form.criticalChecklist),
      evidence: evidence ?? null,
    };
  }
  if (state.stage === "MERGE") next.merge = result;
  if (evidence) next.diagnosticEvidence.push(evidence);
  next.stage = STAGES[index + 1];
  return snap(next);
}

export function updateCriticalCheck(state, { id, status, evidence = null } = {}) {
  if (state.stage !== "CHECK") throw new Error("Critical Checklist updates belong to CHECK");
  const normalizedStatus = text(status).toUpperCase();
  if (!CHECK_STATUSES.has(normalizedStatus)) throw new Error("Critical Checklist status is invalid");
  if (normalizedStatus === "PASS" && !hasEvidence(evidence)) {
    throw new Error("Critical Checklist PASS requires evidence");
  }

  const next = clone(state);
  const item = next.form.criticalChecklist.find(candidate => candidate.id === text(id));
  if (!item) throw new Error("Critical Checklist item not found");
  item.status = normalizedStatus;
  item.evidence = evidence;
  next.check = {
    updated: true,
    allPass: next.form.criticalChecklist.every(candidate => candidate.status === "PASS" && hasEvidence(candidate.evidence)),
  };
  return snap(next);
}

export function safeStopToPlan(state, { reason, reality = null } = {}) {
  const next = clone(state);
  const fromStage = state.stage;
  const safeStopReason = required(reason, "Safe stop reason");
  next.stage = "PLAN";
  next.rollback = {
    status: "SAFE_STOPPED",
    fromStage,
    reason: safeStopReason,
    reality: clone(reality),
  };
  next.diagnosticEvidence.push({ type: "SAFE_STOP", fromStage, reason: safeStopReason, reality });
  return snap(next);
}

export function finishFactory(state, { file = null, ref = null, summary = null } = {}) {
  if (state.stage !== "OUTPUT") throw new Error("Factory is not at OUTPUT");  const value = state.form.outputType === "FILE" ? file : ref;
  if (!value) throw new Error(`${state.form.outputType} output is required`);

  const next = clone(state);
  next.output = {
    type: state.form.outputType,
    value,
    summary,
    readbackRequired: true,
  };
  next.projectRef = {
    ...next.projectRef,
    status: "COMPLETE",
    lastUpdated: new Date().toISOString(),
  };
  return snap(next);
}

function truthValue(value, updatedAt, { now = Date.now(), staleAfterMs = 24 * 60 * 60 * 1000 } = {}) {
  if (value == null || value === "") return "UNKNOWN";
  const time = Date.parse(updatedAt || "");
  return Number.isFinite(time) && now - time > staleAfterMs ? "STALE" : value;
}

export function factoryLiveBoard(input = {}, options = {}) {
  const reality = input.reality || input;
  const updatedAt = text(reality.lastUpdated || reality.updatedAt) || null;
  return snap({
    repository: truthValue(reality.repository, updatedAt, options),
    branch: truthValue(reality.branch, updatedAt, options),
    head: truthValue(reality.head || reality.headSha, updatedAt, options),
    diff: truthValue(reality.diff || reality.changedFiles, updatedAt, options),
    pr: truthValue(reality.pr || reality.pullRequest, updatedAt, options),
    ci: truthValue(reality.ci || reality.checks, updatedAt, options),
    artifact: truthValue(reality.artifact, updatedAt, options),
    lastUpdated: updatedAt || "UNKNOWN",
  });
}

function goWorksFlowPhase(state = {}) {
  if (state.stage === "PLAN") return "PRE_PRODUCTION_INSPECTION";
  if (state.stage === "BUILD") return "BUILD";
  if (state.stage === "ASSEMBLY") return "ASSEMBLY";
  if (state.stage === "MERGE") return "WAIT_EXTERNAL_OWNER_GATE";
  if (state.stage === "CHECK") return "POST_MERGE_VERIFY";
  if (state.stage === "OUTPUT") return "OUTPUT_READBACK";
  return "UNKNOWN";
}

export function factoryBoardView(state) {
  const ownerGate = state.stage === "MERGE"
    ? { status: "WAIT_EXTERNAL_OWNER_GATE", authority: "GO_HUB_MERGE_OWNER_TRUTH" }
    : state.merge
      ? { status: "RECEIPT_OBSERVED", authority: "GO_HUB_MERGE_OWNER_TRUTH" }
      : { status: "NOT_REACHED", authority: "GO_HUB_MERGE_OWNER_TRUTH" };

  return snap({
    workId: state.workId,
    projectId: state.projectId || `FACTORY-${state.workId}`,
    displayName: state.displayName || GO_WORKS_DISPLAY_NAME,
    flowVersion: state.flowVersion || GO_WORKS_FLOW_VERSION,
    flowPhase: goWorksFlowPhase(state),
    flowPath: [
      "PIXIE_LAB_HANDOFF",
      "PRE_PRODUCTION_INSPECTION",
      "BUILD",
      "ASSEMBLY",
      "WAIT_EXTERNAL_OWNER_GATE",
      "POST_MERGE_VERIFY",
      "OUTPUT_READBACK",
    ],
    holder: state.holder,
    stage: state.stage,
    intake: state.intake || null,
    preProductionInspection: state.preProductionInspection || null,
    ownerGate,
    rollback: state.rollback || null,
    reality: state.reality || { status: "UNKNOWN" },
    output: state.output,
    liveBoard: factoryLiveBoard(state.reality || {}),
  });
}

export { STAGES, GO_WORKS_DISPLAY_NAME, GO_WORKS_FLOW_VERSION };

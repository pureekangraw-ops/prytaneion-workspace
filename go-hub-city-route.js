import { decideEvidenceGate } from "./go-hub-heimdall.js";
import { CITY_DESTINATIONS, CITY_MAP_BACKEND, getCityDestination } from "./go-hub-route-contract.js";
import { resolveWorkInterruption } from "./go-hub-work-lifecycle.js";

const HEIMDALL = Object.freeze({
  id: "heimdall",
  responsibilities: Object.freeze(["BOUNDARY", "SAFETY", "PERMISSION", "STOP", "EVIDENCE_GATE"]),
});

const READ_ONLY_FAST_LANE_OPERATIONS = Object.freeze(["SEARCH", "LIST", "READ", "INSPECT", "METADATA"]);
const READ_ONLY_FAST_LANE_OPERATION_SET = new Set(READ_ONLY_FAST_LANE_OPERATIONS);

const CITY_ROUTE = Object.freeze({
  bridge: Object.freeze({ id: "bifrost", role: "CHAT_HUB_TRANSPORT" }),
  entry: Object.freeze({
    id: "optician",
    label: "ช่างแว่น",
    responsibilities: Object.freeze(["INTAKE", "LENS", "ROUTE"]),
  }),
  guardian: HEIMDALL,
  loop: Object.freeze({
    id: "go-work-loop",
    cycle: Object.freeze(["GO", "ACTION", "REALITY", "PROGRESS"]),
    roundGate: "optician",
  }),
  information: Object.freeze({
    id: "counter",
    role: "INFORMATION_EXCHANGE",
    scope: "city-wide",
  }),
  readOnlyFastLane: Object.freeze({
    id: "read-only-fast-lane",
    role: "READ_ONLY",
    purpose: "READ_TELL",
    operations: READ_ONLY_FAST_LANE_OPERATIONS,
    returnTo: "big-chat",
  }),
  exit: HEIMDALL,
  returnTo: "big-chat",
  map: CITY_MAP_BACKEND,
  destinations: CITY_DESTINATIONS,
});

function heimdallDecision(heimdall = {}) {
  const decision = String(heimdall.decision || "").toUpperCase();
  return {
    decision,
    reason: String(heimdall.reason || "HEIMDALL_REVIEW_REQUIRED"),
  };
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required`);
  return text;
}

function snapshot(value) {
  const copy = structuredClone(value);
  const freeze = current => {
    if (current && typeof current === "object" && !Object.isFrozen(current)) {
      Object.values(current).forEach(freeze);
      Object.freeze(current);
    }
    return current;
  };
  return freeze(copy);
}

function workIdentity(input = {}) {
  const workId = required(input.workId, "Work ID");
  const checkpointId = required(input.checkpointId, "Checkpoint ID");
  const returnAddress = required(input.returnAddress, "Return Address");
  if (checkpointId !== returnAddress) {
    throw new Error("Work identity Return Address does not match Checkpoint ID");
  }
  return snapshot({ workId, checkpointId, returnAddress });
}

function attachWorkIdentity(route, identity) {
  return Object.freeze({ ...route, ...identity });
}

function canonicalFitDestination(fit = {}) {
  const byRoute = getCityDestination(fit.route);
  const byId = getCityDestination(fit.destinationId);
  if (!byRoute || !byId || byRoute.id !== byId.id) return null;
  return byRoute;
}

export function createCityRoute() {
  return CITY_ROUTE;
}

export function resolveBackendRoute({ destination, workId, checkpointId, status = "ON PROCESS" } = {}) {
  const target = getCityDestination(destination);
  if (!target) return Object.freeze({ map: CITY_MAP_BACKEND.owner, route: null, status:"UNKNOWN", reason:"DESTINATION_UNKNOWN" });
  return Object.freeze({
    map:CITY_MAP_BACKEND.owner,
    route:target.route,
    destinationId:target.id,
    role:target.role,
    workId:String(workId || "").trim() || null,
    checkpointId:String(checkpointId || "").trim() || null,
    status:String(status || "ON PROCESS").trim().toUpperCase(),
    automatic:true,
    agentSelectionRequired:false,
  });
}

export function crossBifrost(packet = {}, { direction = "" } = {}) {
  const bridgeDirection = required(direction, "Bifrost direction").toUpperCase();
  if (!["CHAT_TO_HUB", "HUB_TO_CHAT"].includes(bridgeDirection)) {
    throw new Error("unsupported Bifrost direction");
  }
  const workId = required(packet.workId, "Work ID");
  const checkpointId = required(packet.checkpointId, "Checkpoint ID");
  const returnAddress = required(packet.returnAddress, "Return Address");
  if (checkpointId !== returnAddress) {
    throw new Error("Bifrost packet Return Address does not match Checkpoint ID");
  }
  return Object.freeze({
    bridge: "bifrost",
    direction: bridgeDirection,
    packet: snapshot({ ...packet, workId, checkpointId, returnAddress }),
  });
}

export function enterWorkLoop(fit = {}) {
  if (fit.gate !== "PASS") {
    return Object.freeze({
      destination: "optician",
      via: "optician",
      reason: "GATE_NOT_PASSED",
    });
  }
  return Object.freeze({
    destination: "go-work-loop",
    via: "optician",
    workRoute: String(fit.route || "") || null,
    destinationId: String(fit.destinationId || "") || null,
  });
}

export function routeInbound({ heimdall = {}, fit = {} } = {}) {
  const passage = heimdallDecision(heimdall);
  if (passage.decision !== "PASS") {
    return Object.freeze({ destination: "heimdall", reason: passage.reason });
  }
  if (fit.gate !== "PASS") {
    return Object.freeze({ destination: "optician", reason: "FIT_NOT_READY" });
  }
  const target = canonicalFitDestination(fit);
  if (!target) {
    return Object.freeze({
      destination: "optician",
      reason: "DESTINATION_NOT_CANONICAL",
    });
  }
  return Object.freeze({
    destination: "go-work-loop",
    via: "optician",
    boundary: "heimdall",
    workRoute: target.route,
    destinationId: target.id,
  });
}

export function routeOutbound({ heimdall = {}, evidenceGate = null, needsOptician = false } = {}) {
  if (evidenceGate) {
    const gate = decideEvidenceGate(evidenceGate);
    if (gate.decision !== "PASS") return Object.freeze({ destination: "heimdall", reason: gate.reason, evidenceDecision: gate.decision });
  }
  const passage = heimdallDecision(heimdall);
  if (passage.decision !== "PASS") {
    return Object.freeze({ destination: "heimdall", reason: passage.reason });
  }
  if (needsOptician) {
    return Object.freeze({
      destination: "optician",
      via: "heimdall",
      reason: "REFIT_OR_SUMMARY_REQUIRED",
    });
  }
  return Object.freeze({
    destination: "bifrost",
    via: "heimdall",
    next: "big-chat",
    reason: "PASSAGE_ALLOWED",
  });
}

export function routeInformation({ question = "", resumeAt = "optician" } = {}) {
  return Object.freeze({
    destination: "counter",
    purpose: "INFORMATION",
    resumeAt: String(resumeAt || "optician"),
    question: String(question || ""),
  });
}

export function routeReadOnlyFastLane({ purpose = "", operations = [] } = {}) {
  const normalizedPurpose = String(purpose || "").trim().toUpperCase();
  const normalizedOperations = Array.isArray(operations)
    ? [...new Set(operations.map(value => String(value || "").trim().toUpperCase()).filter(Boolean))]
    : [];
  const forbiddenOperations = normalizedOperations.filter(
    operation => !READ_ONLY_FAST_LANE_OPERATION_SET.has(operation),
  );

  if (normalizedPurpose !== "READ_TELL") {
    return Object.freeze({
      gate: "ESCALATE",
      destination: "optician",
      reason: "READ_SERVES_WORK",
      workRequired: true,
      fastLane: false,
      next: "normal-work-intake",
    });
  }
  if (!normalizedOperations.length) {
    return Object.freeze({
      gate: "WAIT",
      destination: "optician",
      reason: "READ_OPERATION_REQUIRED",
      workRequired: false,
      fastLane: false,
    });
  }
  if (forbiddenOperations.length) {
    return Object.freeze({
      gate: "ESCALATE",
      destination: "optician",
      reason: "READ_ONLY_BOUNDARY_EXCEEDED",
      workRequired: true,
      fastLane: false,
      forbiddenOperations: Object.freeze(forbiddenOperations),
      next: "normal-work-intake",
    });
  }

  return Object.freeze({
    gate: "PASS",
    destination: "read-only-fast-lane",
    via: "optician",
    purpose: "READ_TELL",
    operations: Object.freeze(normalizedOperations),
    workRequired: false,
    plannerRequired: false,
    fastLane: true,
    returnTo: "big-chat",
    reason: "READ_TELL_ONLY",
  });
}

export function routeExit({ done = false, exitReady = false } = {}) {
  if (!done) {
    return Object.freeze({
      destination: "go-work-loop",
      via: "heimdall",
      reason: "WORK_NOT_DONE",
    });
  }
  if (!exitReady) {
    return Object.freeze({
      destination: "go-work-loop",
      via: "heimdall",
      reason: "EXIT_NOT_READY",
    });
  }
  return Object.freeze({
    destination: "big-chat",
    via: "bifrost",
    reason: "READY_TO_RETURN",
  });
}


export function routeInterruptionReturn({
  requested,
  realityExists = false,
  merged = false,
  deployed = false,
  workId,
  checkpointId,
  returnAddress,
} = {}) {
  const identity = workIdentity({ workId, checkpointId, returnAddress });
  const interruption = resolveWorkInterruption({
    requested,
    realityExists,
    merged,
    deployed,
  });
  return attachWorkIdentity({
    destination: "centre",
    via: "destination-return",
    reason: interruption.state,
    interruption,
  }, identity);
}

export function routeInterruptionFromCentre({
  interruption,
  needsOptician = false,
  heimdall = {},
  workId,
  checkpointId,
  returnAddress,
} = {}) {
  const identity = workIdentity({ workId, checkpointId, returnAddress });
  if (!interruption || typeof interruption !== "object") {
    throw new Error("interruption resolution is required");
  }
  if (interruption.state === "RECOVERY_REQUIRED") {
    return attachWorkIdentity({
      destination: "go-work-loop",
      via: "centre",
      reason: "RECOVERY_REQUIRED",
      actions: interruption.actions,
    }, identity);
  }
  if (interruption.state === "BLOCKED") {
    return attachWorkIdentity({
      destination: "centre",
      via: "centre",
      reason: "BLOCKED",
      actions: interruption.actions,
    }, identity);
  }
  if (needsOptician) {
    return attachWorkIdentity({
      destination: "optician",
      via: "centre",
      reason: interruption.state,
    }, identity);
  }
  const passage = heimdallDecision(heimdall);
  if (passage.decision !== "PASS") {
    return attachWorkIdentity({
      destination: "heimdall",
      via: "centre",
      reason: passage.reason,
      interruption: interruption.state,
    }, identity);
  }
  return attachWorkIdentity({
    destination: "bifrost",
    via: "heimdall",
    next: "big-chat",
    reason: interruption.state,
  }, identity);
}


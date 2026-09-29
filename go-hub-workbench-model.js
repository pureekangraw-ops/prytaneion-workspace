import { resolveEffectiveTaskAuthority } from "./go-hub-factory-authority.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function baseView(taskSnapshot = {}, { status, next } = {}) {
  return Object.freeze({
    mission: taskSnapshot.mission == null ? null : clone(taskSnapshot.mission),
    blueprint: taskSnapshot.blueprint == null ? null : clone(taskSnapshot.blueprint),
    currentPiece: taskSnapshot.currentPiece == null ? null : clone(taskSnapshot.currentPiece),
    status: text(status) || "UNKNOWN",
    evidence: Array.isArray(taskSnapshot.evidence) ? clone(taskSnapshot.evidence) : [],
    next: text(next) || null,
    blocker: taskSnapshot.blocker == null ? null : String(taskSnapshot.blocker),
  });
}

// PRYTANEION Logic Workspace projection: Factory fields never carry workspace authority.
export function createLogicWorkbenchView(taskSnapshot = {}) {
  return baseView(taskSnapshot, {
    status: taskSnapshot.status || taskSnapshot.state,
    next: taskSnapshot.nextAction,
  });
}

// Compatibility projection for legacy production consumers while Factory is moved out.
export function createWorkbenchView(taskSnapshot = {}) {
  const authority = resolveEffectiveTaskAuthority(taskSnapshot);
  return baseView(taskSnapshot, { status: authority.status, next: authority.nextAction });
}

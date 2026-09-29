function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").trim();
}

export function createWorkbenchView(taskSnapshot = {}) {
  return Object.freeze({
    mission: taskSnapshot.mission == null ? null : clone(taskSnapshot.mission),
    blueprint: taskSnapshot.blueprint == null ? null : clone(taskSnapshot.blueprint),
    currentPiece: taskSnapshot.currentPiece == null ? null : clone(taskSnapshot.currentPiece),
    status: text(taskSnapshot.status || taskSnapshot.state) || "UNKNOWN",
    evidence: Array.isArray(taskSnapshot.evidence) ? clone(taskSnapshot.evidence) : [],
    next: text(taskSnapshot.nextAction) || null,
    blocker: taskSnapshot.blocker == null ? null : String(taskSnapshot.blocker),
  });
}

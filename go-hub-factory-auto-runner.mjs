import { resolveEffectiveTaskAuthority } from "./go-hub-factory-authority.js";

const DEFAULT_MAX_STEPS = 32;
const DEFAULT_RETRY_BUDGET = 2;
const TERMINAL_ACTIONS = new Set(["complete"]);
const OWNER_REQUIRED_ACTIONS = new Set(["resolve-blocker", "resolve-conflict"]);
const UNSUPPORTED_AUTO_ACTIONS = new Set(["fix-piece", "fix-assembly", "fix-product", "repair-first-broken-truth"]);
const AUTO_ACTIONS = new Set(["inspect-reality", "write", "check-ci", "diagnose-failure", "local-verify"]);
const ACTION_ADAPTERS = Object.freeze({
  "inspect-reality": "inspect",
  "write": "write",
  "check-ci": "check_ci",
  "diagnose-failure": "diagnose_failure",
});

export function resolveFactoryExecutionAction(action) {
  const value = text(action);
  return ACTION_ADAPTERS[value] || value.replaceAll("-", "_");
}

function text(value) { return String(value ?? "").trim(); }

export function classifyFactoryAutoAction(snapshot = {}) {
  const authority = resolveEffectiveTaskAuthority(snapshot);
  const action = text(authority.nextAction);
  if (!action) return Object.freeze({ ...authority, mode: "WAIT", reason: "NO_NEXT_ACTION" });
  if (TERMINAL_ACTIONS.has(action)) return Object.freeze({ ...authority, mode: "COMPLETE", reason: "TERMINAL" });
  if (OWNER_REQUIRED_ACTIONS.has(action)) return Object.freeze({ ...authority, mode: "WAIT", reason: "OWNER_OR_RECONCILIATION_REQUIRED" });
  if (UNSUPPORTED_AUTO_ACTIONS.has(action)) return Object.freeze({ ...authority, mode: "WAIT", reason: "RECOVERY_EXECUTOR_REQUIRED" });
  if (!AUTO_ACTIONS.has(action)) return Object.freeze({ ...authority, mode: "WAIT", reason: "UNKNOWN_ACTION" });
  return Object.freeze({ ...authority, mode: "AUTO", reason: "ACTIONABLE" });
}

export function createFactoryAutoRunner({
  loadTask,
  executeAction,
  acquireLock = async () => ({ acquired: true }),
  releaseLock = async () => {},
  maxSteps = DEFAULT_MAX_STEPS,
  retryBudget = DEFAULT_RETRY_BUDGET,
} = {}) {
  if (typeof loadTask !== "function" || typeof executeAction !== "function") {
    throw new Error("loadTask and executeAction are required");
  }

  return Object.freeze({
    async run({ taskId, inputForAction = () => ({}) } = {}) {
      const id = text(taskId);
      if (!id) throw new Error("taskId is required");
      const lock = await acquireLock(id);
      if (!lock?.acquired) return { status: "BUSY", taskId: id, reason: "FACTORY_LOCK_HELD" };

      const receipts = [];
      const retries = new Map();
      try {
        for (let step = 0; step < maxSteps; step += 1) {
          const loaded = await loadTask(id);
          const snapshot = loaded?.task || loaded;
          if (!snapshot) return { status: "WAIT", taskId: id, reason: "TASK_NOT_FOUND", receipts };
          const decision = classifyFactoryAutoAction(snapshot);
          if (decision.mode === "COMPLETE") return { status: "DONE", taskId: id, decision, receipts };
          if (decision.mode === "WAIT") return { status: "WAIT", taskId: id, decision, receipts };

          const action = decision.nextAction;
          const executionAction = resolveFactoryExecutionAction(action);
          const key = `${snapshot.state || snapshot.factoryStage || "UNKNOWN"}:${action}`;
          let result;
          try {
            result = await executeAction({
            taskId: id,
            action: executionAction,
            input: await inputForAction(action, snapshot),
            expectedRevision: loaded?.revision,
            });
          } catch (error) {
            return { status: "WAIT", taskId: id, reason: "EXECUTION_EXCEPTION", failedAction: action, error: error instanceof Error ? error.message : String(error), receipts };
          }
          receipts.push({ action, executionAction, status: result?.status || "UNKNOWN", receiptId: result?.receipt?.id || null });

          if (["OK", "STALE_TASK"].includes(result?.status)) {
            retries.delete(key);
            continue;
          }
          if (result?.status === "RECONCILIATION_REQUIRED") continue;
          if (["BLOCKED", "MISSING", "CONFLICT"].includes(result?.status)) {
            return { status: "WAIT", taskId: id, reason: result.status, result, receipts };
          }

          const count = (retries.get(key) || 0) + 1;
          retries.set(key, count);
          if (count > retryBudget) {
            return { status: "WAIT", taskId: id, reason: "RETRY_BUDGET_EXHAUSTED", failedAction: action, receipts };
          }
        }
        return { status: "WAIT", taskId: id, reason: "STEP_BUDGET_EXHAUSTED", receipts };
      } finally {
        await releaseLock(id, lock);
      }
    },
  });
}

export { DEFAULT_MAX_STEPS, DEFAULT_RETRY_BUDGET };

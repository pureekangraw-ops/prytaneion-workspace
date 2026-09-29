import { createCodeTask, createCodeTaskFromSnapshot } from "./go-hub-code-task.js";
import { createRealityReceipt, fingerprintCompare } from "./go-hub-reality-receipt.mjs";

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

function auditEvent({ action, receipt, before, after, at }) {
  return {
    event: "FACTORY_ACTION",
    action,
    receiptId: receipt.id,
    from: before?.state || null,
    to: after?.state || null,
    status: receipt.status,
    headSha: receipt.identity?.headSha || null,
    pullRequestNumber: receipt.identity?.pullRequestNumber || null,
    runId: receipt.identity?.runId || null,
    at,
  };
}

function classifyCi(payload = {}) {
  const signals = [...(payload.runs || []), ...(payload.checks || [])];
  if (signals.length === 0) return "CI_RUNNING";
  if (signals.some(item => item.status === "completed" && item.conclusion && item.conclusion !== "success")) return "CI_FAILED";
  if (signals.every(item => item.status === "completed" && item.conclusion === "success")) return "CI_GREEN";
  return "CI_RUNNING";
}

export function createFactoryController({ lifecycle, state, now = () => new Date().toISOString(), createId = () => crypto.randomUUID() } = {}) {
  if (!lifecycle || !state) throw new Error("lifecycle and state are required");

  async function loadCurrent(expectedRevision) {
    const stored = await state.load();
    const revision = stored?.revision ?? 0;
    if (expectedRevision != null && Number(expectedRevision) !== revision) throw new Error("STALE_TASK_REVISION");
    return { stored, revision };
  }

  async function save({ revision, task, receipt, action, before }) {
    try {
      const snapshot = task.snapshot();
      const saved = await state.save({
        expectedRevision: revision,
        task: snapshot,
        receipt,
        auditEvent: auditEvent({ action, receipt, before, after: snapshot, at: now() }),
      });
      return {
        status: receipt.status === "success" ? "OK" : "ACTION_FAILED",
        receipt,
        task: saved.task,
        revision: saved.revision,
        nextAction: saved.task.nextAction,
      };
    } catch (error) {
      if (receipt.status === "success") {
        return {
          status: "RECONCILIATION_REQUIRED",
          receipt,
          task: null,
          revision,
          nextAction: "reconcile",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      throw error;
    }
  }

  async function saveReconciliation({ revision, before, next, receipt, status, reconciliation }) {
    const saved = await state.save({
      expectedRevision: revision,
      task: next.snapshot(),
      receipt,
      auditEvent: auditEvent({ action: "reconcile", receipt, before, after: next.snapshot(), at: now() }),
    });
    return {
      status,
      receipt,
      task: saved.task,
      revision: saved.revision,
      nextAction: saved.task.nextAction,
      reconciliation,
    };
  }

  async function reconcileBeforeMutation(before, revision) {
    if (!before.workBranch) return { status: "MATCH" };
    const branchResponse = await lifecycle.inspect({ repository: before.repository, branch: before.workBranch });
    const branch = await parseResponse(branchResponse);
    if (!branch.ok) {
      if (branch.status !== 404) throw new Error(`RECONCILIATION_FAILED:${branch.status}`);
      const blocker = `work branch missing: ${before.workBranch}`;
      const receipt = createRealityReceipt({
        id: createId(), action: "reconcile", status: "failure", repository: before.repository,
        observedAt: now(), source: "github",
        identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: before.headSha },
        result: branch.payload,
        evidence: { missing: `branch:${before.workBranch}` },
      });
      const next = createCodeTaskFromSnapshot(before).transition("BLOCKED", { blocker, headSha: before.headSha });
      return saveReconciliation({
        revision, before, next, receipt, status: "MISSING",
        reconciliation: { status: "MISSING", resource: `branch:${before.workBranch}` },
      });
    }

    const liveHead = branch.payload.headSha;
    if (!liveHead) throw new Error("RECONCILIATION_FAILED:branch head missing");

    if (before.pullRequest?.number && typeof lifecycle.getPullRequest === "function") {
      const prResponse = await lifecycle.getPullRequest({ repository: before.repository, number: before.pullRequest.number });
      const pr = await parseResponse(prResponse);
      if (!pr.ok) {
        if (pr.status !== 404) throw new Error(`RECONCILIATION_FAILED:${pr.status}`);
        const blocker = `PR ${before.pullRequest.number} missing`;
        const receipt = createRealityReceipt({
          id: createId(), action: "reconcile", status: "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: { workBranch: before.workBranch, headSha: liveHead, pullRequestNumber: before.pullRequest.number },
          result: pr.payload,
          evidence: { missing: `pr:${before.pullRequest.number}` },
        });
        const next = createCodeTaskFromSnapshot(before).transition("BLOCKED", { blocker, headSha: liveHead });
        return saveReconciliation({
          revision, before, next, receipt, status: "MISSING",
          reconciliation: { status: "MISSING", resource: `pr:${before.pullRequest.number}` },
        });
      }
      if (pr.payload.headBranch !== before.workBranch || pr.payload.baseBranch !== before.baseBranch || pr.payload.headSha !== liveHead) {
        const blocker = `PR ${before.pullRequest.number} identity conflicts with live branch`;
        const receipt = createRealityReceipt({
          id: createId(), action: "reconcile", status: "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: { baseBranch: pr.payload.baseBranch, workBranch: pr.payload.headBranch, headSha: pr.payload.headSha, pullRequestNumber: pr.payload.number },
          result: pr.payload,
          evidence: { observedBranchHeadSha: liveHead },
        });
        const next = createCodeTaskFromSnapshot(before).transition("CONFLICT", { blocker, headSha: before.headSha });
        return saveReconciliation({
          revision, before, next, receipt, status: "CONFLICT",
          reconciliation: { status: "CONFLICT", observedHeadSha: liveHead, pullRequestHeadSha: pr.payload.headSha },
        });
      }
    }

    if (liveHead !== before.headSha) {
      const receipt = createRealityReceipt({
        id: createId(), action: "reconcile", status: "success", repository: before.repository,
        observedAt: now(), source: "github",
        identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: liveHead, pullRequestNumber: before.pullRequest?.number || null },
        result: branch.payload,
        evidence: { priorHeadSha: before.headSha, observedHeadSha: liveHead },
      });
      const next = createCodeTaskFromSnapshot(before).transition("EDITING", {
        headSha: liveHead,
        touchedPaths: before.touchedPaths || [],
      });
      return saveReconciliation({
        revision, before, next, receipt, status: "STALE_TASK",
        reconciliation: { status: "ADVANCED_EXTERNALLY", observedHeadSha: liveHead },
      });
    }

    return { status: "MATCH" };
  }

  return Object.freeze({
    async execute({ taskId, action, input = {}, expectedRevision } = {}) {
      const id = String(taskId || "").trim();
      if (!id) throw new Error("taskId is required");
      const current = await loadCurrent(expectedRevision);

      if (action === "inspect" && current.stored?.task) {
        const before = current.stored.task;
        const repository = String(input.repository || before.repository || "").trim();
        if (!repository || repository !== before.repository) throw new Error("IDENTITY_MISMATCH");
        const branch = before.workBranch || before.baseBranch || input.branch;
        const response = await lifecycle.inspect({ repository, ...(branch ? { branch } : {}) });
        const parsed = await parseResponse(response);
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository,
          observedAt: now(), source: "github",
          identity: parsed.ok ? {
            baseBranch: parsed.payload.defaultBranch,
            baseSha: parsed.payload.baseSha,
            workBranch: before.workBranch || null,
            headSha: parsed.payload.headSha,
            pullRequestNumber: before.pullRequest?.number || null,
          } : {
            baseBranch: before.baseBranch,
            baseSha: before.baseSha,
            workBranch: before.workBranch,
            headSha: before.headSha,
            pullRequestNumber: before.pullRequest?.number || null,
          },
          result: parsed.payload,
          evidence: parsed.ok ? { treeCount: Array.isArray(parsed.payload.tree) ? parsed.payload.tree.length : 0, resumed: true } : { upstreamStatus: parsed.status },
        });
        const task = createCodeTaskFromSnapshot(before);
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        if (before.workBranch && parsed.payload.branch !== before.workBranch) throw new Error("IDENTITY_MISMATCH");
        if (!before.workBranch && parsed.payload.branch !== before.baseBranch) throw new Error("IDENTITY_MISMATCH");
        const next = parsed.payload.headSha !== before.headSha
          ? task.transition(before.workBranch ? "EDITING" : "INSPECTING", {
              baseBranch: parsed.payload.defaultBranch,
              baseSha: parsed.payload.baseSha,
              workBranch: before.workBranch || null,
              headSha: parsed.payload.headSha,
              ...(before.workBranch ? { touchedPaths: before.touchedPaths || [] } : {}),
            })
          : task.appendAudit("FACTORY_INSPECT_REFRESH", {
              repository,
              branch: parsed.payload.branch,
              headSha: parsed.payload.headSha,
            });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "inspect") {
        const repository = String(input.repository || "").trim();
        const intent = String(input.intent || "").trim();
        if (!repository) throw new Error("repository is required");
        if (!intent) throw new Error("intent is required");
        const response = await lifecycle.inspect({ repository, ...(input.branch ? { branch: input.branch } : {}) });
        const parsed = await parseResponse(response);
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository,
          observedAt: now(), source: "github",
          identity: parsed.ok ? {
            baseBranch: parsed.payload.defaultBranch,
            baseSha: parsed.payload.baseSha,
            workBranch: parsed.payload.branch === parsed.payload.defaultBranch ? null : parsed.payload.branch,
            headSha: parsed.payload.headSha,
          } : {},
          result: parsed.payload,
          evidence: parsed.ok ? { treeCount: Array.isArray(parsed.payload.tree) ? parsed.payload.tree.length : 0 } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return { status: "ACTION_FAILED", receipt, task: null, revision: 0, nextAction: "inspect" };
        let task = createCodeTask({ id, intent, repository });
        task = task.transition("INSPECTING", {
          baseBranch: parsed.payload.defaultBranch,
          baseSha: parsed.payload.baseSha,
          workBranch: parsed.payload.branch === parsed.payload.defaultBranch ? null : parsed.payload.branch,
          headSha: parsed.payload.headSha,
        });
        return save({ revision: current.revision, task, receipt, action, before: null });
      }

      if (!current.stored?.task) throw new Error("existing task is required");
      const before = current.stored.task;
      const task = createCodeTaskFromSnapshot(before);

      if (action === "create_branch") {
        const name = String(input.name || "").trim();
        const fromSha = String(input.fromSha || "").trim();
        if (!name || !fromSha) throw new Error("branch name and fromSha are required");
        if (fromSha !== before.baseSha) throw new Error("IDENTITY_MISMATCH");
        const response = await lifecycle.createBranch({ repository: before.repository, name, fromSha });
        const parsed = await parseResponse(response);
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: parsed.ok ? { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: parsed.payload.branch, headSha: parsed.payload.headSha } : { baseBranch: before.baseBranch, baseSha: before.baseSha },
          result: parsed.payload,
          evidence: parsed.ok ? { created: true } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        if (parsed.payload.branch !== name || parsed.payload.headSha !== fromSha) throw new Error("IDENTITY_MISMATCH");
        const next = task.transition("BRANCH_READY", {
          baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: name, headSha: parsed.payload.headSha,
        });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "write" || action === "delete") {
        if (!before.workBranch) {
          return { status: "BLOCKED", receipt: null, task: before, revision: current.revision, nextAction: "edit" };
        }
        const reconciled = await reconcileBeforeMutation(before, current.revision);
        if (reconciled.status !== "MATCH") return reconciled;
        const method = action === "write" ? "putFile" : "deleteFile";
        const args = {
          repository: before.repository,
          path: String(input.path || ""),
          branch: before.workBranch,
          expectedSha: input.expectedSha,
          ...(action === "write" ? { content: String(input.content ?? "") } : {}),
        };
        const response = await lifecycle[method](args);
        const parsed = await parseResponse(response);
        const commitSha = parsed.payload?.commit || null;
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: commitSha || before.headSha, commitSha },
          result: parsed.payload,
          evidence: parsed.ok ? { path: args.path, blobSha: parsed.payload?.sha || null } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        if (!commitSha) throw new Error("IDENTITY_MISMATCH");
        const touched = [...new Set([...(before.touchedPaths || []), args.path])];
        const next = task.transition("EDITING", { headSha: commitSha, touchedPaths: touched });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "compare") {
        if (!before.baseBranch || !before.headSha) throw new Error("compare identity is incomplete");
        const response = await lifecycle.compare({ repository: before.repository, base: before.baseBranch, head: before.headSha });
        const parsed = await parseResponse(response);
        const diffFingerprint = parsed.ok ? fingerprintCompare({ base: before.baseBranch, head: before.headSha, ...parsed.payload }) : null;
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: before.headSha },
          result: parsed.payload,
          evidence: parsed.ok ? { diffFingerprint, files: parsed.payload.files || [] } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        const next = task.transition("DIFF_REVIEWED", { headSha: before.headSha, diffFingerprint });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "open_pr") {
        const response = await lifecycle.openPullRequest({
          repository: before.repository,
          branch: before.workBranch,
          base: before.baseBranch,
          title: String(input.title || "").trim(),
          body: String(input.body || ""),
        });
        const parsed = await parseResponse(response);
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: {
            baseBranch: parsed.payload.baseBranch || before.baseBranch,
            baseSha: parsed.payload.baseSha || before.baseSha,
            workBranch: parsed.payload.headBranch || before.workBranch,
            headSha: parsed.payload.headSha || before.headSha,
            pullRequestNumber: parsed.payload.number || null,
          },
          result: parsed.payload,
          evidence: parsed.ok ? { mergeable: parsed.payload.mergeable ?? null, state: parsed.payload.state || null } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        if (parsed.payload.headSha !== before.headSha || parsed.payload.headBranch !== before.workBranch || parsed.payload.baseBranch !== before.baseBranch) {
          throw new Error("IDENTITY_MISMATCH");
        }
        const next = task.transition("PR_OPEN", { headSha: before.headSha, pullRequest: parsed.payload });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "check_ci") {
        const response = await lifecycle.getCI({ repository: before.repository, sha: before.headSha });
        const parsed = await parseResponse(response);
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: parsed.payload.headSha || before.headSha, pullRequestNumber: before.pullRequest?.number || null },
          result: parsed.payload,
          evidence: parsed.ok ? { runs: parsed.payload.runs || [], checks: parsed.payload.checks || [] } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        if (parsed.payload.headSha !== before.headSha) throw new Error("IDENTITY_MISMATCH");
        const nextState = classifyCi(parsed.payload);
        const conclusion = nextState === "CI_GREEN" ? "success" : nextState === "CI_FAILED" ? "failure" : null;
        const next = task.transition(nextState, {
          headSha: before.headSha,
          ci: { headSha: before.headSha, conclusion, runs: parsed.payload.runs || [], checks: parsed.payload.checks || [] },
        });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "track_deploy") {
        const deploymentSha = before.merge?.mergeSha || before.merge?.sha || before.headSha;
        const response = await lifecycle.getWorkflowRuns({ repository: before.repository, sha: deploymentSha });
        const parsed = await parseResponse(response);
        const runs = parsed.ok ? (parsed.payload.runs || []) : [];
        const deployRuns = runs.filter(run => /deploy|production/i.test(String(run.name || "")));
        const terminal = deployRuns.filter(run => String(run.status || "") === "completed");
        const failed = terminal.find(run => String(run.conclusion || "") !== "success");
        const successful = terminal.find(run => String(run.conclusion || "") === "success");
        const nextState = failed ? "DEPLOY_FAILED" : successful ? "DEPLOYED" : "DEPLOYING";
        const receipt = createRealityReceipt({
          id:createId(), action, status:parsed.ok ? "success" : "failure", repository:before.repository,
          observedAt:now(), source:"github",
          identity:{ baseBranch:before.baseBranch, baseSha:before.baseSha, workBranch:before.workBranch, headSha:deploymentSha, pullRequestNumber:before.pullRequest?.number || null },
          result:parsed.payload,
          evidence:{ runs:deployRuns },
        });
        if (!parsed.ok) return save({ revision:current.revision, task, receipt, action, before });
        const deployment = successful ? { status:"success", sha:deploymentSha, runId:successful.id, target:successful.name || "production", url:successful.url || null } : { status:failed ? "failure" : "running", sha:deploymentSha, runs:deployRuns };
        const next = task.transition(nextState, { headSha:before.headSha, deployment });
        return save({ revision:current.revision, task:next, receipt, action, before });
      }

      const recorders = {
        capture_baseline: ["recordProductionStep", input => ({ step: "BASELINE", evidence: input.evidence || input })],
        trace_system: ["recordProductionStep", input => ({ step: "TRACE", evidence: input.evidence || input })],
        plan_change: ["recordProductionStep", input => ({ step: "PLAN", evidence: input.evidence || input })],
        local_verify: ["recordProductionStep", input => ({ step: "LOCAL_VERIFY", evidence: input.evidence || input })],
        piece_qc: ["recordPieceQc", input => input],
        ready_gate: ["recordGateHandoff", input => input.readyGate || input],
        assemble: ["recordAssembly", input => input],
        assembly_qc: ["recordAssemblyQc", input => input],
        merge_gate: ["recordMergeGate", input => input],
        build: ["recordBuildArtifact", input => input],
        signing_gate: ["recordSigningGate", input => input],
        sign_apk: ["recordSignedArtifact", input => input],
        product_qc: ["recordProductQc", input => input],
        publish: ["recordPublication", input => input],
        observe: ["recordObservation", input => input],
        verify_chain: ["recordVerificationScan", input => input],
        closeout: ["recordCloseout", input => input],
        learn: ["recordLesson", input => input],
      };
      if (recorders[action]) {
        const [method, adapt] = recorders[action];
        const next = task[method](adapt(input));
        const receipt = createRealityReceipt({
          id: createId(), action, status: "success", repository: before.repository,
          observedAt: now(), source: "factory",
          identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: next.snapshot().headSha || before.headSha },
          result: { factoryStage: next.snapshot().factoryStage, nextAction: next.snapshot().nextAction },
          evidence: { governedStateTransition: true },
        });
        return save({ revision: current.revision, task: next, receipt, action, before });
      }

      if (action === "diagnose_failure") {
        const runId = Number(input.runId);
        const failedRun = (before.ci?.runs || []).find(run => Number(run.id) === runId && run.conclusion === "failure");
        if (!failedRun) throw new Error("IDENTITY_MISMATCH");
        const response = await lifecycle.getFailureEvidence({ repository: before.repository, runId });
        const parsed = await parseResponse(response);
        const receipt = createRealityReceipt({
          id: createId(), action, status: parsed.ok ? "success" : "failure", repository: before.repository,
          observedAt: now(), source: "github",
          identity: { baseBranch: before.baseBranch, baseSha: before.baseSha, workBranch: before.workBranch, headSha: before.headSha, pullRequestNumber: before.pullRequest?.number || null, runId },
          result: parsed.payload,
          evidence: parsed.ok ? { failedJobs: parsed.payload.failedJobs || [] } : { upstreamStatus: parsed.status },
        });
        if (!parsed.ok) return save({ revision: current.revision, task, receipt, action, before });
        if (Number(parsed.payload.runId) !== runId) throw new Error("IDENTITY_MISMATCH");
        return save({ revision: current.revision, task, receipt, action, before });
      }

      throw new Error(`unsupported Factory action: ${action}`);
    },
  });
}

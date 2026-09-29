import { createOAuthHandler, verifyAccessToken } from "./go-hub-oauth.mjs";
import { createMcpRegistry } from "./go-hub-mcp-registry.mjs";
import { createMcpHandler } from "./go-hub-mcp.mjs";
import { createNotionCatalogService } from "./go-hub-notion-catalog.mjs";
import { createCounterService } from "./go-hub-counter.mjs";
import { createCounterDispatchService } from "./go-hub-counter-dispatcher.mjs";
import { createProjectStatusReadService } from "./go-hub-project-status-service.mjs";
import { createBoardPinRouteReadService } from "./go-hub-board-pin-route.js";

const API_ROOT = "/hub/api/github-workspace";
const ALLOWED_OWNER = "pureekangraw-ops";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function badRequest(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function assertRepository(value) {
  const repository = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) badRequest("invalid repository");
  if (repository.split("/")[0] !== ALLOWED_OWNER) badRequest("repository owner is not allowed", 403);
  return repository;
}

function assertSafePath(value) {
  const filePath = String(value || "");
  if (!filePath || filePath.startsWith("/") || filePath.includes("\\") ||
      filePath.split("/").some(part => part === ".." || part === "." || part === "")) {
    badRequest("unsafe path");
  }
  return filePath;
}

function assertRef(value, label = "ref") {
  const ref = String(value || "").trim();
  if (!ref || ref.startsWith("/") || ref.endsWith("/") || ref.includes("\\") ||
      ref.includes("..") || ref.includes("//") || /[\s~^:?*[\]]/.test(ref)) {
    badRequest(`invalid ${label}`);
  }
  return ref;
}

function assertPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) badRequest(`invalid ${label}`);
  return number;
}

function encodePath(filePath) {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "go-hub-workspace-gateway",
  };
}

async function githubRequest(fetchImpl, token, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { ...githubHeaders(token), ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeUtf8Base64(value) {
  const binary = atob(String(value || "").replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
}

function upstreamError(response) {
  return json({ code: "GITHUB_UPSTREAM_ERROR", status: response.status }, 502);
}

function stripLogPrefix(line) {
  return String(line || "")
    .replace(/^\d{4}-\d{2}-\d{2}T\S+\s+/, "")
    .trim();
}

function failureLogExcerpt(text, limit = 40) {
  const signal = /(not ok\b|assertionerror|\berror\b|\bfailed\b|\bfailure\b|exception|^at\s+.+:\d+(?::\d+)?)/i;
  const seen = new Set();
  const lines = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = stripLogPrefix(raw);
    if (!line || !signal.test(line) || seen.has(line)) continue;
    seen.add(line);
    lines.push(line.slice(0, 800));
    if (lines.length > limit) lines.shift();
  }
  return lines;
}

async function listRepositories(fetchImpl, token) {
  const repositories = [];
  let page = 1;

  while (true) {
    const result = await githubRequest(
      fetchImpl,
      token,
      `https://api.github.com/user/repos?affiliation=owner&per_page=100&page=${page}&sort=updated`,
    );
    if (!result.response.ok) return upstreamError(result.response);

    const items = Array.isArray(result.payload) ? result.payload : [];
    repositories.push(...items
      .filter(item => item?.owner?.login === ALLOWED_OWNER)
      .map(item => ({
        name: String(item.name || ""),
        fullName: String(item.full_name || ""),
        visibility: String(item.visibility || (item.private ? "private" : "public")),
        defaultBranch: String(item.default_branch || ""),
        updatedAt: item.updated_at || null,
        archived: item.archived === true,
        url: item.html_url || null,
      })));

    if (items.length < 100) break;
    page += 1;
  }

  return json({ owner: ALLOWED_OWNER, count: repositories.length, repositories });
}

async function getRepository(fetchImpl, token, repository) {
  const result = await githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}`);
  if (!result.response.ok) return { error: upstreamError(result.response) };
  const defaultBranch = String(result.payload.default_branch || "");
  if (!defaultBranch) return { error: json({ code: "DEFAULT_BRANCH_MISSING" }, 502) };
  return { defaultBranch };
}

async function getBranch(fetchImpl, token, repository, branch) {
  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/branches/${encodeURIComponent(branch)}`,
  );
  if (result.response.status === 404) return { error: json({ code: "BRANCH_NOT_FOUND" }, 404) };
  if (!result.response.ok) return { error: upstreamError(result.response) };
  const sha = result.payload?.commit?.sha || null;
  if (!sha) return { error: json({ code: "BRANCH_SHA_MISSING" }, 502) };
  return { branch: result.payload?.name || branch, sha };
}

async function getTree(fetchImpl, token, repository, ref) {
  const branch = await getBranch(fetchImpl, token, repository, ref);
  if (branch.error) return branch;
  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/git/trees/${encodeURIComponent(branch.sha)}?recursive=1`,
  );
  if (!result.response.ok) return { error: upstreamError(result.response) };
  const tree = Array.isArray(result.payload.tree)
    ? result.payload.tree
        .filter(item => item && typeof item.path === "string" && typeof item.type === "string")
        .map(item => ({ path: item.path, type: item.type, sha: item.sha || null }))
    : [];
  return { branch: branch.branch, sha: branch.sha, tree };
}

async function inspectRepository(fetchImpl, token, repository, selectedBranch) {
  const repo = await getRepository(fetchImpl, token, repository);
  if (repo.error) return repo.error;
  const branch = selectedBranch || repo.defaultBranch;
  const base = await getBranch(fetchImpl, token, repository, repo.defaultBranch);
  if (base.error) return base.error;
  const tree = await getTree(fetchImpl, token, repository, branch);
  if (tree.error) return tree.error;
  return json({
    repository,
    defaultBranch: repo.defaultBranch,
    branch: tree.branch,
    baseSha: base.sha,
    headSha: tree.sha,
    tree: tree.tree,
  });
}

async function listTree(fetchImpl, token, repository, ref) {
  const tree = await getTree(fetchImpl, token, repository, ref);
  if (tree.error) return tree.error;
  return json({ ref: tree.branch, sha: tree.sha, tree: tree.tree });
}

async function listFiles(fetchImpl, token, repository) {
  const result = await githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/contents/`);
  if (!result.response.ok) return upstreamError(result.response);
  const files = Array.isArray(result.payload)
    ? result.payload.filter(item => item && item.type === "file").map(item => item.path)
    : [];
  return json({ files });
}

async function readFile(fetchImpl, token, repository, filePath, ref = null) {
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/contents/${encodePath(filePath)}${suffix}`,
  );
  if (result.response.status === 404) return json({ code: "FILE_NOT_FOUND" }, 404);
  if (!result.response.ok) return upstreamError(result.response);
  if (result.payload.type !== "file" || result.payload.encoding !== "base64") {
    return json({ code: "UNSUPPORTED_CONTENT" }, 422);
  }
  return json({ content: decodeUtf8Base64(result.payload.content), sha: result.payload.sha || null });
}

async function assertNonDefaultBranch(fetchImpl, token, repository, branch) {
  const repo = await getRepository(fetchImpl, token, repository);
  if (repo.error) return repo;
  if (branch === repo.defaultBranch) return { error: json({ code: "DEFAULT_BRANCH_WRITE_BLOCKED" }, 409) };
  return repo;
}

async function createBranch(fetchImpl, token, repository, name, fromSha) {
  const result = await githubRequest(
    fetchImpl, token, `https://api.github.com/repos/${repository}/git/refs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${name}`, sha: fromSha }),
    },
  );
  if (!result.response.ok) return upstreamError(result.response);
  return json({ branch: name, headSha: result.payload?.object?.sha || fromSha }, 201);
}

async function mutateFile(fetchImpl, token, repository, filePath, branch, expectedSha, content, method) {
  const policy = await assertNonDefaultBranch(fetchImpl, token, repository, branch);
  if (policy.error) return policy.error;

  const hasExpectedSha = expectedSha != null && String(expectedSha).trim() !== "";
  if (method === "DELETE" && !hasExpectedSha) badRequest("invalid sha");
  const safeExpectedSha = hasExpectedSha ? assertRef(expectedSha, "sha") : null;
  const action = method === "DELETE" ? "delete" : safeExpectedSha ? "update" : "create";
  const body = {
    message: `GO Hub: ${action} ${filePath}`,
    branch,
  };
  if (safeExpectedSha) body.sha = safeExpectedSha;
  if (method === "PUT") body.content = encodeUtf8Base64(content);

  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/contents/${encodePath(filePath)}`,
    {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!result.response.ok) {
    if (safeExpectedSha && (result.response.status === 409 || result.response.status === 422)) {
      return json({ code: "STALE_FILE_SHA" }, 409);
    }
    return upstreamError(result.response);
  }
  return json({
    ok: true,
    commit: result.payload?.commit?.sha || null,
    ...(method === "PUT" ? { sha: result.payload?.content?.sha || null } : {}),
  });
}

async function resolveCommitSha(fetchImpl, token, repository, ref) {
  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`,
  );
  if (!result.response.ok) return { error: upstreamError(result.response) };
  const sha = String(result.payload?.sha || "").trim();
  if (!sha) return { error: json({ code: "COMMIT_SHA_MISSING" }, 502) };
  return { sha };
}

async function compareRefs(fetchImpl, token, repository, base, head) {
  const [baseCommit, headCommit] = await Promise.all([
    resolveCommitSha(fetchImpl, token, repository, base),
    resolveCommitSha(fetchImpl, token, repository, head),
  ]);
  if (baseCommit.error) return baseCommit.error;
  if (headCommit.error) return headCommit.error;

  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/compare/${encodeURIComponent(baseCommit.sha)}...${encodeURIComponent(headCommit.sha)}`,
  );
  if (!result.response.ok) return upstreamError(result.response);
  return json({
    baseRef: base,
    headRef: head,
    baseSha: baseCommit.sha,
    headSha: headCommit.sha,
    status: result.payload.status || null,
    aheadBy: Number(result.payload.ahead_by || 0),
    behindBy: Number(result.payload.behind_by || 0),
    files: Array.isArray(result.payload.files)
      ? result.payload.files.map(file => ({
          path: file.filename,
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
        }))
      : [],
  });
}

function pullRequestPayload(payload) {
  return {
    number: payload.number,
    url: payload.html_url || null,
    state: payload.state || null,
    merged: payload.merged === true,
    mergeable: payload.mergeable ?? null,
    headBranch: payload.head?.ref || null,
    headSha: payload.head?.sha || null,
    baseBranch: payload.base?.ref || null,
    baseSha: payload.base?.sha || null,
  };
}

async function openPullRequest(fetchImpl, token, repository, branch, base, title, body) {
  const owner = repository.split("/")[0];
  const query = new URLSearchParams({ state: "open", head: `${owner}:${branch}`, base });
  const listed = await githubRequest(
    fetchImpl, token, `https://api.github.com/repos/${repository}/pulls?${query}`,
  );
  if (!listed.response.ok) return upstreamError(listed.response);
  const existing = Array.isArray(listed.payload) ? listed.payload[0] : null;
  const result = existing
    ? await githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/pulls/${existing.number}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, base }),
      })
    : await githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/pulls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, body, head: branch, base }),
      });
  if (!result.response.ok) return upstreamError(result.response);
  return json(pullRequestPayload(result.payload), existing ? 200 : 201);
}

async function getPullRequest(fetchImpl, token, repository, number) {
  const result = await githubRequest(
    fetchImpl, token, `https://api.github.com/repos/${repository}/pulls/${number}`,
  );
  if (result.response.status === 404) return json({ code: "PULL_REQUEST_NOT_FOUND" }, 404);
  if (!result.response.ok) return upstreamError(result.response);
  return json(pullRequestPayload(result.payload));
}

async function getCI(fetchImpl, token, repository, sha) {
  const [runsResult, checksResult] = await Promise.all([
    githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}`),
    githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(sha)}/check-runs`),
  ]);
  if (!runsResult.response.ok) return upstreamError(runsResult.response);
  if (!checksResult.response.ok) return upstreamError(checksResult.response);
  const runs = Array.isArray(runsResult.payload.workflow_runs)
    ? runsResult.payload.workflow_runs
        .filter(run => run.head_sha === sha)
        .map(run => ({
          id: run.id, name: run.name, status: run.status, conclusion: run.conclusion,
          headSha: run.head_sha, url: run.html_url || null,
        }))
    : [];
  const checks = Array.isArray(checksResult.payload.check_runs)
    ? checksResult.payload.check_runs
        .filter(check => check.head_sha === sha)
        .map(check => ({
          id: check.id, name: check.name, status: check.status, conclusion: check.conclusion,
          headSha: check.head_sha, url: check.html_url || null,
        }))
    : [];
  return json({ headSha: sha, runs, checks });
}

async function getFailureEvidence(fetchImpl, token, repository, runId) {
  const jobsResult = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
  );
  if (!jobsResult.response.ok) return upstreamError(jobsResult.response);

  const failedJobs = [];
  const jobs = Array.isArray(jobsResult.payload.jobs) ? jobsResult.payload.jobs : [];
  for (const job of jobs.filter(item => item?.conclusion && !["success", "skipped", "neutral"].includes(item.conclusion))) {
    const failedSteps = Array.isArray(job.steps)
      ? job.steps
          .filter(step => step?.conclusion && !["success", "skipped", "neutral"].includes(step.conclusion))
          .map(step => ({
            number: Number(step.number),
            name: String(step.name || ""),
            conclusion: String(step.conclusion || ""),
          }))
      : [];

    const logResponse = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/jobs/${job.id}/logs`,
      { headers: githubHeaders(token) },
    );
    const logExcerpt = logResponse.ok
      ? failureLogExcerpt(await logResponse.text())
      : [];

    failedJobs.push({
      id: job.id,
      name: String(job.name || ""),
      status: String(job.status || ""),
      conclusion: String(job.conclusion || ""),
      url: job.html_url || null,
      failedSteps,
      logExcerpt,
    });
  }

  return json({ runId, failedJobs });
}

async function rerunFailed(fetchImpl, token, repository, runId) {
  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/actions/runs/${runId}/rerun-failed-jobs`,
    { method: "POST" },
  );
  if (!result.response.ok) return upstreamError(result.response);
  return json({ ok: true, runId }, 202);
}

async function exactHeadCI(fetchImpl, token, repository, sha) {
  const [runsResult, checksResult] = await Promise.all([
    githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}`),
    githubRequest(fetchImpl, token, `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(sha)}/check-runs`),
  ]);
  if (!runsResult.response.ok) return { error: upstreamError(runsResult.response) };
  if (!checksResult.response.ok) return { error: upstreamError(checksResult.response) };
  const runs = Array.isArray(runsResult.payload.workflow_runs)
    ? runsResult.payload.workflow_runs.filter(run => run.head_sha === sha)
    : [];
  const checks = Array.isArray(checksResult.payload.check_runs)
    ? checksResult.payload.check_runs.filter(check => check.head_sha === sha)
    : [];
  return { runs, checks };
}

function ciTerminalAccepted(item, acceptedTerminalConclusions) {
  return item?.status === "completed" && acceptedTerminalConclusions.has(item?.conclusion);
}

function checkProviderKey(check) {
  const provider = String(check?.app?.slug || check?.app?.name || "unknown").trim().toLowerCase();
  const name = String(check?.name || "").trim();
  return `${provider}::${name}`;
}

function isGithubActionsCheck(check) {
  return String(check?.app?.slug || "").trim().toLowerCase() === "github-actions";
}

async function baselineAwareCIGreen(fetchImpl, token, repository, pullPayload, expectedHeadSha) {
  const acceptedTerminalConclusions = new Set(["success", "skipped", "neutral"]);
  const current = await exactHeadCI(fetchImpl, token, repository, expectedHeadSha);
  if (current.error) return { error: current.error };

  const currentSignals = [...current.runs, ...current.checks];
  if (currentSignals.length === 0) return { green:false };

  const strictGreen = currentSignals.every(item => ciTerminalAccepted(item, acceptedTerminalConclusions));
  if (strictGreen) return { green:true, baselineExternalExceptions:[] };

  const baseSha = String(pullPayload?.base?.sha || "").trim();
  const ownedRunsGreen = current.runs.length > 0 &&
    current.runs.every(item => ciTerminalAccepted(item, acceptedTerminalConclusions));
  const ownedChecksGreen = current.checks
    .filter(isGithubActionsCheck)
    .every(item => ciTerminalAccepted(item, acceptedTerminalConclusions));
  if (!baseSha || !ownedRunsGreen || !ownedChecksGreen) return { green:false };

  const baseline = await exactHeadCI(fetchImpl, token, repository, baseSha);
  if (baseline.error) return { error: baseline.error };

  const baselineFailures = new Set(
    baseline.checks
      .filter(check => !isGithubActionsCheck(check))
      .filter(check => check?.status === "completed" && !acceptedTerminalConclusions.has(check?.conclusion))
      .map(check => `${checkProviderKey(check)}::${String(check?.conclusion || "")}`)
  );

  const exceptions = [];
  for (const check of current.checks.filter(check => !isGithubActionsCheck(check))) {
    if (ciTerminalAccepted(check, acceptedTerminalConclusions)) continue;
    if (check?.status !== "completed") return { green:false };
    const key = `${checkProviderKey(check)}::${String(check?.conclusion || "")}`;
    if (!baselineFailures.has(key)) return { green:false };
    exceptions.push({
      provider:String(check?.app?.slug || check?.app?.name || "unknown"),
      name:String(check?.name || ""),
      conclusion:String(check?.conclusion || ""),
      baselineSha:baseSha,
    });
  }

  return { green:true, baselineExternalExceptions:exceptions };
}

async function mergePullRequest(fetchImpl, token, repository, number, expectedHeadSha, method) {
  const pull = await githubRequest(
    fetchImpl, token, `https://api.github.com/repos/${repository}/pulls/${number}`,
  );
  if (!pull.response.ok) return upstreamError(pull.response);
  const currentHeadSha = pull.payload?.head?.sha || null;
  if (currentHeadSha !== expectedHeadSha) {
    return json({ code: "STALE_PULL_REQUEST_HEAD" }, 409);
  }
  const ci = await baselineAwareCIGreen(fetchImpl, token, repository, pull.payload, expectedHeadSha);
  if (ci.error) return ci.error;
  if (!ci.green) return json({ code: "CURRENT_HEAD_CI_NOT_GREEN" }, 409);
  const result = await githubRequest(
    fetchImpl, token, `https://api.github.com/repos/${repository}/pulls/${number}/merge`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha: expectedHeadSha, merge_method: method }),
    },
  );
  if (!result.response.ok) return upstreamError(result.response);
  if (result.payload?.merged !== true || !result.payload?.sha) {
    return json({ code: "MERGE_REJECTED" }, 409);
  }
  return json({ merged: true, mergeSha: result.payload.sha, headSha: expectedHeadSha });
}

async function getWorkflowRuns(fetchImpl, token, repository, sha) {
  const result = await githubRequest(
    fetchImpl, token,
    `https://api.github.com/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}`,
  );
  if (!result.response.ok) return upstreamError(result.response);
  const runs = Array.isArray(result.payload.workflow_runs)
    ? result.payload.workflow_runs
        .filter(run => run.head_sha === sha)
        .map(run => ({
          id: run.id, name: run.name, status: run.status, conclusion: run.conclusion,
          headSha: run.head_sha, url: run.html_url || null,
        }))
    : [];
  return json({ headSha: sha, runs });
}

export function createGithubLifecycleService({ fetchImpl = fetch, token } = {}) {
  return Object.freeze({
    listRepositories() {
      return listRepositories(fetchImpl, token);
    },
    inspect(input = {}) {
      return inspectRepository(fetchImpl, token, assertRepository(input.repository), input.branch ? assertRef(input.branch, "branch") : null);
    },
    tree(input = {}) {
      return listTree(fetchImpl, token, assertRepository(input.repository), assertRef(input.ref));
    },
    readFile(input = {}) {
      return readFile(fetchImpl, token, assertRepository(input.repository), assertSafePath(input.path), input.ref ? assertRef(input.ref) : null);
    },
    createBranch(input = {}) {
      return createBranch(fetchImpl, token, assertRepository(input.repository), assertRef(input.name, "branch"), assertRef(input.fromSha, "sha"));
    },
    putFile(input = {}) {
      return mutateFile(fetchImpl, token, assertRepository(input.repository), assertSafePath(input.path), assertRef(input.branch, "branch"), input.expectedSha, input.content, "PUT");
    },
    deleteFile(input = {}) {
      return mutateFile(fetchImpl, token, assertRepository(input.repository), assertSafePath(input.path), assertRef(input.branch, "branch"), input.expectedSha, null, "DELETE");
    },
    compare(input = {}) {
      return compareRefs(fetchImpl, token, assertRepository(input.repository), assertRef(input.base, "base"), assertRef(input.head, "head"));
    },
    openPullRequest(input = {}) {
      return openPullRequest(fetchImpl, token, assertRepository(input.repository), assertRef(input.branch, "branch"), assertRef(input.base, "base"), String(input.title || "").trim() || badRequest("title is required"), String(input.body || ""));
    },
    getPullRequest(input = {}) {
      return getPullRequest(fetchImpl, token, assertRepository(input.repository), assertPositiveInteger(input.number, "pull request number"));
    },
    getCI(input = {}) {
      return getCI(fetchImpl, token, assertRepository(input.repository), assertRef(input.sha, "sha"));
    },
    getFailureEvidence(input = {}) {
      return getFailureEvidence(fetchImpl, token, assertRepository(input.repository), assertPositiveInteger(input.runId, "run id"));
    },
    rerunFailed(input = {}) {
      return rerunFailed(fetchImpl, token, assertRepository(input.repository), assertPositiveInteger(input.runId, "run id"));
    },
    mergePullRequest(input = {}) {
      const method = String(input.method || "squash");
      if (!["merge", "squash", "rebase"].includes(method)) badRequest("invalid merge method");
      return mergePullRequest(fetchImpl, token, assertRepository(input.repository), assertPositiveInteger(input.number, "pull request number"), assertRef(input.expectedHeadSha, "expected head sha"), method);
    },
    getWorkflowRuns(input = {}) {
      return getWorkflowRuns(fetchImpl, token, assertRepository(input.repository), assertRef(input.sha, "sha"));
    },
  });
}


async function parseResponse(response) {
  return response.json().catch(() => ({ code:"INVALID_INTERNAL_RESPONSE" }));
}
async function counterCreateWithDispatch(counter, dispatch, input) {
  const response = await counter.create(input);
  const payload = await parseResponse(response);
  if (!response.ok) return json(payload, response.status);
  const state = payload.counter || {};
  const dispatchResponse = await dispatch.open({
    counterId:state.counterId,
    workId:state.workId,
    checkpointId:state.checkpointId,
    request:state.request,
    context:state.context || {},
    sourceHints:state.sourceHints || [],
    doNotChange:state.doNotChange || [],
  });
  const dispatchPayload = await parseResponse(dispatchResponse);
  return json({
    ...payload,
    dispatch:dispatchPayload.dispatch || null,
    dispatchCode:dispatchResponse.ok ? null : (dispatchPayload.code || "DISPATCH_FAILED"),
  }, response.status);
}
async function counterGetWithDispatch(counter, dispatch, input) {
  const response = await counter.get(input);
  const payload = await parseResponse(response);
  if (!response.ok) return json(payload, response.status);
  const state = payload.counter || {};
  const dispatchResponse = await dispatch.get({
    counterId:state.counterId,
    workId:state.workId,
    checkpointId:state.checkpointId,
  });
  const dispatchPayload = await parseResponse(dispatchResponse);
  return json({
    ...payload,
    dispatch:dispatchPayload.dispatch || null,
    dispatchCode:dispatchResponse.ok ? null : (dispatchPayload.code || "DISPATCH_UNAVAILABLE"),
  }, response.status);
}
async function counterAnswerWithDispatch(counter, dispatch, input) {
  const response = await counter.answer(input);
  const payload = await parseResponse(response);
  if (!response.ok) return json(payload, response.status);
  const state = payload.counter || {};
  const dispatchResponse = await dispatch.answer({
    counterId:state.counterId,
    workId:state.workId,
    checkpointId:state.checkpointId,
    status:state.currentState,
    answer:state.answer,
    sources:state.sources || [],
    evidence:state.evidence || [],
    confidence:state.confidence,
    nextRoute:state.nextRoute,
  });
  const dispatchPayload = await parseResponse(dispatchResponse);
  return json({
    ...payload,
    dispatch:dispatchPayload.dispatch || null,
    dispatchCode:dispatchResponse.ok ? null : (dispatchPayload.code || "DISPATCH_FAILED"),
  }, response.status);
}

export function createWorkerHandler({ fetchImpl = fetch } = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const oauthPaths = new Set([
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp/light",
        "/oauth/authorize",
        "/oauth/token",
      ]);
      const oauthConfig = {
        issuer: url.origin,
        signingKey: env?.GOHUB_MASTER_KEY,
        ownerPasscode: env?.GOHUB_OWNER_PASSCODE,
        clients: [
          {
            clientId: "go-hub-go",
            clientSecret: env?.GOHUB_GO_CLIENT_SECRET,
            redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
            resources: [url.origin + "/mcp"],
            subject: "GO",
            scope: "go-hub",
          },
          {
            clientId: "go-hub-light",
            clientSecret: env?.GOHUB_LIGHT_CLIENT_SECRET,
            redirectUris: [env?.GOHUB_LIGHT_REDIRECT_URI || "https://app.notion.com/workflows/mcp/oauth/callback"],
            resources: [url.origin + "/mcp/light"],
            subject: "LIGHT",
            scope: "go-hub-light",
          },
          ...(env?.GOHUB_OWNER_PASSCODE && !env?.GOHUB_GO_CLIENT_SECRET ? [{
            clientId: "go-hub-chatgpt",
            clientSecret: env.GOHUB_OWNER_PASSCODE,
            redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
            resources: [url.origin + "/mcp"],
            subject: "big",
            scope: "go-hub",
          }] : []),
          ...(env?.GOHUB_NOTION_CLIENT_SECRET && !env?.GOHUB_LIGHT_CLIENT_SECRET ? [{
            clientId: "go-hub-notion",
            clientSecret: env.GOHUB_NOTION_CLIENT_SECRET,
            redirectUris: ["https://app.notion.com/workflows/mcp/oauth/callback"],
            resources: [url.origin + "/mcp/light"],
            subject: "notion",
            scope: "go-hub",
          }] : []),
        ],
      };
      if (oauthPaths.has(url.pathname)) {
        return createOAuthHandler(oauthConfig)(request);
      }
      if (url.pathname === "/mcp") {
        if (!env?.GITHUB_TOKEN) return json({ code: "GITHUB_NOT_CONFIGURED" }, 503);
        const lifecycle = createGithubLifecycleService({ fetchImpl, token: env.GITHUB_TOKEN });
        const counter = createCounterService({ namespace: env?.GO_HUB_COUNTER_STATE });
        const dispatch = createCounterDispatchService({ namespace: env?.GO_HUB_COUNTER_DISPATCH_STATE });
        const catalog = createNotionCatalogService({
          fetchImpl,
          token: env?.NOTION_TOKEN,
          dataSourceId: env?.NOTION_CATALOG_DATA_SOURCE_ID,
        });
        const projectStatus = createProjectStatusReadService({ lifecycle, factoryBinding:env?.GO_HUB_FACTORY_STATE });
        const boardPinRoute = createBoardPinRouteReadService();
        const registry = createMcpRegistry({
          lifecycle: Object.freeze({
            ...lifecycle,
            searchCatalog: input => catalog.searchCatalog(input),
            counterCreate: input => counterCreateWithDispatch(counter, dispatch, input),
            counterGet: input => counterGetWithDispatch(counter, dispatch, input),
            counterSeen: input => counter.seen(input),
            counterAnswer: input => counterAnswerWithDispatch(counter, dispatch, input),
            counterReadback: input => counter.readback(input),
            projectStatus: async input => json(await projectStatus.read(input)),
            boardPinRoute: input => json(boardPinRoute.read(input)),
          }),
        });
        return createMcpHandler({
          registry,
          issuer: url.origin,
          authenticate: current => verifyAccessToken(current, oauthConfig),
        })(request);
      }
      if (!url.pathname.startsWith(API_ROOT)) {
        if (env?.ASSETS && typeof env.ASSETS.fetch === "function") return env.ASSETS.fetch(request);
        return new Response("GO Hub", { status: 200 });
      }
      if (!env?.GITHUB_TOKEN) return json({ code: "GITHUB_NOT_CONFIGURED" }, 503);

      try {
        if (request.method === "GET" && url.pathname === `${API_ROOT}/inspect`) {
          const repository = assertRepository(url.searchParams.get("repository"));
          const value = url.searchParams.get("branch");
          return inspectRepository(fetchImpl, env.GITHUB_TOKEN, repository, value ? assertRef(value, "branch") : null);
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/tree`) {
          return listTree(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertRef(url.searchParams.get("ref")),
          );
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/files`) {
          return listFiles(fetchImpl, env.GITHUB_TOKEN, assertRepository(url.searchParams.get("repository")));
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/file`) {
          const value = url.searchParams.get("ref");
          return readFile(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertSafePath(url.searchParams.get("path")),
            value ? assertRef(value) : null,
          );
        }
        if (request.method === "POST" && url.pathname === `${API_ROOT}/branch`) {
          const body = await request.json().catch(() => null);
          if (!body) return json({ code: "INVALID_JSON" }, 400);
          return createBranch(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(body.repository),
            assertRef(body.name, "branch"),
            assertRef(body.fromSha, "sha"),
          );
        }
        if ((request.method === "PUT" || request.method === "DELETE") && url.pathname === `${API_ROOT}/file`) {
          const body = await request.json().catch(() => null);
          if (!body) return json({ code: "INVALID_JSON" }, 400);
          return mutateFile(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(body.repository),
            assertSafePath(body.path),
            assertRef(body.branch, "branch"),
            body.expectedSha,
            body.content,
            request.method,
          );
        }
        if (request.method === "POST" && url.pathname === `${API_ROOT}/pull-request`) {
          const body = await request.json().catch(() => null);
          if (!body) return json({ code: "INVALID_JSON" }, 400);
          return openPullRequest(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(body.repository),
            assertRef(body.branch, "branch"),
            assertRef(body.base, "base"),
            String(body.title || "").trim() || badRequest("title is required"),
            String(body.body || ""),
          );
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/pull-request`) {
          return getPullRequest(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertPositiveInteger(url.searchParams.get("number"), "pull request number"),
          );
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/ci`) {
          return getCI(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertRef(url.searchParams.get("sha"), "sha"),
          );
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/failure-evidence`) {
          return getFailureEvidence(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertPositiveInteger(url.searchParams.get("runId"), "run id"),
          );
        }
        if (request.method === "POST" && url.pathname === `${API_ROOT}/ci/rerun-failed`) {
          const body = await request.json().catch(() => null);
          if (!body) return json({ code: "INVALID_JSON" }, 400);
          return rerunFailed(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(body.repository),
            assertPositiveInteger(body.runId, "run id"),
          );
        }
        if (request.method === "POST" && url.pathname === `${API_ROOT}/pull-request/merge`) {
          const body = await request.json().catch(() => null);
          if (!body) return json({ code: "INVALID_JSON" }, 400);
          const method = String(body.method || "squash");
          if (!["merge", "squash", "rebase"].includes(method)) badRequest("invalid merge method");
          return mergePullRequest(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(body.repository),
            assertPositiveInteger(body.number, "pull request number"),
            assertRef(body.expectedHeadSha, "expected head sha"),
            method,
          );
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/workflow-runs`) {
          return getWorkflowRuns(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertRef(url.searchParams.get("sha"), "sha"),
          );
        }
        if (request.method === "GET" && url.pathname === `${API_ROOT}/compare`) {
          return compareRefs(
            fetchImpl, env.GITHUB_TOKEN,
            assertRepository(url.searchParams.get("repository")),
            assertRef(url.searchParams.get("base"), "base"),
            assertRef(url.searchParams.get("head"), "head"),
          );
        }
        return json({ code: "NOT_FOUND" }, 404);
      } catch (error) {
        return json({ code: error?.message || "BAD_REQUEST" }, error?.status || 400);
      }
    },
  };
}

export default createWorkerHandler();

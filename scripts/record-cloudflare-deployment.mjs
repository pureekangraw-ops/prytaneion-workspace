import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WORKER = "go-hub";

export function makeDeploymentReceipt({ before, after, repository, worker, sourceSha, workflowRunId }) {
  if (!/^[a-f0-9]{40}$/i.test(String(sourceSha || ""))) throw new Error("SOURCE_SHA_INVALID");
  if (!repository || !worker || !Number.isSafeInteger(Number(workflowRunId)) || Number(workflowRunId) <= 0) {
    throw new Error("DEPLOYMENT_CONTEXT_INVALID");
  }
  if (!Array.isArray(before) || !Array.isArray(after)) throw new Error("DEPLOYMENT_SNAPSHOT_INVALID");
  const prior = new Set(before.map(item => item?.id).filter(Boolean));
  if (prior.size && !after.some(item => prior.has(item?.id))) throw new Error("DEPLOYMENT_SNAPSHOT_WINDOW_LOST");
  const added = after.filter(item => item?.id && !prior.has(item.id));
  if (!added.length) throw new Error("DEPLOYMENT_ID_UNAVAILABLE");
  if (added.length !== 1) throw new Error("DEPLOYMENT_ID_AMBIGUOUS");
  const versions = (Array.isArray(added[0].versions) ? added[0].versions : [])
    .map(item => ({
      versionId: String(item?.version_id || item?.versionId || "").trim(),
      percentage: Number(item?.percentage),
    }))
    .filter(item => item.versionId && Number.isFinite(item.percentage));
  if (!versions.length) throw new Error("DEPLOYMENT_VERSION_UNAVAILABLE");
  return {
    repository, worker, sourceSha:sourceSha.toLowerCase(),
    workflowRunId:Number(workflowRunId), deploymentId:added[0].id, versions,
  };
}

export function parseDeploymentList(payload) {
  const result = payload?.result;
  const entries = Array.isArray(result) ? result : result?.deployments;
  if (payload?.success === false || !Array.isArray(entries)) throw new Error("DEPLOYMENT_LIST_UNAVAILABLE");
  if (payload?.result_info?.page > 1) throw new Error("DEPLOYMENT_LIST_NOT_FIRST_PAGE");
  return entries;
}

async function deployments() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const tokens = [process.env.CLOUDFLARE_RUNTIME_API_TOKEN, process.env.CLOUDFLARE_API_TOKEN].filter(Boolean);
  if (!account || !tokens.length) throw new Error("CLOUDFLARE_CREDENTIALS_UNAVAILABLE");
  let lastError = "DEPLOYMENT_LIST_UNAVAILABLE";
  for (const token of new Set(tokens)) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/workers/scripts/${WORKER}/deployments`,
      { headers:{ authorization:`Bearer ${token}`, accept:"application/json" } },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload?.errors?.[0]?.code;
      lastError = `DEPLOYMENT_LIST_HTTP_${response.status}${Number.isSafeInteger(code) ? "_CF_" + code : ""}`;
      if (response.status === 401 || response.status === 403) continue;
      throw new Error(lastError);
    }
    return parseDeploymentList(payload);
  }
  throw new Error(lastError);
}

async function main() {
  const [mode, file, receiptFile] = process.argv.slice(2);
  if (!file || !["snapshot", "record"].includes(mode)) throw new Error("USAGE: snapshot <before.json> | record <before.json> <receipt.json>");
  if (mode === "snapshot") {
    await writeFile(file, JSON.stringify(await deployments()));
    return;
  }
  if (!receiptFile) throw new Error("RECEIPT_PATH_REQUIRED");
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding:"utf8" }).trim();
  if (sha !== process.env.GITHUB_SHA) throw new Error("CHECKOUT_SHA_MISMATCH");
  if (process.env.GITHUB_REPOSITORY !== "pureekangraw-ops/standard-") throw new Error("REPOSITORY_MISMATCH");
  const before = JSON.parse(await readFile(file, "utf8"));
  const receipt = makeDeploymentReceipt({
    before, after:await deployments(),
    repository:process.env.GITHUB_REPOSITORY, worker:WORKER,
    sourceSha:sha, workflowRunId:process.env.GITHUB_RUN_ID,
  });
  await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { flag:"wx", mode:0o600 });
  console.log(`Deployment receipt recorded: ${receipt.deploymentId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`::error::${error?.message || "DEPLOYMENT_RECEIPT_FAILED"}`); process.exitCode = 1; });
}

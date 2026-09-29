import { extractZipEntry } from "./go-hub-workflow-artifact-service.mjs";

const DEFAULT_REPOSITORY = "pureekangraw-ops/prytaneion-workspace";
const WORKER = "go-hub";
const ARTIFACT_PREFIX = "go-hub-deployment-receipt-";
const UNKNOWN = reason => ({ status:"UNKNOWN", reason });

function normalizeRepository(value) {
  const repository = String(value || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("REPOSITORY_INVALID");
  return repository;
}

export function verifyDeploymentReceipt({ receipt, deployment, run, repository = DEFAULT_REPOSITORY } = {}) {
  const expectedRepository = normalizeRepository(repository);
  if (receipt?.repository !== expectedRepository || receipt?.worker !== WORKER ||
      !/^[a-f0-9]{40}$/.test(String(receipt?.sourceSha || "")) ||
      !Number.isSafeInteger(receipt?.workflowRunId) || receipt.workflowRunId <= 0 ||
      run?.id !== receipt.workflowRunId || run?.head_sha !== receipt.sourceSha ||
      run?.name !== "GO Hub Deploy") return UNKNOWN("RECEIPT_SOURCE_UNVERIFIED");
  if (!deployment?.id || deployment.id !== receipt.deploymentId) return UNKNOWN("DEPLOYMENT_ID_MISMATCH");
  const actual = deployment.versions, claimed = receipt.versions;
  if (!Array.isArray(actual) || !Array.isArray(claimed) || !actual.length || actual.length !== claimed.length) {
    return UNKNOWN("DEPLOYMENT_VERSIONS_UNVERIFIED");
  }
  const fingerprint = versions => versions.map(v => `${v.versionId}:${v.percentage}`).sort().join("|");
  if (actual.some(v => !v.versionId || !Number.isFinite(v.percentage)) ||
      claimed.some(v => !v.versionId || !Number.isFinite(v.percentage)) ||
      fingerprint(actual) !== fingerprint(claimed)) return UNKNOWN("DEPLOYMENT_VERSIONS_MISMATCH");
  return { status:"VERIFIED", sourceSha:receipt.sourceSha, workflowRunId:receipt.workflowRunId };
}

async function decodeReceiptZip(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 65536) throw new Error("RECEIPT_ARCHIVE_OVERSIZE");
  const { bytes:entry } = await extractZipEntry(bytes, "go-hub-deployment-receipt.json");
  if (entry.byteLength > 8192) throw new Error("RECEIPT_OVERSIZE");
  return new TextDecoder().decode(entry);
}

export function createDeploymentProvenanceReader({ fetchImpl = fetch, token, decodeArchive = decodeReceiptZip, repository = DEFAULT_REPOSITORY } = {}) {
  const fixedRepository = normalizeRepository(repository);
  const headers = {
    authorization:`Bearer ${token}`, accept:"application/vnd.github+json",
    "x-github-api-version":"2022-11-28", "user-agent":"go-hub-deployment-provenance",
  };
  const root = `https://api.github.com/repos/${fixedRepository}`;
  const github = async path => {
    const response = await fetchImpl(root + path, { headers });
    if (!response.ok) throw new Error("GITHUB_RECEIPT_READ_FAILED");
    return response.json();
  };
  return Object.freeze({
    async read({ deployment } = {}) {
      if (!token || !deployment?.id) return UNKNOWN("RECEIPT_READER_UNAVAILABLE");
      try {
        const listed = await github("/actions/artifacts?per_page=100");
        if (!Array.isArray(listed?.artifacts)) return UNKNOWN("RECEIPT_LIST_UNAVAILABLE");
        const candidates = listed.artifacts.filter(a =>
          a?.expired === false && a?.size_in_bytes > 0 && a.size_in_bytes <= 65536 &&
          /^go-hub-deployment-receipt-[1-9][0-9]*$/.test(a?.name || "") &&
          Number(a?.workflow_run?.id) === Number(a.name.slice(ARTIFACT_PREFIX.length)));
        // A bounded scan avoids treating missing or expired history as proof.
        for (const artifact of candidates.slice(0, 20)) {
          const runId = artifact.workflow_run.id;
          const response = await fetchImpl(root + `/actions/artifacts/${artifact.id}/zip`, { headers });
          if (!response.ok) continue;
          let receipt;
          try { receipt = JSON.parse(await decodeArchive(response)); }
          catch { continue; }
          if (receipt?.workflowRunId !== runId || receipt?.deploymentId !== deployment.id) continue;
          const run = await github(`/actions/runs/${runId}`);
          const verified = verifyDeploymentReceipt({ receipt, deployment, run, repository:fixedRepository });
          if (verified.status !== "VERIFIED") continue;
          return {
            ...verified,
            evidenceRef:`github://${fixedRepository}/actions/runs/${runId}/artifacts/${artifact.id}`,
          };
        }
        return UNKNOWN("MATCHING_DEPLOYMENT_RECEIPT_UNAVAILABLE");
      } catch {
        return UNKNOWN("RECEIPT_UPSTREAM_UNAVAILABLE");
      }
    },
  });
}

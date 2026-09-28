const GITHUB_API_ROOT = "https://api.github.com";
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function clean(value) { return String(value == null ? "" : value).trim(); }
function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function assertRepository(value) {
  const repository = clean(value);
  if (!/^pureekangraw-ops\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  return repository;
}
function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: "Bearer " + token,
    "x-github-api-version": "2022-11-28",
    "user-agent": "go-hub-artifact-delivery",
  };
}
function normalizeArtifact(item, runId) {
  const resolvedRunId = positiveInt(runId) || positiveInt(item?.workflow_run?.id);
  return {
    id: Number(item.id),
    runId: resolvedRunId,
    name: clean(item.name) || null,
    sizeInBytes: Number(item.size_in_bytes || 0),
    expired: item.expired === true,
    createdAt: item.created_at || null,
    updatedAt: item.updated_at || null,
    expiresAt: item.expires_at || null,
    digest: clean(item.digest) || null,
  };
}
async function githubJson(fetchImpl, token, url) {
  let response;
  try {
    response = await fetchImpl(url, { headers: githubHeaders(token) });
  } catch {
    return { response: json({ code: "GITHUB_UPSTREAM_ERROR", category: "NETWORK_ERROR" }, 502) };
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    return { response: json({ code: "GITHUB_UPSTREAM_ERROR", status: response.status }, 502) };
  }
  return { payload };
}
async function listRepositoryArtifacts(fetchImpl, token, repository) {
  const result = await githubJson(
    fetchImpl,
    token,
    GITHUB_API_ROOT + "/repos/" + repository + "/actions/artifacts?per_page=100",
  );
  if (result.response) return result;
  return {
    raw: Array.isArray(result.payload.artifacts) ? result.payload.artifacts : [],
  };
}
async function listRunArtifacts(fetchImpl, token, repository, runId) {
  const result = await githubJson(
    fetchImpl,
    token,
    GITHUB_API_ROOT + "/repos/" + repository + "/actions/runs/" + runId + "/artifacts?per_page=100",
  );
  if (result.response) return result;
  return {
    raw: Array.isArray(result.payload.artifacts) ? result.payload.artifacts : [],
  };
}
function u16(view, offset) { return view.getUint16(offset, true); }
function u32(view, offset) { return view.getUint32(offset, true); }
function findEocd(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= min; offset -= 1) {
    if (u32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") throw new Error("ZIP_DEFLATE_UNAVAILABLE");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function extractZipEntry(archiveBytes, suffix) {
  const wanted = clean(suffix).replace(/^\/+/, "");
  if (!wanted) throw new Error("ZIP_ENTRY_SUFFIX_REQUIRED");
  const view = new DataView(archiveBytes.buffer, archiveBytes.byteOffset, archiveBytes.byteLength);
  const eocd = findEocd(archiveBytes);
  if (eocd < 0) throw new Error("ZIP_EOCD_NOT_FOUND");
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);
  const matches = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > archiveBytes.byteLength || u32(view, offset) !== 0x02014b50) {
      throw new Error("ZIP_CENTRAL_DIRECTORY_INVALID");
    }
    const flags = u16(view, offset + 8);
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const uncompressedSize = u32(view, offset + 24);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const nameStart = offset + 46;
    const name = decoder.decode(archiveBytes.slice(nameStart, nameStart + nameLength)).replace(/\\/g, "/");
    if (name === wanted || name.endsWith("/" + wanted) || name.endsWith(wanted)) {
      matches.push({ name, flags, method, compressedSize, uncompressedSize, localOffset });
    }
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  if (matches.length === 0) throw new Error("ZIP_ENTRY_NOT_FOUND");
  if (matches.length > 1) throw new Error("ZIP_ENTRY_AMBIGUOUS");
  const match = matches[0];
  if ((match.flags & 1) !== 0) throw new Error("ZIP_ENCRYPTED_ENTRY_UNSUPPORTED");
  if (match.method !== 0 && match.method !== 8) throw new Error("ZIP_COMPRESSION_UNSUPPORTED");
  if (match.localOffset + 30 > archiveBytes.byteLength || u32(view, match.localOffset) !== 0x04034b50) {
    throw new Error("ZIP_LOCAL_HEADER_INVALID");
  }
  const localNameLength = u16(view, match.localOffset + 26);
  const localExtraLength = u16(view, match.localOffset + 28);
  const dataStart = match.localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + match.compressedSize;
  if (dataEnd > archiveBytes.byteLength) throw new Error("ZIP_ENTRY_TRUNCATED");
  const compressed = archiveBytes.slice(dataStart, dataEnd);
  const bytes = match.method === 0 ? compressed : await inflateRaw(compressed);
  if (match.uncompressedSize && bytes.byteLength !== match.uncompressedSize) {
    throw new Error("ZIP_ENTRY_SIZE_MISMATCH");
  }
  return { name: match.name, bytes };
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
function inferMime(name, fallback) {
  const explicit = clean(fallback);
  if (explicit) return explicit;
  const lower = clean(name).toLowerCase();
  if (lower.endsWith(".apk")) return "application/vnd.android.package-archive";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}
function basename(value) {
  const parts = clean(value).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) || "artifact.bin";
}

export function createWorkflowArtifactService({ fetchImpl = fetch, token, drive, maxArchiveBytes = MAX_ARCHIVE_BYTES } = {}) {
  const githubToken = clean(token);
  if (!drive || typeof drive.uploadFileBytes !== "function") throw new Error("Drive upload service is required");
  return Object.freeze({
    async listArtifacts(input = {}) {
      const repository = assertRepository(input.repository);
      const runId = positiveInt(input.runId);
      if (!githubToken) return json({ code: "GITHUB_NOT_CONFIGURED" }, 503);
      if (!repository) return json({ code: "ARTIFACT_INVALID_INPUT" }, 400);
      const result = runId
        ? await listRunArtifacts(fetchImpl, githubToken, repository, runId)
        : await listRepositoryArtifacts(fetchImpl, githubToken, repository);
      if (result.response) return result.response;
      return json({
        repository,
        runId: runId || null,
        scope: runId ? "RUN" : "REPOSITORY",
        artifacts: result.raw.map(item => normalizeArtifact(item, runId)),
      });
    },

    async archiveArtifact(input = {}) {
      const repository = assertRepository(input.repository);
      const runId = positiveInt(input.runId);
      const artifactId = positiveInt(input.artifactId);
      const archivePath = clean(input.archivePath);
      let parentId = clean(input.parentId);
      if (parentId && archivePath) return json({ code: "ARTIFACT_DESTINATION_AMBIGUOUS" }, 400);
      if (archivePath) {
        if (typeof drive.ensureFolderPath !== "function") {
          return json({ code: "DRIVE_PATH_RESOLUTION_UNAVAILABLE" }, 503);
        }
        const resolved = await drive.ensureFolderPath({ path: archivePath });
        const resolvedPayload = await resolved.json().catch(() => ({ code: "DRIVE_INVALID_RESPONSE" }));
        if (!resolved.ok) return json(resolvedPayload, resolved.status);
        parentId = clean(resolvedPayload?.item?.id);
      }
      if (!parentId) parentId = clean(typeof drive.defaultParentId === "function" ? drive.defaultParentId() : "");
      if (!githubToken) return json({ code: "GITHUB_NOT_CONFIGURED" }, 503);
      if (!repository || !runId || !artifactId || !parentId) {
        return json({ code: "ARTIFACT_INVALID_INPUT" }, 400);
      }
      const listed = await listRunArtifacts(fetchImpl, githubToken, repository, runId);
      if (listed.response) return listed.response;
      const artifact = listed.raw.find(item => Number(item.id) === artifactId);
      if (!artifact) return json({ code: "ARTIFACT_NOT_IN_RUN" }, 404);
      if (artifact.expired === true) return json({ code: "ARTIFACT_EXPIRED" }, 410);
      const expectedSize = Number(artifact.size_in_bytes || 0);
      if (expectedSize > maxArchiveBytes) return json({ code: "ARTIFACT_TOO_LARGE" }, 413);

      let download;
      try {
        download = await fetchImpl(artifact.archive_download_url, {
          headers: githubHeaders(githubToken),
          redirect: "follow",
        });
      } catch {
        return json({ code: "ARTIFACT_DOWNLOAD_FAILED", category: "NETWORK_ERROR" }, 502);
      }
      if (!download.ok) return json({ code: "ARTIFACT_DOWNLOAD_FAILED", status: download.status }, 502);
      const archiveBytes = new Uint8Array(await download.arrayBuffer());
      if (!archiveBytes.byteLength || archiveBytes.byteLength > maxArchiveBytes) {
        return json({ code: "ARTIFACT_SIZE_INVALID" }, 413);
      }

      let selectedName = clean(artifact.name) + ".zip";
      let selectedBytes = archiveBytes;
      if (clean(input.entrySuffix)) {
        let extracted;
        try {
          extracted = await extractZipEntry(archiveBytes, input.entrySuffix);
        } catch (error) {
          return json({ code: clean(error?.message) || "ARTIFACT_EXTRACT_FAILED" }, 409);
        }
        selectedName = basename(extracted.name);
        selectedBytes = extracted.bytes;
      }
      const destinationName = clean(input.destinationName) || selectedName;
      const fileSha256 = await sha256(selectedBytes);
      const appProperties = {
        goHubSource: "github-actions",
        sourceRepository: repository,
        workflowRunId: String(runId),
        artifactId: String(artifactId),
        artifactName: clean(artifact.name),
        artifactDigest: clean(artifact.digest) || "unavailable",
        sourceEntry: clean(input.entrySuffix) ? selectedName : "archive",
        sha256: fileSha256,
      };
      const stored = await drive.uploadFileBytes({
        parentId,
        name: destinationName,
        mimeType: inferMime(destinationName, input.mimeType),
        bytes: selectedBytes,
        appProperties,
        sha256: fileSha256,
      });
      const storedPayload = await stored.json().catch(() => ({ code: "DRIVE_INVALID_RESPONSE" }));
      if (!stored.ok) return json(storedPayload, stored.status);
      return json({
        repository,
        runId,
        artifact: normalizeArtifact(artifact, runId),
        selectedEntry: clean(input.entrySuffix) ? selectedName : null,
        fileSha256,
        destination: storedPayload.item || null,
        archivePath: archivePath || null,
        readback: storedPayload.readback || null,
      });
    },
  });
}

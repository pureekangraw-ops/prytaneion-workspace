// The original GO Hub GitHub Workspace client remains authoritative for UI API
// shape. This adapter supplies the READ methods for one public legacy repo only.
const OWNER = "pureekangraw-ops";
const REPO = OWNER + "/prytaneion-workspace";
export const LEGACY_REPO = REPO;
export const LEGACY_READABLE = Object.freeze([
  "go-hub.html",
  "go-hub-route-contract.js",
  "go-hub-authority-map.js",
  "go-hub-github-workspace.js",
  "go-hub-notion-light.mjs",
  "go-hub-notion-knowledge.mjs",
  "go-hub-cloudflare-service.mjs",
  "go-hub-google-drive-service.mjs",
  "go-hub-worker.mjs",
  "go-hub-mcp-registry.mjs",
  "wrangler.go-hub.jsonc"
]);

const encode = p => p.split("/").map(encodeURIComponent).join("/");
function output(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function allowed(url) { return url.searchParams.get("repository") === REPO; }
async function github(path, fetchImpl = fetch) {
  let r;
  try {
    r = await fetchImpl("https://api.github.com/repos/" + REPO + path, {
      method: "GET",
      headers: { accept: "application/vnd.github+json", "user-agent": "prytaneion-read-only-restoration", "x-github-api-version": "2022-11-28" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000)
    });
    if (r.status >= 300 && r.status < 400) throw Error("UPSTREAM_REDIRECT");
    if (!r.ok) throw Error(r.status === 403 ? "GITHUB_RATE_LIMIT_OR_FORBIDDEN" : "GITHUB_HTTP_" + r.status);
    if (Number(r.headers.get("content-length") || 0) > 180000) throw Error("GITHUB_RESPONSE_TOO_LARGE");
    const raw = await r.text();
    if (raw.length > 180000) throw Error("GITHUB_RESPONSE_TOO_LARGE");
    return JSON.parse(raw);
  } catch (e) {
    throw Error(typeof e?.message === "string" && /^(GITHUB_|UPSTREAM_)/.test(e.message) ? e.message : "GITHUB_UNAVAILABLE");
  }
}
export async function inspectLegacy(fetchImpl = fetch) {
  try {
    const r = await github("", fetchImpl);
    if (!r || r.full_name !== REPO || r.private === true) throw Error("REPOSITORY_ACCESS_DENIED");
    return {
      repository: REPO, branch: r.default_branch || "main", sha: null,
      name: r.name, url: r.html_url, updated_at: r.updated_at || null,
      public: true, source: "GITHUB_LIVE_READ", readOnly: true
    };
  } catch (error) {
    // Public /repos endpoint is often throttled on shared Cloudflare egress.
    // Verify the public repository by reading a real source blob instead.
    if (error?.message !== "GITHUB_RATE_LIMIT_OR_FORBIDDEN") throw error;
    const sample = await legacyText("go-hub-authority-map.js", fetchImpl);
    return {
      repository: REPO, branch:"main", sha:sample.sha,
      name:"prytaneion-workspace", url:"https://github.com/" + REPO,
      public:true, source:"GITHUB_VERIFIED_FILE_FALLBACK", readOnly:true
    };
  }
}
export async function legacyText(path, fetchImpl = fetch) {
  if (!LEGACY_READABLE.includes(path)) throw Error("SOURCE_NOT_ALLOWLISTED");
  const r = await github("/contents/" + encode(path) + "?ref=main", fetchImpl);
  if (!r || r.type !== "file" || r.encoding !== "base64" || typeof r.content !== "string") throw Error("INVALID_SOURCE_RESPONSE");
  if (r.content.length > 110000) throw Error("SOURCE_TOO_LARGE");
  const encoded = r.content.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw Error("INVALID_SOURCE_RESPONSE");
  let content;
  try {
    const binary = atob(encoded);
    content = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
  } catch { throw Error("INVALID_SOURCE_ENCODING"); }
  if (content.length > 75000) throw Error("SOURCE_TOO_LARGE");
  return { repository: REPO, path, content, sha: r.sha || null, ref: "main", readOnly: true };
}
export async function githubLegacyRoute(url, fetchImpl = fetch) {
  if (!allowed(url)) return output({ code: "REPOSITORY_NOT_ALLOWLISTED" }, 403);
  const path = url.pathname.slice("/hub/api/github-workspace/".length);
  try {
    if (path === "inspect") return output(await inspectLegacy(fetchImpl));
    if (path === "files") return output({ repository: REPO, files: LEGACY_READABLE.map(path => ({ path })), scope: "CURATED_READ_ONLY" });
    if (path === "file") return output(await legacyText(url.searchParams.get("path") || "", fetchImpl));
    return output({ code: "READ_ONLY_ROUTE_UNAVAILABLE" }, 404);
  } catch (e) {
    const code = /^(SOURCE_|REPOSITORY_|INVALID_)/.test(e.message) ? e.message : e.message.startsWith("GITHUB_") ? e.message : "UPSTREAM_UNAVAILABLE";
    const status = code === "SOURCE_NOT_ALLOWLISTED" ? 403 : code.startsWith("INVALID_") ? 502 : 503;
    return output({ code }, status);
  }
}

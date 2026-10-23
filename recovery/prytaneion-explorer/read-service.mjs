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

// Direct probes use only Hub-owned bearer credentials. Keep this separate from
// public source reads and binding probes: neither is an authorization fallback.
const DIRECT_PROVIDERS = Object.freeze({
  github: {
    credential: "GO_HUB_DIRECT_GITHUB_TOKEN",
    url: "https://api.github.com/user", operation: "AUTHENTICATED_USER_READ",
    headers: { accept: "application/vnd.github+json", "user-agent": "prytaneion-read-only-restoration", "x-github-api-version": "2022-11-28" },
    valid: r => Number.isInteger(r?.id) && r.id > 0 && typeof r.login === "string"
  },
  cloudflare: {
    credential: "GO_HUB_DIRECT_CLOUDFLARE_TOKEN",
    url: "https://api.cloudflare.com/client/v4/user/tokens/verify", operation: "USER_TOKEN_VERIFY",
    valid: r => r?.success === true && r?.result?.status === "active"
  },
  notion: {
    credential: "GO_HUB_DIRECT_NOTION_TOKEN",
    url: "https://api.notion.com/v1/users/me", operation: "BOT_USER_READ",
    headers: { "notion-version": "2026-03-11" },
    valid: r => r?.object === "user" && r?.type === "bot" && typeof r.id === "string"
  },
  google: {
    credential: "GO_HUB_DIRECT_GOOGLE_ACCESS_TOKEN",
    url: "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=kind", operation: "DRIVE_LIST_PROBE",
    valid: r => r?.kind === "drive#fileList"
  }
});

// Internal cooldowns contain numeric deadlines and sanitized summaries only.
// Isolate-local protection is not a substitute for a trusted activation path.
const directProviderState = new WeakMap();
const MIN_PROBE_INTERVAL_MS = 30000;
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
function retryAfterMs(value, now) {
  if (typeof value !== "string" || value.length > 128) return 60000;
  let delay;
  if (/^\d{1,10}$/.test(value)) delay = Number(value) * 1000;
  else if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) delay = Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(MIN_PROBE_INTERVAL_MS, Math.min(delay, MAX_RETRY_AFTER_MS)) : 60000;
}
// Parse bounded upstream JSON without ever retaining or returning provider data.
async function readBoundedJson(response, isTimedOut) {
  if (Number(response.headers.get("content-length")) > 16384) {
    void response.body?.cancel().catch(() => {});
    return { error: "RESPONSE_TOO_LARGE" };
  }
  if (!response.body) return { error: "INVALID_RESPONSE" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "";
  let bytes = 0;
  try {
    while (!isTimedOut()) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) return { error: "RESPONSE_TOO_LARGE" };
      raw += decoder.decode(value, { stream: true });
    }
    if (isTimedOut()) return { error: "TIMEOUT" };
    raw += decoder.decode();
    try { return { data: JSON.parse(raw) }; }
    catch { return { error: "INVALID_RESPONSE" }; }
  } catch {
    return { error: isTimedOut() ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE" };
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export async function probeDirectProvider(env = {}, provider, fetchImpl = fetch) {
  if (!Object.hasOwn(DIRECT_PROVIDERS, provider)) return performDirectProbe(env, provider, fetchImpl);
  let states = directProviderState.get(env);
  if (!states) { states = new Map(); directProviderState.set(env, states); }
  const prior = states.get(provider);
  if (prior?.pending) return prior.pending;
  if (prior && Date.now() < prior.until) return prior.data;
  const entry = { until: Date.now() + MIN_PROBE_INTERVAL_MS };
  states.set(provider, entry);
  entry.pending = performDirectProbe(env, provider, fetchImpl, delay => {
    entry.until = Math.max(entry.until, Date.now() + delay);
  }).then(data => {
    const observedAt = Date.now();
    entry.data = { ...data, observedAt, expiresAt: observedAt + 15 * 60 * 1000 };
    return entry.data;
  });
  try { return await entry.pending; }
  finally { entry.pending = null; }
}

async function performDirectProbe(env, provider, fetchImpl, defer = () => {}) {
  const config = Object.hasOwn(DIRECT_PROVIDERS, provider) ? DIRECT_PROVIDERS[provider] : null;
  const summary = status => ({ status, connected: status === "CONNECTED",
    via: "DIRECT", credentialSource: "GO_HUB_ONLY", readOnly: true,
    ...(config ? { operation: config.operation } : {}) });
  if (!config) return summary("UNSUPPORTED_CAPABILITY");
  // Prefer the long-lived refresh-token trio on Google. An access-token slot
  // is optional for compatibility and is not required in Cloudflare.
  const refreshKeys = ["GO_HUB_DIRECT_GOOGLE_CLIENT_ID", "GO_HUB_DIRECT_GOOGLE_CLIENT_SECRET", "GO_HUB_DIRECT_GOOGLE_REFRESH_TOKEN"];
  const refreshValues = provider === "google" ? refreshKeys.map(key => env?.[key]) : [];
  const refreshEnabled = refreshValues.length === 3 && refreshValues.every(v => typeof v === "string" && v.trim());
  let token = env?.[config.credential];
  if (!refreshEnabled && (typeof token !== "string" || !token.trim())) return summary("NOT_CONFIGURED");
  // Reject malformed header/body values locally without echoing them.
  const validCredential = value => typeof value === "string" && /^[\x21-\x7e]{1,8192}$/.test(value);
  if (refreshEnabled ? !refreshValues.every(validCredential) : !validCredential(token))
    return summary("INVALID_CREDENTIAL_FORMAT");
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve(summary("TIMEOUT"));
    }, 8000);
  });
  const read = async () => {
    try {
      if (refreshEnabled) {
        // Fixed OAuth token exchange: no caller-supplied URL, scope or operation.
        // This acquires a short-lived bearer for a single read-only Drive GET.
        const oauth = await fetchImpl("https://oauth2.googleapis.com/token", {
          method: "POST", redirect: "manual", signal: controller.signal,
          headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: refreshValues[0], client_secret: refreshValues[1],
            refresh_token: refreshValues[2], grant_type: "refresh_token"
          }).toString()
        });
        if (timedOut) { void oauth.body?.cancel().catch(() => {}); return summary("TIMEOUT"); }
        if (oauth.status === 429) defer(retryAfterMs(oauth.headers.get("retry-after"), Date.now()));
        if (oauth.status !== 200) {
          void oauth.body?.cancel().catch(() => {});
          const status = { 400: "UNAUTHORIZED", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 429: "RATE_LIMITED" }[oauth.status];
          return summary(status || (oauth.status >= 300 && oauth.status < 400 ? "REDIRECT_BLOCKED" : "UPSTREAM_UNAVAILABLE"));
        }
        const result = await readBoundedJson(oauth, () => timedOut);
        if (result.error) return summary(result.error);
        token = result.data?.access_token;
        if (!validCredential(token)) return summary("PROVIDER_UNVERIFIED");
      }
      const response = await fetchImpl(config.url, {
        method: "GET", redirect: "manual", signal: controller.signal,
        headers: { accept: "application/json", ...config.headers, authorization: "Bearer " + token }
      });
      if (timedOut) { void response.body?.cancel().catch(() => {}); return summary("TIMEOUT"); }
      if (response.status === 429) defer(retryAfterMs(response.headers.get("retry-after"), Date.now()));
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        const status = { 401: "UNAUTHORIZED", 403: "FORBIDDEN", 429: "RATE_LIMITED" }[response.status];
        return summary(status || (response.status >= 300 && response.status < 400 ? "REDIRECT_BLOCKED" : "UPSTREAM_UNAVAILABLE"));
      }
      const parsed = await readBoundedJson(response, () => timedOut);
      if (parsed.error) return summary(parsed.error);
      return summary(config.valid(parsed.data) ? "CONNECTED" : "PROVIDER_UNVERIFIED");
    } catch {
      return summary(timedOut ? "TIMEOUT" : "UPSTREAM_UNAVAILABLE");
    }
  };
  try { return await Promise.race([read(), deadline]); }
  finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function inspectDirectProviders(env, fetchImpl = fetch) {
  const entries = await Promise.all(Object.keys(DIRECT_PROVIDERS).map(async provider =>
    [provider, await probeDirectProvider(env, provider, fetchImpl)]));
  return { connections: Object.fromEntries(entries), evidence: "DIRECT_PROVIDER_READ",
    privateDataReturned: false, readOnly: true };
}

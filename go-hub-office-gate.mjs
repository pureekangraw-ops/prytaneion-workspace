const encoder = new TextEncoder();

const OFFICE_COOKIE = "__Host-ygg-office";
const OFFICE_ROOT = "/office";
const OFFICE_LOGIN = "/office/login";
const OFFICE_LOGOUT = "/office/logout";
const OFFICE_SESSION = "/office/session";
const OFFICE_AUTH_WORK_ID = "WORK-GO-HUB-OFFICE-AUTH";
const OFFICE_AUTH_CHECKPOINT_ID = "CP-GO-HUB-OFFICE-AUTH";
const OFFICE_ASSET_ROOT = "/office/api/assets";
const OFFICE_ASSET_PREFIX = "office/";
const OFFICE_ASSET_MAX_BYTES = 10 * 1024 * 1024;
const OFFICE_ASSET_TYPES = new Set(["image/png","image/jpeg","image/webp"]);

const OFFICE_ALLOWED = new Map([
  ["/office", new Set(["GET"])],
  ["/office/", new Set(["GET"])],
  [OFFICE_LOGIN, new Set(["GET","POST"])],
  [OFFICE_LOGOUT, new Set(["POST"])],
  [OFFICE_SESSION, new Set(["GET"])],
  ["/office/api/work", new Set(["GET"])],
  ["/office/api/command", new Set(["POST"])],
  ["/office/api/eye", new Set(["GET"])],
  [OFFICE_ASSET_ROOT, new Set(["GET","POST"])],
  ["/office/passkey/status", new Set(["GET"])],
  ["/office/passkey/register/options", new Set(["POST"])],
  ["/office/passkey/register/verify", new Set(["POST"])],
  ["/office/passkey/auth/options", new Set(["POST"])],
  ["/office/passkey/auth/verify", new Set(["POST"])],
]);

function baseHeaders(extra = {}) {
  return {
    "cache-control":"no-store, max-age=0",
    "pragma":"no-cache",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer",
    "content-security-policy":"default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...extra,
  };
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:baseHeaders({ "content-type":"application/json; charset=utf-8", ...headers }),
  });
}

function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers:baseHeaders({ "content-type":"text/html; charset=utf-8", ...headers }),
  });
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function hmac(keyText, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(keyText)),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function verifyHmac(keyText, value, signature) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(String(keyText)),
    { name:"HMAC", hash:"SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, base64UrlToBytes(signature), encoder.encode(value));
}

function parseCookies(request) {
  const out = {};
  for (const part of String(request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function sessionCookie(value, maxAge) {
  return `${OFFICE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function sameOrigin(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = String(request.headers.get("origin") || "").trim();
  if (origin && origin.toLowerCase() !== "null") {
    try {
      return new URL(origin).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  // Some mobile browsers either omit Origin or send the opaque value
  // "null" on a same-origin HTML form POST. In those cases, require
  // browser fetch metadata that still proves same-origin.
  const fetchSite = String(request.headers.get("sec-fetch-site") || "").trim().toLowerCase();
  if (fetchSite === "same-origin") return true;
  if (fetchSite && fetchSite !== "none") return false;

  const referer = String(request.headers.get("referer") || "").trim();
  if (!referer) return false;
  try {
    return new URL(referer).origin === requestOrigin;
  } catch {
    return false;
  }
}

function originDiagnostics(request) {
  const requestOrigin = new URL(request.url).origin;
  const origin = String(request.headers.get("origin") || "").trim();
  let originClass = "ABSENT";
  if (origin) {
    if (origin.toLowerCase() === "null") {
      originClass = "NULL";
    } else {
      try {
        originClass = new URL(origin).origin === requestOrigin ? "SAME" : "OTHER";
      } catch {
        originClass = "INVALID";
      }
    }
  }

  const fetchSiteRaw = String(request.headers.get("sec-fetch-site") || "").trim().toLowerCase();
  const fetchSite = ["same-origin", "same-site", "cross-site", "none"].includes(fetchSiteRaw)
    ? fetchSiteRaw
    : (fetchSiteRaw ? "other" : "absent");

  const referer = String(request.headers.get("referer") || "").trim();
  let refererClass = "ABSENT";
  if (referer) {
    try {
      refererClass = new URL(referer).origin === requestOrigin ? "SAME" : "OTHER";
    } catch {
      refererClass = "INVALID";
    }
  }

  return { originClass, fetchSite, refererClass };
}

function sessionConfigured(env) {
  return Boolean(String(env?.GOHUB_OFFICE_SESSION_KEY || "").trim());
}

function passcodeConfigured(env) {
  return Boolean(
    String(env?.GOHUB_OFFICE_PASSCODE || "").trim() &&
    sessionConfigured(env)
  );
}

function epoch(env) {
  return String(env?.GOHUB_OFFICE_SESSION_EPOCH || "1");
}

function requestRateKey(request) {
  return String(request.headers.get("cf-connecting-ip") || "unknown").trim() || "unknown";
}

function safeAssetName(value) {
  const cleaned = String(value || "asset").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 120) || "asset";
}

function assetKeyAllowed(key) {
  const value = String(key || "");
  return value.startsWith(OFFICE_ASSET_PREFIX) && !value.includes("..") && !value.includes("\\");
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function officeAssetSummary(object) {
  return {
    key:String(object?.key || ""),
    size:Number(object?.size || 0),
    etag:String(object?.etag || ""),
    uploaded:object?.uploaded ? new Date(object.uploaded).toISOString() : null,
    httpMetadata:object?.httpMetadata || null,
    customMetadata:object?.customMetadata || null,
  };
}

async function recordAudit(audit, type, details = {}) {
  if (!audit) return;
  const event = {
    eventId: `EV-OFFICE-${crypto.randomUUID()}`,
    type,
    workId: OFFICE_AUTH_WORK_ID,
    checkpointId: OFFICE_AUTH_CHECKPOINT_ID,
    phase: "OFFICE_AUTH",
    targetId: "GO_HUB_OFFICE",
    details: { source: "office-login", ...details },
  };
  try {
    if (typeof audit === "function") await audit(event);
    else if (typeof audit.append === "function") await audit.append(event);
  } catch {
    // Authentication must not expose audit backend details to the caller.
  }
}

function ttlSeconds(env) {
  const raw = Number(env?.GOHUB_OFFICE_SESSION_TTL_SECONDS || 8 * 60 * 60);
  if (!Number.isFinite(raw)) return 8 * 60 * 60;
  return Math.min(Math.max(Math.floor(raw), 300), 24 * 60 * 60);
}

async function mintSession(env, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds(env);
  const claims = {
    sub:"BIG",
    iat,
    exp,
    epoch:epoch(env),
    nonce:crypto.randomUUID(),
  };
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = bytesToBase64Url(await hmac(env.GOHUB_OFFICE_SESSION_KEY, payload));
  return { token:`${payload}.${signature}`, claims };
}

async function verifySession(request, env, nowMs = Date.now()) {
  if (!sessionConfigured(env)) return { ok:false, code:"OFFICE_AUTH_NOT_CONFIGURED", status:503 };
  const token = parseCookies(request)[OFFICE_COOKIE];
  if (!token) return { ok:false, code:"OFFICE_AUTH_REQUIRED", status:401 };
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra) return { ok:false, code:"OFFICE_SESSION_INVALID", status:401 };
  let valid = false;
  try {
    valid = await verifyHmac(env.GOHUB_OFFICE_SESSION_KEY, payload, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok:false, code:"OFFICE_SESSION_INVALID", status:401 };
  let claims = null;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  } catch {
    return { ok:false, code:"OFFICE_SESSION_INVALID", status:401 };
  }
  const now = Math.floor(nowMs / 1000);
  if (claims?.sub !== "BIG" || claims?.epoch !== epoch(env)) {
    return { ok:false, code:"OFFICE_SESSION_REVOKED", status:401 };
  }
  if (!Number.isSafeInteger(claims?.exp) || claims.exp <= now) {
    return { ok:false, code:"OFFICE_SESSION_EXPIRED", status:401 };
  }
  return { ok:true, claims };
}

function loginPage(errorCode = "") {
  const error = errorCode ? `<p class="office-alert" role="alert">Authentication failed.</p>` : "";
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1118"><title>YGG METRO Office</title><link rel="stylesheet" href="/go-hub-office-surface.css"></head><body class="office-body"><main class="office-login"><section class="office-login-card"><p class="office-kicker">YGG METRO</p><h1>OFFICE</h1><p class="office-muted">Owner workspace · secure entry</p>${error}<button type="button" data-passkey-login hidden>Use Passkey</button><p class="office-muted" data-passkey-login-status></p><details><summary>Use bootstrap passcode</summary><form method="post" action="/office/login"><label>Passcode<input name="passcode" type="password" autocomplete="current-password" required></label><button type="submit">Enter Office</button></form></details></section></main><script type="module" src="/go-hub-office-login.js"></script></body></html>`;
}

function officeShell() {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1118"><title>YGG METRO Office</title><link rel="stylesheet" href="/go-hub-office-surface.css"></head><body class="office-body"><main class="office-shell"><header class="office-top"><div><p class="office-kicker">YGG METRO</p><h1>OFFICE</h1><p class="office-muted">Build · Plan · Create · Together</p></div><form method="post" action="/office/logout"><button class="office-quiet" type="submit">Logout</button></form></header><section class="office-hero"><div class="office-hero-copy"><p class="office-kicker">CURRENT DESK</p><h2>Good work.<br>Brighter tomorrow.</h2><p>พื้นที่ทำงานของ GO และบิ๊ก — หน้าบ้านเรียบ แต่ต่อกับ Work truth และ Eye ด้านหลัง</p></div><div class="office-eye" data-office-eye><span class="office-dot"></span><div><strong data-eye-state>CHECKING</strong><small data-eye-detail>Factory Eye · read only</small></div></div></section><section class="office-grid office-status-grid"><article><span>ACTIVE</span><h3 data-work-active>0</h3><p>งานที่กำลังทำ</p></article><article><span>WAITING</span><h3 data-work-waiting>0</h3><p>งานที่รอ / รอตรวจ</p></article><article><span>DONE</span><h3 data-work-done>0</h3><p>งานที่เสร็จแล้ว</p></article><article><span>EYE</span><h3 data-work-eye>—</h3><p>หลักฐานหน้าจอล่าสุด</p></article></section><section class="office-panel office-workspace" data-work-tracker><div class="office-workspace-head"><div><p class="office-kicker">WORK TRUTH</p><h3>ติดตามงานจริงจาก Centre</h3><p class="office-muted">ปัก Work ID + Checkpoint ID แล้ว Office จะอ่านสถานะจริงจาก owner truth โดยไม่สร้าง authority ใหม่</p></div><button type="button" data-work-refresh>Refresh</button></div><form class="office-work-form" data-work-form><input name="workId" autocomplete="off" placeholder="WORK-..." required><input name="checkpointId" autocomplete="off" placeholder="CP-..." required><button type="submit">Track work</button></form><p class="office-muted" data-work-message>ยังไม่ได้ปักงาน</p><div class="office-work-list" data-work-list></div></section><section class="office-panel office-assets" data-office-assets><div><p class="office-kicker">ASSETS</p><h3>Office files</h3><p class="office-muted">เก็บภาพและไฟล์ใช้งานใน R2 · private ผ่าน Office session</p><form data-asset-upload><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required><select name="category"><option value="uploads">Uploads</option><option value="visuals">Visuals</option><option value="projects">Projects</option><option value="references">References</option></select><button type="submit">Upload</button></form><p class="office-muted" data-asset-status>พร้อมรับไฟล์</p><ul class="office-asset-list" data-asset-list></ul></div></section><section class="office-panel"><div><p class="office-kicker">SECURITY</p><h3>Passkey</h3><p class="office-muted" data-passkey-status>ตรวจสถานะ Passkey…</p></div><button type="button" data-passkey-register>Create Passkey</button></section><section class="office-panel"><div><p class="office-kicker">OBSERVER</p><h3>GO can see the current screen</h3><p class="office-muted" data-eye-message>กำลังอ่านสถานะ Factory Eye…</p></div><button type="button" data-eye-refresh>Refresh Eye</button></section></main><script type="module" src="/go-hub-office-surface.js"></script></body></html>`;
}

export function createOfficeGate({ centreLive = null, agentMission = null, agentMissionActions = [], factoryEye = null, passkey = null, rateLimiter = null, audit = null } = {}) {
  return Object.freeze({
    owns(pathname) {
      return pathname === OFFICE_ROOT || pathname.startsWith(OFFICE_ROOT + "/");
    },

    async fetch(request, env) {
      const url = new URL(request.url);
      const methods = OFFICE_ALLOWED.get(url.pathname);
      if (!methods || !methods.has(request.method)) {
        return json({ code:"OFFICE_ROUTE_DENIED" }, 404);
      }

      if (url.pathname === "/office/passkey/status") {
        if (!passkey || typeof passkey.status !== "function") return json({ code:"OFFICE_PASSKEY_UNAVAILABLE" }, 503);
        return passkey.status(url.origin);
      }

      if (url.pathname === "/office/passkey/auth/options") {
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        if (!passkey || typeof passkey.authOptions !== "function") return json({ code:"OFFICE_PASSKEY_UNAVAILABLE" }, 503);
        return passkey.authOptions(url.origin);
      }

      if (url.pathname === "/office/passkey/auth/verify") {
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        if (!passkey || typeof passkey.verifyAuthentication !== "function") return json({ code:"OFFICE_PASSKEY_UNAVAILABLE" }, 503);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);
        const verified = await passkey.verifyAuthentication(url.origin, body);
        const payload = await verified.clone().json().catch(() => ({}));
        if (!verified.ok || payload?.ok !== true) return json({ code:String(payload?.code || "OFFICE_PASSKEY_AUTH_FAILED") }, verified.status || 403);
        if (!String(env?.GOHUB_OFFICE_SESSION_KEY || "").trim()) return json({ code:"OFFICE_AUTH_NOT_CONFIGURED" }, 503);
        if (rateLimiter?.clear) await rateLimiter.clear(requestRateKey(request));
        await recordAudit(audit, "OFFICE_LOGIN_SUCCESS", { subject:"BIG", method:"PASSKEY" });
        const session = await mintSession(env);
        return json({ ok:true, redirect:"/office" }, 200, { "set-cookie":sessionCookie(session.token, ttlSeconds(env)) });
      }

      if (url.pathname === OFFICE_LOGIN) {
        if (request.method === "GET") {
          return html(loginPage());
        }
        if (!passcodeConfigured(env)) {
          await recordAudit(audit, "OFFICE_LOGIN_DENIED", { reason: "NOT_CONFIGURED" });
          return json({ code:"OFFICE_AUTH_NOT_CONFIGURED" }, 503);
        }
        if (!sameOrigin(request)) {
          await recordAudit(audit, "OFFICE_LOGIN_DENIED", { reason: "ORIGIN", ...originDiagnostics(request) });
          return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        }
        const rateKey = requestRateKey(request);
        if (rateLimiter?.check) {
          const checked = await rateLimiter.check(rateKey);
          if (checked?.unavailable) return json({ code:checked.code || "OFFICE_RATE_LIMIT_UNAVAILABLE" }, 503);
          if (checked?.limited === true) {
            await recordAudit(audit, "OFFICE_LOGIN_RATE_LIMITED", { reason: "BLOCKED" });
            return json({ code:"OFFICE_AUTH_RATE_LIMITED" }, 429, { "retry-after":String(checked.retryAfterSeconds || 1) });
          }
        }
        const failed = async reason => {
          const recorded = rateLimiter?.recordFailure ? await rateLimiter.recordFailure(rateKey) : { limited:false };
          if (recorded?.unavailable) return json({ code:recorded.code || "OFFICE_RATE_LIMIT_UNAVAILABLE" }, 503);
          await recordAudit(audit, recorded?.limited ? "OFFICE_LOGIN_RATE_LIMITED" : "OFFICE_LOGIN_FAILED", { reason });
          if (recorded?.limited) {
            return json({ code:"OFFICE_AUTH_RATE_LIMITED" }, 429, { "retry-after":String(recorded.retryAfterSeconds || 1) });
          }
          return html(loginPage("OFFICE_AUTH_FAILED"), 403);
        };
        const form = await request.formData().catch(() => null);
        const supplied = String(form?.get("passcode") || "");
        const expected = String(env.GOHUB_OFFICE_PASSCODE || "");
        if (!supplied || supplied.length !== expected.length) return failed("BAD_PASSCODE");
        let diff = 0;
        for (let i = 0; i < expected.length; i += 1) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
        if (diff !== 0) return failed("BAD_PASSCODE");
        if (rateLimiter?.clear) await rateLimiter.clear(rateKey);
        await recordAudit(audit, "OFFICE_LOGIN_SUCCESS", { subject: "BIG" });
        const session = await mintSession(env);
        return new Response(null, {
          status:303,
          headers:baseHeaders({
            location:"/office",
            "set-cookie":sessionCookie(session.token, ttlSeconds(env)),
          }),
        });
      }

      const auth = await verifySession(request, env);
      if (!auth.ok) return json({ code:auth.code }, auth.status);

      if (url.pathname === "/office/passkey/register/options") {
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        if (!passkey || typeof passkey.registerOptions !== "function") return json({ code:"OFFICE_PASSKEY_UNAVAILABLE" }, 503);
        return passkey.registerOptions(url.origin);
      }

      if (url.pathname === "/office/passkey/register/verify") {
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        if (!passkey || typeof passkey.verifyRegistration !== "function") return json({ code:"OFFICE_PASSKEY_UNAVAILABLE" }, 503);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);
        const verified = await passkey.verifyRegistration(url.origin, body);
        const payload = await verified.clone().json().catch(() => ({}));
        if (!verified.ok || payload?.ok !== true) return json({ code:String(payload?.code || "OFFICE_PASSKEY_REGISTER_FAILED") }, verified.status || 400);
        await recordAudit(audit, "OFFICE_PASSKEY_REGISTERED", { subject:"BIG" });
        return json({ ok:true, registered:true });
      }

      if (url.pathname === OFFICE_LOGOUT) {
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        await recordAudit(audit, "OFFICE_LOGOUT", { subject:auth.claims.sub });
        return new Response(null, {
          status:303,
          headers:baseHeaders({
            location:"/office/login",
            "set-cookie":sessionCookie("", 0),
          }),
        });
      }

      if (url.pathname === OFFICE_SESSION) {
        return json({
          ok:true,
          subject:auth.claims.sub,
          expiresAt:new Date(auth.claims.exp * 1000).toISOString(),
        });
      }

      if (url.pathname === OFFICE_ASSET_ROOT) {
        if (!env?.OFFICE_ASSETS || typeof env.OFFICE_ASSETS.get !== "function") {
          return json({ code:"OFFICE_ASSETS_NOT_CONFIGURED" }, 503);
        }
        if (request.method === "GET") {
          const key = String(url.searchParams.get("key") || "").trim();
          if (key) {
            if (!assetKeyAllowed(key)) return json({ code:"OFFICE_ASSET_KEY_DENIED" }, 400);
            const object = await env.OFFICE_ASSETS.get(key);
            if (!object) return json({ code:"OFFICE_ASSET_NOT_FOUND" }, 404);
            if (url.searchParams.get("raw") === "1") {
              return new Response(object.body, {
                status:200,
                headers:baseHeaders({
                  "content-type":String(object.httpMetadata?.contentType || "application/octet-stream"),
                  "content-length":String(object.size || ""),
                  "etag":String(object.etag || ""),
                }),
              });
            }
            return json({ ok:true, asset:officeAssetSummary(object) });
          }
          const listed = await env.OFFICE_ASSETS.list({ prefix:OFFICE_ASSET_PREFIX, limit:100, include:["httpMetadata","customMetadata"] });
          return json({ ok:true, assets:(listed?.objects || []).map(officeAssetSummary), truncated:listed?.truncated === true });
        }

        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        const form = await request.formData().catch(() => null);
        const file = form?.get("file");
        if (!file || typeof file.arrayBuffer !== "function") return json({ code:"OFFICE_ASSET_FILE_REQUIRED" }, 400);
        const type = String(file.type || "").toLowerCase();
        if (!OFFICE_ASSET_TYPES.has(type)) return json({ code:"OFFICE_ASSET_TYPE_DENIED" }, 415);
        const size = Number(file.size || 0);
        if (!Number.isFinite(size) || size <= 0 || size > OFFICE_ASSET_MAX_BYTES) {
          return json({ code:"OFFICE_ASSET_SIZE_DENIED", maxBytes:OFFICE_ASSET_MAX_BYTES }, 413);
        }
        const categoryRaw = String(form.get("category") || "uploads").trim().toLowerCase();
        const category = new Set(["uploads","visuals","projects","references"]).has(categoryRaw) ? categoryRaw : "uploads";
        const originalName = safeAssetName(file.name || "asset");
        const bytes = await file.arrayBuffer();
        const hash = await sha256Hex(bytes);
        const now = new Date().toISOString();
        const day = now.slice(0, 10).replace(/-/g, "/");
        const key = `office/${category}/${day}/${crypto.randomUUID()}-${originalName}`;
        const assetId = `ASSET-${hash.slice(0, 16)}`;
        await env.OFFICE_ASSETS.put(key, bytes, {
          httpMetadata:{ contentType:type },
          customMetadata:{
            assetId,
            originalName,
            source:"OFFICE",
            category,
            uploadedAt:now,
            sha256:hash,
            subject:String(auth.claims.sub || "BIG"),
          },
        });
        const readback = typeof env.OFFICE_ASSETS.head === "function"
          ? await env.OFFICE_ASSETS.head(key)
          : await env.OFFICE_ASSETS.get(key);
        if (!readback || Number(readback.size || 0) !== size || String(readback.customMetadata?.sha256 || "") !== hash) {
          return json({ code:"OFFICE_ASSET_READBACK_MISMATCH" }, 502);
        }
        await recordAudit(audit, "OFFICE_ASSET_UPLOADED", { assetId, key, size, type, sha256:hash });
        return json({ ok:true, asset:officeAssetSummary(readback) }, 201);
      }

      if (url.pathname === OFFICE_ROOT || url.pathname === OFFICE_ROOT + "/") {
        return html(officeShell());
      }

      if (url.pathname === "/office/api/work") {
        if (!centreLive || typeof centreLive.action !== "function") {
          return json({ code:"OFFICE_CENTRE_UNAVAILABLE" }, 503);
        }
        const workId = String(url.searchParams.get("workId") || "").trim();
        const checkpointId = String(url.searchParams.get("checkpointId") || "").trim();
        if (!workId || !checkpointId) return json({ code:"OFFICE_WORK_IDENTITY_REQUIRED" }, 400);
        try {
          const response = await centreLive.action({ action:"v4_inspect", workId, checkpointId });
          const payload = await response.clone().json().catch(() => ({}));
          if (!response.ok) return json({ code:String(payload?.code || "OFFICE_WORK_READ_REJECTED") }, response.status);
          if (!payload?.work || String(payload.work.workId || "") !== workId ||
              String(payload.work.checkpointId || "") !== checkpointId) {
            return json({ code:"OFFICE_WORK_IDENTITY_MISMATCH" }, 409);
          }
          return json(payload, 200);
        } catch {
          return json({ code:"OFFICE_WORK_READ_FAILED" }, 500);
        }
      }

      if (url.pathname === "/office/api/command") {
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        if (!agentMission || typeof agentMission.action !== "function") {
          return json({ code:"OFFICE_AGENT_MISSION_UNAVAILABLE" }, 503);
        }
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json({ code:"OFFICE_COMMAND_INVALID_JSON" }, 400);
        }
        const action = String(body.action || "").trim();
        const allowed = new Set(Array.isArray(agentMissionActions) ? agentMissionActions.map(String) : []);
        if (!action || !allowed.has(action)) {
          return json({ code:"OFFICE_AGENT_MISSION_ACTION_DENIED" }, 403);
        }
        try {
          const response = await agentMission.action(body);
          const payload = await response.clone().json().catch(() => ({}));
          if (!response.ok) {
            return json({ code:String(payload?.code || "OFFICE_COMMAND_REJECTED") }, response.status);
          }
          return json(payload, response.status);
        } catch {
          return json({ code:"OFFICE_COMMAND_FAILED" }, 500);
        }
      }

      if (url.pathname === "/office/api/eye") {
        if (!factoryEye || typeof factoryEye.latest !== "function" || typeof factoryEye.screenshot !== "function") {
          return json({ code:"OFFICE_EYE_UNAVAILABLE" }, 503);
        }
        try {
          const screenshotRef = String(url.searchParams.get("screenshotRef") || "").trim();
          if (screenshotRef) {
            const shot = await factoryEye.screenshot({ screenshotRef });
            if (!shot?.ok) return json({ code:String(shot?.code || "OFFICE_EYE_SCREENSHOT_UNAVAILABLE") }, 404);
            return json({
              ok:true,
              source:"FACTORY_EYE",
              mode:"READ_ONLY",
              createsAuthority:false,
              screenshot:shot.screenshot,
            });
          }

          const latest = await factoryEye.latest();
          if (!latest?.ok) {
            const code = String(latest?.code || "OFFICE_EYE_UNAVAILABLE");
            const status = code === "FACTORY_EYE_SESSION_INACTIVE" ? 404 : 503;
            return json({ code }, status);
          }
          return json({
            ...latest,
            mode:"READ_ONLY",
            createsAuthority:false,
          });
        } catch {
          return json({ code:"OFFICE_EYE_READ_FAILED" }, 500);
        }
      }

      return json({ code:"OFFICE_ROUTE_DENIED" }, 404);
    },
  });
}

export const OFFICE_GATE_CONTRACT = Object.freeze({
  root:OFFICE_ROOT,
  cookie:OFFICE_COOKIE,
  denyByDefault:true,
  allowedRoutes:[...OFFICE_ALLOWED.keys()],
  workTruthOwner:"CENTRE",
  eyeTruthOwner:"FACTORY_EYE",
  sessionRevocation:"rotate GOHUB_OFFICE_SESSION_EPOCH or GOHUB_OFFICE_SESSION_KEY; logout clears browser cookie",
});

const encoder = new TextEncoder();

const OFFICE_COOKIE = "__Host-ygg-office";
const OFFICE_ROOT = "/office";
const OFFICE_LOGIN = "/office/login";
const OFFICE_LOGOUT = "/office/logout";
const OFFICE_SESSION = "/office/session";
const OFFICE_AUTH_WORK_ID = "WORK-GO-HUB-OFFICE-AUTH";
const OFFICE_AUTH_CHECKPOINT_ID = "CP-GO-HUB-OFFICE-AUTH";

const OFFICE_ALLOWED = new Map([
  ["/office", new Set(["GET"])],
  ["/office/", new Set(["GET"])],
  [OFFICE_LOGIN, new Set(["GET","POST"])],
  [OFFICE_LOGOUT, new Set(["POST"])],
  [OFFICE_SESSION, new Set(["GET"])],
  ["/office/api/work", new Set(["GET"])],
  ["/office/api/command", new Set(["POST"])],
  ["/office/api/eye", new Set(["GET"])],
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
  const origin = String(request.headers.get("origin") || "");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function configured(env) {
  return Boolean(
    String(env?.GOHUB_OFFICE_PASSCODE || "").trim() &&
    String(env?.GOHUB_OFFICE_SESSION_KEY || "").trim()
  );
}

function epoch(env) {
  return String(env?.GOHUB_OFFICE_SESSION_EPOCH || "1");
}

function requestRateKey(request) {
  return String(request.headers.get("cf-connecting-ip") || "unknown").trim() || "unknown";
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
  if (!configured(env)) return { ok:false, code:"OFFICE_AUTH_NOT_CONFIGURED", status:503 };
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
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1118"><title>YGG METRO Office</title><link rel="stylesheet" href="/go-hub-office-surface.css"></head><body class="office-body"><main class="office-login"><section class="office-login-card"><p class="office-kicker">YGG METRO</p><h1>OFFICE</h1><p class="office-muted">Owner workspace · secure entry</p>${error}<form method="post" action="/office/login"><label>Passcode<input name="passcode" type="password" autocomplete="current-password" required autofocus></label><button type="submit">Enter Office</button></form></section></main></body></html>`;
}

function officeShell() {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1118"><title>YGG METRO Office</title><link rel="stylesheet" href="/go-hub-office-surface.css"></head><body class="office-body"><main class="office-shell"><header class="office-top"><div><p class="office-kicker">YGG METRO</p><h1>OFFICE</h1><p class="office-muted">Build · Plan · Create · Together</p></div><form method="post" action="/office/logout"><button class="office-quiet" type="submit">Logout</button></form></header><section class="office-hero"><div class="office-hero-copy"><p class="office-kicker">CURRENT DESK</p><h2>Good work.<br>Brighter tomorrow.</h2><p>พื้นที่ทำงานของ GO และบิ๊ก — หน้าบ้านเรียบ แต่ต่อกับ Work truth และ Eye ด้านหลัง</p></div><div class="office-eye" data-office-eye><span class="office-dot"></span><div><strong data-eye-state>CHECKING</strong><small data-eye-detail>Factory Eye · read only</small></div></div></section><section class="office-grid"><article><span>01</span><h3>Projects</h3><p>งานและสถานะจาก owner truth</p></article><article><span>02</span><h3>Tasks</h3><p>สิ่งที่กำลังทำและรอตรวจ</p></article><article><span>03</span><h3>Notes</h3><p>บริบทสั้นที่ต้องหยิบใช้ตอนทำงาน</p></article><article><span>04</span><h3>Observer</h3><p>ตาของ GO · read-only ก่อนเสมอ</p></article></section><section class="office-panel"><div><p class="office-kicker">OBSERVER</p><h3>GO can see the current screen</h3><p class="office-muted" data-eye-message>กำลังอ่านสถานะ Factory Eye…</p></div><button type="button" data-eye-refresh>Refresh Eye</button></section></main><script type="module" src="/go-hub-office-surface.js"></script></body></html>`;
}

export function createOfficeGate({ centreLive = null, agentMission = null, agentMissionActions = [], factoryEye = null, rateLimiter = null, audit = null } = {}) {
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

      if (url.pathname === OFFICE_LOGIN) {
        if (request.method === "GET") {
          return html(loginPage());
        }
        if (!configured(env)) {
          await recordAudit(audit, "OFFICE_LOGIN_DENIED", { reason: "NOT_CONFIGURED" });
          return json({ code:"OFFICE_AUTH_NOT_CONFIGURED" }, 503);
        }
        if (!sameOrigin(request)) {
          await recordAudit(audit, "OFFICE_LOGIN_DENIED", { reason: "ORIGIN" });
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

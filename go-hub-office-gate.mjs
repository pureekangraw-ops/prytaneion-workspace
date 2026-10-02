const encoder = new TextEncoder();

const OFFICE_COOKIE = "__Host-ygg-office";
const OFFICE_ROOT = "/office";
const OFFICE_LOGIN = "/office/login";
const OFFICE_LOGOUT = "/office/logout";
const OFFICE_SESSION = "/office/session";
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
  const error = errorCode ? `<p role="alert">Authentication failed.</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YGGMETRO Office Gate</title></head><body><main><h1>YGGMETRO OFFICE</h1><p>Secure control surface</p>${error}<form method="post" action="/office/login"><label>Passcode <input name="passcode" type="password" autocomplete="current-password" required></label><button type="submit">Enter Office</button></form></main></body></html>`;
}

function officeShell() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YGGMETRO Office</title></head><body><main><h1>YGGMETRO OFFICE</h1><p>Office Gate active. Work read and Agent Mission command are server-wired; Eye remains read-only pending Phase 3.</p><form method="post" action="/office/logout"><button type="submit">Logout</button></form></main></body></html>`;
}

export function createOfficeGate({ centreLive = null, agentMission = null, agentMissionActions = [], factoryEye = null } = {}) {
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
        if (!configured(env)) return json({ code:"OFFICE_AUTH_NOT_CONFIGURED" }, 503);
        if (!sameOrigin(request)) return json({ code:"OFFICE_ORIGIN_DENIED" }, 403);
        const form = await request.formData().catch(() => null);
        const supplied = String(form?.get("passcode") || "");
        const expected = String(env.GOHUB_OFFICE_PASSCODE || "");
        if (!supplied || supplied.length !== expected.length) {
          return html(loginPage("OFFICE_AUTH_FAILED"), 403);
        }
        let diff = 0;
        for (let i = 0; i < expected.length; i += 1) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
        if (diff !== 0) return html(loginPage("OFFICE_AUTH_FAILED"), 403);
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

import { validateObserverPacket } from "./go-hub-browser-observer.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_SCREENSHOT_DATA_URL_CHARS = 1_500_000;
const encoder = new TextEncoder();

function clean(value) { return String(value == null ? "" : value).trim(); }
function isGumroadOrigin(value) { try { const url = new URL(clean(value)); const host = url.hostname.toLowerCase(); return url.protocol === "https:" && (host === "gumroad.com" || host.endsWith(".gumroad.com")) && url.origin === clean(value); } catch { return false; } }
async function sha256(value) { const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || ""))); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""); }
function constantTimeEqual(left, right) { const a = encoder.encode(String(left || "")); const b = encoder.encode(String(right || "")); let diff = a.length ^ b.length; const len = Math.max(a.length, b.length, 1); for (let i = 0; i < len; i += 1) diff |= (a[i % Math.max(a.length, 1)] || 0) ^ (b[i % Math.max(b.length, 1)] || 0); return diff === 0; }
function defaultToken() { if (!globalThis.crypto?.getRandomValues) throw new Error("HUB_UNAVAILABLE"); const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
function publicSession(session) { if (!session) return null; const { tokenHash, ...safe } = session; return safe; }
function validScreenshotDataUrl(value) { const text = String(value || ""); return text.length <= MAX_SCREENSHOT_DATA_URL_CHARS && /^data:image\/(?:jpeg|png);base64,[a-z0-9+/=]+$/i.test(text); }

export function createObserverSessionService({ storage, now = () => Date.now(), randomUUID = () => crypto.randomUUID(), randomToken = defaultToken } = {}) {
  if (!storage || typeof storage.get !== "function" || typeof storage.put !== "function") throw new TypeError("Observer session storage required");
  async function load(sessionId) { return storage.get(`session:${clean(sessionId)}`); }
  async function authorize(sessionId, sessionToken) {
    const session = await load(sessionId);
    if (!session || session.active !== true) return { ok: false, code: "SESSION_INACTIVE" };
    const current = Number(now());
    if (!Number.isFinite(current) || current >= Number(session.expiresAt)) return { ok: false, code: "SESSION_EXPIRED" };
    const suppliedHash = await sha256(sessionToken);
    if (!constantTimeEqual(suppliedHash, session.tokenHash)) return { ok: false, code: "SESSION_INACTIVE" };
    return { ok: true, session };
  }
  return Object.freeze({
    async start(input = {}) {
      const { allowedOrigin, ttlMs = DEFAULT_TTL_MS } = input;
      const ttl = Number(ttlMs);
      if (!isGumroadOrigin(allowedOrigin)) return { ok: false, code: "HOST_BLOCKED" };
      if (!Number.isFinite(ttl) || ttl <= 0 || ttl > DEFAULT_TTL_MS) return { ok: false, code: "SCHEMA_REJECTED" };
      const sessionId = clean(randomUUID()); const token = clean(randomToken()); const startedAt = Number(now());
      const workId = clean(input.workContext?.workId);
      const checkpointId = clean(input.workContext?.checkpointId);
      if ((workId && !checkpointId) || (!workId && checkpointId)) return { ok: false, code: "WORK_CONTEXT_REQUIRED" };
      if (!sessionId || !token || !Number.isFinite(startedAt)) return { ok: false, code: "HUB_UNAVAILABLE" };
      const session = { sessionId, tokenHash: await sha256(token), active: true, allowedOrigin, workContext: workId ? { workId, checkpointId } : null, origin: null, pageFingerprint: null, startedAt, expiresAt: startedAt + ttl, screenshotConsent: false, pendingScreenshotRef: null, latestScreenshotRef: null };
      await storage.put(`session:${sessionId}`, session);
      return { ok: true, session_id: sessionId, session_token: token, expires_at: session.expiresAt, allowed_origin: allowedOrigin };
    },
    async acceptSnapshot({ sessionId, sessionToken, packet } = {}) {
      const auth = await authorize(sessionId, sessionToken); if (!auth.ok) return auth;
      let session = auth.session;
      if (!session.origin || !session.pageFingerprint) {
        if (clean(packet?.origin) !== clean(session.allowedOrigin)) return { ok: false, code: "HOST_BLOCKED" };
        session = { ...session, origin: clean(packet.origin), pageFingerprint: clean(packet.page_fingerprint) };
      }
      const screenshotRef = clean(packet?.optional_screenshot_ref);
      if (screenshotRef && screenshotRef !== clean(session.pendingScreenshotRef)) return { ok: false, code: "SCREENSHOT_CONSENT_REQUIRED" };
      const validationSession = screenshotRef ? { ...session, screenshotConsent: true } : session;
      const validated = validateObserverPacket(packet, validationSession, { now: Number(now()) });
      if (!validated.ok) return validated;
      if (screenshotRef) session = { ...session, screenshotConsent: false, pendingScreenshotRef: null, latestScreenshotRef: screenshotRef };
      await storage.put(`session:${session.sessionId}`, session);
      await storage.put(`latest:${session.sessionId}`, packet);
      await storage.put("latest-session-id", session.sessionId);
      return { ok: true, code: null };
    },
    async read({ sessionId, sessionToken } = {}) {
      const auth = await authorize(sessionId, sessionToken); if (!auth.ok) return auth;
      return { ok: true, session: publicSession(auth.session), latest: await storage.get(`latest:${auth.session.sessionId}`) || null };
    },
    async stop({ sessionId, sessionToken } = {}) {
      const auth = await authorize(sessionId, sessionToken); if (!auth.ok) return auth;
      await storage.put(`session:${auth.session.sessionId}`, { ...auth.session, active: false, screenshotConsent: false, pendingScreenshotRef: null });
      return { ok: true, code: null };
    },
    async grantScreenshot({ sessionId, sessionToken } = {}) {
      const auth = await authorize(sessionId, sessionToken); if (!auth.ok) return auth;
      await storage.put(`session:${auth.session.sessionId}`, { ...auth.session, screenshotConsent: true, pendingScreenshotRef: null });
      return { ok: true, code: null };
    },
    async consumeScreenshot({ sessionId, sessionToken } = {}) {
      const auth = await authorize(sessionId, sessionToken); if (!auth.ok) return { allowed: false, code: auth.code };
      if (auth.session.screenshotConsent !== true) return { allowed: false, code: "SCREENSHOT_CONSENT_REQUIRED" };
      await storage.put(`session:${auth.session.sessionId}`, { ...auth.session, screenshotConsent: false });
      return { allowed: true, code: null };
    },
    async storeScreenshot({ sessionId, sessionToken, dataUrl, pageFingerprint } = {}) {
      const auth = await authorize(sessionId, sessionToken); if (!auth.ok) return auth;
      if (auth.session.screenshotConsent !== true) return { ok: false, code: "SCREENSHOT_CONSENT_REQUIRED" };
      if (!auth.session.pageFingerprint || clean(pageFingerprint) !== clean(auth.session.pageFingerprint)) return { ok: false, code: "STALE_PAGE" };
      if (!validScreenshotDataUrl(dataUrl)) return { ok: false, code: "SCHEMA_REJECTED" };
      const ref = `shot:${clean(randomUUID())}`;
      if (!clean(ref) || ref === "shot:") return { ok: false, code: "HUB_UNAVAILABLE" };
      await storage.put(`screenshot:${ref}`, { ref, sessionId: auth.session.sessionId, pageFingerprint: auth.session.pageFingerprint, capturedAt: Number(now()), dataUrl: String(dataUrl) });
      await storage.put(`session:${auth.session.sessionId}`, { ...auth.session, screenshotConsent: false, pendingScreenshotRef: ref });
      return { ok: true, code: null, screenshot_ref: ref };
    },
    async latest({ workContext } = {}) {
      const workId = clean(workContext?.workId);
      const checkpointId = clean(workContext?.checkpointId);
      if (!workId || !checkpointId) return { ok: false, code: "WORK_CONTEXT_REQUIRED" };
      const sessionId = await storage.get("latest-session-id");
      if (!sessionId) return { ok: false, code: "SESSION_INACTIVE" };
      const session = await load(sessionId); const latest = await storage.get(`latest:${sessionId}`) || null;
      if (!session || session.active !== true || Number(now()) >= Number(session.expiresAt)) return { ok: false, code: session ? "SESSION_EXPIRED" : "SESSION_INACTIVE" };
      if (!session.workContext) return { ok: false, code: "WORK_CONTEXT_UNBOUND" };
      if (session.workContext.workId !== workId || session.workContext.checkpointId !== checkpointId) {
        return { ok: false, code: "WORK_CONTEXT_MISMATCH" };
      }
      return { ok: true, session: publicSession(session), latest };
    },
    async screenshot({ screenshotRef } = {}) {
      const value = await storage.get(`screenshot:${clean(screenshotRef)}`);
      return value ? { ok: true, screenshot: value } : { ok: false, code: "SCHEMA_REJECTED" };
    },
  });
}

export class ObserverSessionRegistry {
  constructor(ctx) { this.ctx = ctx; }
  service() { return createObserverSessionService({ storage: this.ctx.storage }); }
  async start(input) { return this.service().start(input); }
  async acceptSnapshot(input) { return this.service().acceptSnapshot(input); }
  async read(input) { return this.service().read(input); }
  async stop(input) { return this.service().stop(input); }
  async grantScreenshot(input) { return this.service().grantScreenshot(input); }
  async consumeScreenshot(input) { return this.service().consumeScreenshot(input); }
  async storeScreenshot(input) { return this.service().storeScreenshot(input); }
  async latest(input) { return this.service().latest(input); }
  async screenshot(input) { return this.service().screenshot(input); }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") return new Response(JSON.stringify({ code:"METHOD_NOT_ALLOWED" }), { status:405, headers:{ "content-type":"application/json" } });
    const input = await request.json().catch(() => ({}));
    const routes = {
      "/start": value => this.start(value),
      "/snapshot": value => this.acceptSnapshot(value),
      "/read": value => this.read(value),
      "/stop": value => this.stop(value),
      "/grant-screenshot": value => this.grantScreenshot(value),
      "/consume-screenshot": value => this.consumeScreenshot(value),
      "/store-screenshot": value => this.storeScreenshot(value),
      "/latest": value => this.latest(value),
      "/screenshot": value => this.screenshot(value),
    };
    const run = routes[url.pathname];
    if (!run) return new Response(JSON.stringify({ code:"NOT_FOUND" }), { status:404, headers:{ "content-type":"application/json" } });
    try {
      const result = await run(input);
      return new Response(JSON.stringify(result), { status:200, headers:{ "content-type":"application/json" } });
    } catch (error) {
      return new Response(JSON.stringify({ code:"HUB_UNAVAILABLE", reason:clean(error?.message || error) }), { status:503, headers:{ "content-type":"application/json" } });
    }
  }
}

export { DEFAULT_TTL_MS, MAX_SCREENSHOT_DATA_URL_CHARS };

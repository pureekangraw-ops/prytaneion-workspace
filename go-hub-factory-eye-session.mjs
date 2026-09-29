const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LIVE_AFTER_MS = 20_000;
const FRESH_OBSERVATION_VERSION = "0.2.3";
const MAX_TABS = 100;
const MAX_SCREENSHOT_DATA_URL_CHARS = 1_800_000;
const SCREENSHOT_CHUNK_CHARS = 80_000;
const encoder = new TextEncoder();

function clean(value, max = 4096) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length, 1);
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i % Math.max(a.length, 1)] || 0) ^ (b[i % Math.max(b.length, 1)] || 0);
  }
  return diff === 0;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function publicSession(session) {
  if (!session) return null;
  const { tokenHash, ...safe } = session;
  return clone(safe);
}

function sessionState(session, nowMs) {
  if (!session) return "UNAVAILABLE";
  if (session.active !== true) return "INACTIVE";
  if (!Number.isFinite(Number(session.expiresAt)) || nowMs >= Number(session.expiresAt)) return "EXPIRED";
  const seen = Number(session.lastSeenAt || 0);
  return seen > 0 && nowMs - seen <= LIVE_AFTER_MS ? "LIVE" : "STALE";
}

function versionAtLeast(value, target) {
  const parse = input => String(input || "").split(".").map(part => Number.parseInt(part, 10) || 0);
  const left = parse(value);
  const right = parse(target);
  const size = Math.max(left.length, right.length, 3);
  for (let i = 0; i < size; i += 1) {
    const a = left[i] || 0;
    const b = right[i] || 0;
    if (a !== b) return a > b;
  }
  return true;
}

function isWebUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sameOrigin(left, right) {
  try {
    return new URL(String(left || "")).origin === new URL(String(right || "")).origin;
  } catch {
    return false;
  }
}

function observationFreshness(session, latest, nowMs) {
  const transportState = sessionState(session, nowMs);
  const activeTabId = Number.isInteger(Number(session?.activeTabId)) ? Number(session.activeTabId) : null;
  const observationTabId = Number.isInteger(Number(latest?.tab?.tabId)) ? Number(latest.tab.tabId) : null;
  const receivedMs = Date.parse(String(latest?.receivedAt || latest?.observedAt || ""));
  const ageMs = Number.isFinite(receivedMs) ? Math.max(0, nowMs - receivedMs) : null;
  const tabMatch = activeTabId !== null && observationTabId === activeTabId && latest?.tab?.active === true;
  const generationRequired = versionAtLeast(session?.version, FRESH_OBSERVATION_VERSION) && isWebUrl(latest?.tab?.url);
  const generationMatch = !generationRequired ||
    clean(latest?.contentScriptVersion, 80) === clean(session?.version, 80);
  const visibleMatch = !generationRequired || latest?.documentVisible === true;
  const freshEnough = ageMs !== null && ageMs <= LIVE_AFTER_MS;
  const evidenceLive = tabMatch && generationMatch && visibleMatch && freshEnough;
  const state = transportState === "LIVE"
    ? (evidenceLive ? "LIVE" : "WARMING_UP")
    : transportState;
  return {
    state,
    transportState,
    activeTabId,
    observationTabId,
    ageMs,
    tabMatch,
    generationRequired,
    generationMatch,
    visibleMatch,
    freshEnough,
    evidenceLive,
    expectedVersion:clean(session?.version, 80) || null,
    observedVersion:clean(latest?.contentScriptVersion, 80) || null,
  };
}

function normalizeTab(tab = {}) {
  const tabId = Number(tab.tabId);
  if (!Number.isInteger(tabId)) return null;
  const windowId = Number(tab.windowId);
  return {
    tabId,
    windowId: Number.isInteger(windowId) ? windowId : null,
    url: clean(tab.url, 2400) || null,
    title: clean(tab.title, 600) || null,
    active: tab.active === true,
    pinned: tab.pinned === true,
    audible: tab.audible === true,
    status: clean(tab.status, 80) || null,
  };
}

function normalizeTabs(tabs) {
  if (!Array.isArray(tabs)) return [];
  return tabs.map(normalizeTab).filter(Boolean).slice(0, MAX_TABS);
}

function arrayOfObjects(value, limit, mapper) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === "object" && !Array.isArray(item)).slice(0, limit).map(mapper);
}

function normalizePage(page) {
  if (!page || typeof page !== "object" || Array.isArray(page)) return null;
  if (page.capturesInputValues !== false || page.createsAuthority !== false) return null;

  return {
    schema: clean(page.schema, 120) || "ERGASTERION_BROWSER_PAGE_SUMMARY_V1",
    url: clean(page.url, 2400) || null,
    title: clean(page.title, 600) || null,
    readyState: clean(page.readyState, 40) || null,
    language: clean(page.language, 80) || null,
    description: clean(page.description, 1000) || null,
    headings: arrayOfObjects(page.headings, 24, item => ({
      level: Number.isInteger(Number(item.level)) ? Number(item.level) : null,
      text: clean(item.text, 420) || null,
    })).filter(item => item.text),
    buttons: arrayOfObjects(page.buttons, 30, item => ({
      label: clean(item.label, 320) || null,
      disabled: item.disabled === true,
    })).filter(item => item.label),
    links: arrayOfObjects(page.links, 40, item => ({
      label: clean(item.label, 320) || null,
      href: clean(item.href, 1200) || null,
    })).filter(item => item.label || item.href),
    fields: arrayOfObjects(page.fields, 40, item => ({
      tag: clean(item.tag, 40) || null,
      type: clean(item.type, 80) || null,
      name: clean(item.name, 180) || null,
      label: clean(item.label, 320) || null,
      placeholder: item.sensitive === true ? null : (clean(item.placeholder, 320) || null),
      disabled: item.disabled === true,
      readOnly: item.readOnly === true,
      sensitive: item.sensitive === true,
    })),
    landmarks: arrayOfObjects(page.landmarks, 20, item => ({
      role: clean(item.role, 100) || null,
      label: clean(item.label, 320) || null,
    })),
    capturedAt: clean(page.capturedAt, 80) || null,
    observerVersion: clean(page.observerVersion, 80) || null,
    visibilityState: clean(page.visibilityState, 40) || null,
    documentFocused: page.documentFocused === true,
    capturesInputValues: false,
    createsAuthority: false,
  };
}

function validScreenshotDataUrl(value) {
  const text = String(value || "");
  return text.length <= MAX_SCREENSHOT_DATA_URL_CHARS &&
    /^data:image\/(?:jpeg|png);base64,[a-z0-9+/=]+$/i.test(text);
}

export function createFactoryEyeSessionService({
  storage,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  tokenFactory = randomToken,
} = {}) {
  if (!storage || typeof storage.get !== "function" || typeof storage.put !== "function") {
    throw new TypeError("Factory Eye storage required");
  }

  async function loadSession() {
    return storage.get("session");
  }

  async function saveSession(session) {
    await storage.put("session", session);
  }

  async function authorize({ sessionId, sessionToken, adapterId } = {}) {
    const session = await loadSession();
    if (!session || session.active !== true) return { ok:false, code:"FACTORY_EYE_SESSION_INACTIVE" };
    const current = Number(now());
    if (!Number.isFinite(current) || current >= Number(session.expiresAt)) {
      return { ok:false, code:"FACTORY_EYE_SESSION_EXPIRED" };
    }
    if (clean(sessionId, 200) !== clean(session.sessionId, 200)) {
      return { ok:false, code:"FACTORY_EYE_SESSION_INACTIVE" };
    }
    if (adapterId && clean(adapterId, 200) !== clean(session.adapterId, 200)) {
      return { ok:false, code:"FACTORY_EYE_ADAPTER_MISMATCH" };
    }
    const suppliedHash = await sha256(sessionToken);
    if (!constantTimeEqual(suppliedHash, session.tokenHash)) {
      return { ok:false, code:"FACTORY_EYE_SESSION_INACTIVE" };
    }
    return { ok:true, session };
  }

  async function deleteScreenshot(ref) {
    const safeRef = clean(ref, 300);
    if (!safeRef) return;
    const meta = await storage.get("shotmeta:" + safeRef);
    const count = Number(meta?.chunkCount || 0);
    for (let i = 0; i < count; i += 1) {
      await storage.delete("shot:" + safeRef + ":" + i);
    }
    await storage.delete("shotmeta:" + safeRef);
  }

  async function storeScreenshot({ session, observationId, dataUrl, capturedAt }) {
    if (!validScreenshotDataUrl(dataUrl)) return { screenshotRef:null, dropped:true };
    const previous = await storage.get("latest-screenshot-ref");
    if (previous) await deleteScreenshot(previous);

    const screenshotRef = "factory-eye-shot:" + session.sessionId + ":" + clean(observationId, 180);
    const chunks = [];
    const text = String(dataUrl);
    for (let i = 0; i < text.length; i += SCREENSHOT_CHUNK_CHARS) {
      chunks.push(text.slice(i, i + SCREENSHOT_CHUNK_CHARS));
    }
    for (let i = 0; i < chunks.length; i += 1) {
      await storage.put("shot:" + screenshotRef + ":" + i, chunks[i]);
    }
    await storage.put("shotmeta:" + screenshotRef, {
      screenshotRef,
      chunkCount:chunks.length,
      capturedAt,
      sizeChars:text.length,
    });
    await storage.put("latest-screenshot-ref", screenshotRef);
    return { screenshotRef, dropped:false };
  }

  return Object.freeze({
    async start({ adapterId, ttlMs = DEFAULT_TTL_MS } = {}) {
      const id = clean(adapterId, 200);
      const ttl = Number(ttlMs);
      if (!id) return { ok:false, code:"FACTORY_EYE_ADAPTER_REQUIRED" };
      if (!Number.isFinite(ttl) || ttl <= 0 || ttl > DEFAULT_TTL_MS) {
        return { ok:false, code:"FACTORY_EYE_TTL_INVALID" };
      }

      const previous = await storage.get("latest-screenshot-ref");
      if (previous) await deleteScreenshot(previous);
      await storage.delete("tabs");
      await storage.delete("latest");
      await storage.delete("latest-receipt");
      await storage.delete("latest-screenshot-ref");

      const sessionId = clean(randomUUID(), 200);
      const token = clean(tokenFactory(), 300);
      const startedAt = Number(now());
      if (!sessionId || !token || !Number.isFinite(startedAt)) {
        return { ok:false, code:"FACTORY_EYE_UNAVAILABLE" };
      }
      const session = {
        sessionId,
        tokenHash:await sha256(token),
        adapterId:id,
        active:true,
        startedAt,
        expiresAt:startedAt + ttl,
        lastSeenAt:null,
        registeredAt:null,
        activeTabId:null,
        host:null,
        version:null,
        protocolVersion:null,
        capabilities:{},
        limits:[],
        createsAuthority:false,
      };
      await saveSession(session);
      return {
        ok:true,
        session_id:sessionId,
        session_token:token,
        expires_at:session.expiresAt,
        adapter_id:id,
        creates_authority:false,
      };
    },

    async register(input = {}) {
      const auth = await authorize(input);
      if (!auth.ok) return auth;
      const current = Number(now());
      const session = {
        ...auth.session,
        host:clean(input.host, 120) || "firefox-addon",
        version:clean(input.version, 80) || "UNKNOWN",
        protocolVersion:clean(input.protocolVersion, 40) || "1",
        capabilities:input.capabilities && typeof input.capabilities === "object" && !Array.isArray(input.capabilities)
          ? clone(input.capabilities)
          : {},
        limits:Array.isArray(input.limits) ? input.limits.map(value => clean(value, 160)).filter(Boolean).slice(0, 30) : [],
        registeredAt:auth.session.registeredAt || current,
        lastSeenAt:current,
      };
      await saveSession(session);
      return { ok:true, adapter:publicSession(session) };
    },

    async heartbeat(input = {}) {
      const auth = await authorize(input);
      if (!auth.ok) return auth;
      const current = Number(now());
      const tabs = normalizeTabs(input.tabs);
      await storage.put("tabs", tabs);
      const session = {
        ...auth.session,
        activeTabId:Number.isInteger(Number(input.activeTabId)) ? Number(input.activeTabId) : null,
        lastSeenAt:current,
      };
      await saveSession(session);
      return { ok:true, adapter:publicSession(session), tabs };
    },

    async observe(input = {}) {
      const auth = await authorize(input);
      if (!auth.ok) return auth;

      const observationId = clean(input.observationId, 180);
      const tab = normalizeTab(input.tab);
      if (!observationId || !tab) return { ok:false, code:"FACTORY_EYE_OBSERVATION_INVALID" };

      const current = Number(now());
      const observedAtText = clean(input.observedAt, 80);
      const observedAt = Date.parse(observedAtText);
      if (!Number.isFinite(observedAt) || observedAt > current + 10_000 || current - observedAt > 60_000) {
        return { ok:false, code:"FACTORY_EYE_OBSERVATION_STALE" };
      }

      const status = clean(input.status, 40).toUpperCase() || "UNKNOWN";
      const allowedStatus = new Set(["OBSERVED","PARTIAL","UNSUPPORTED","FAILED","UNKNOWN"]);
      if (!allowedStatus.has(status)) return { ok:false, code:"FACTORY_EYE_OBSERVATION_INVALID" };

      const page = normalizePage(input.page);
      if (status === "OBSERVED" && !page) {
        return { ok:false, code:"FACTORY_EYE_PAGE_SUMMARY_INVALID" };
      }

      const contentScriptVersion = clean(input.contentScriptVersion || page?.observerVersion, 80) || null;
      const documentVisible = input.documentVisible === true || page?.visibilityState === "visible";
      const documentFocused = input.documentFocused === true || page?.documentFocused === true;
      const freshnessContractRequired = versionAtLeast(auth.session.version, FRESH_OBSERVATION_VERSION) &&
        isWebUrl(tab.url);

      if (status === "OBSERVED" && freshnessContractRequired) {
        if (tab.active !== true) {
          return { ok:false, code:"FACTORY_EYE_OBSERVATION_NOT_ACTIVE" };
        }
        if (contentScriptVersion !== clean(auth.session.version, 80)) {
          return { ok:false, code:"FACTORY_EYE_SCRIPT_VERSION_STALE" };
        }
        if (documentVisible !== true) {
          return { ok:false, code:"FACTORY_EYE_OBSERVATION_NOT_VISIBLE" };
        }
        if (!page?.url || !sameOrigin(tab.url, page.url)) {
          return { ok:false, code:"FACTORY_EYE_OBSERVATION_ORIGIN_MISMATCH" };
        }
      }

      const unknowns = Array.isArray(input.unknowns)
        ? input.unknowns.map(value => clean(value, 220)).filter(Boolean).slice(0, 40)
        : [];

      const screenshot = input.screenshotDataUrl
        ? await storeScreenshot({
            session:auth.session,
            observationId,
            dataUrl:input.screenshotDataUrl,
            capturedAt:observedAtText,
          })
        : { screenshotRef:null, dropped:false };

      if (screenshot.dropped) unknowns.push("SCREENSHOT_DROPPED_INVALID_OR_TOO_LARGE");

      const observation = {
        schema:"ERGASTERION_FACTORY_EYE_REMOTE_V1",
        observationId,
        adapterId:auth.session.adapterId,
        observedAt:observedAtText,
        receivedAt:new Date(current).toISOString(),
        tab,
        page,
        contentScriptVersion,
        evidenceReason:clean(input.evidenceReason, 120) || null,
        documentVisible,
        documentFocused,
        status,
        screenshotRef:screenshot.screenshotRef,
        unknowns:[...new Set(unknowns)],
        source:"FACTORY_EYE",
        createsAuthority:false,
      };
      await storage.put("latest", observation);
      const tabs = normalizeTabs(await storage.get("tabs"));
      const index = tabs.findIndex(item => item.tabId === tab.tabId);
      if (index >= 0) tabs[index] = tab;
      else tabs.push(tab);
      await storage.put("tabs", tabs.slice(0, MAX_TABS));
      await saveSession({ ...auth.session, activeTabId:tab.active ? tab.tabId : auth.session.activeTabId, lastSeenAt:current });
      return { ok:true, observation };
    },

    async receipt(input = {}) {
      const auth = await authorize(input);
      if (!auth.ok) return auth;
      const receipt = {
        commandId:clean(input.commandId, 180) || null,
        status:clean(input.status, 40).toUpperCase() || "UNKNOWN",
        completedAt:clean(input.completedAt, 80) || new Date(Number(now())).toISOString(),
        followUpObservationId:clean(input.followUpObservationId, 180) || null,
        errorCode:clean(input.errorCode, 180) || null,
        source:"FACTORY_EYE",
        createsAuthority:false,
      };
      await storage.put("latest-receipt", receipt);
      await saveSession({ ...auth.session, lastSeenAt:Number(now()) });
      return { ok:true, receipt };
    },

    async pullCommands(input = {}) {
      const auth = await authorize(input);
      if (!auth.ok) return auth;
      return { ok:true, commands:[], capability:"EYES_ONLY" };
    },

    async stop(input = {}) {
      const auth = await authorize(input);
      if (!auth.ok) return auth;
      await saveSession({ ...auth.session, active:false, lastSeenAt:Number(now()) });
      return { ok:true };
    },

    async latest() {
      const session = await loadSession();
      if (!session) return { ok:false, code:"FACTORY_EYE_SESSION_INACTIVE" };
      const nowMs = Number(now());
      const latest = clone(await storage.get("latest") || null);
      const freshness = observationFreshness(session, latest, nowMs);
      return {
        ok:true,
        source:"FACTORY_EYE",
        state:freshness.state,
        freshness,
        session:publicSession(session),
        tabs:normalizeTabs(await storage.get("tabs")),
        latest,
        latestReceipt:clone(await storage.get("latest-receipt") || null),
        createsAuthority:false,
      };
    },

    async screenshot({ screenshotRef } = {}) {
      const ref = clean(screenshotRef, 300);
      if (!ref.startsWith("factory-eye-shot:")) return { ok:false, code:"FACTORY_EYE_SCREENSHOT_NOT_FOUND" };
      const meta = await storage.get("shotmeta:" + ref);
      if (!meta) return { ok:false, code:"FACTORY_EYE_SCREENSHOT_NOT_FOUND" };
      let dataUrl = "";
      for (let i = 0; i < Number(meta.chunkCount || 0); i += 1) {
        dataUrl += String(await storage.get("shot:" + ref + ":" + i) || "");
      }
      if (!dataUrl || !validScreenshotDataUrl(dataUrl)) {
        return { ok:false, code:"FACTORY_EYE_SCREENSHOT_NOT_FOUND" };
      }
      return {
        ok:true,
        source:"FACTORY_EYE",
        screenshot:{
          ref,
          capturedAt:meta.capturedAt || null,
          dataUrl,
        },
      };
    },
  });
}

export class FactoryEyeSessionRegistry {
  constructor(ctx) {
    this.ctx = ctx;
  }
  service() {
    return createFactoryEyeSessionService({ storage:this.ctx.storage });
  }
  async start(input) { return this.service().start(input); }
  async register(input) { return this.service().register(input); }
  async heartbeat(input) { return this.service().heartbeat(input); }
  async observe(input) { return this.service().observe(input); }
  async receipt(input) { return this.service().receipt(input); }
  async pullCommands(input) { return this.service().pullCommands(input); }
  async stop(input) { return this.service().stop(input); }
  async latest() { return this.service().latest(); }
  async screenshot(input) { return this.service().screenshot(input); }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ code:"METHOD_NOT_ALLOWED" }), {
        status:405,
        headers:{ "content-type":"application/json" },
      });
    }
    const input = await request.json().catch(() => ({}));
    const routes = {
      "/start": value => this.start(value),
      "/register": value => this.register(value),
      "/heartbeat": value => this.heartbeat(value),
      "/observe": value => this.observe(value),
      "/receipt": value => this.receipt(value),
      "/commands": value => this.pullCommands(value),
      "/stop": value => this.stop(value),
      "/latest": () => this.latest(),
      "/screenshot": value => this.screenshot(value),
    };
    const run = routes[url.pathname];
    if (!run) {
      return new Response(JSON.stringify({ code:"NOT_FOUND" }), {
        status:404,
        headers:{ "content-type":"application/json" },
      });
    }
    try {
      const result = await run(input);
      const status = result?.ok === false
        ? (result.code === "FACTORY_EYE_SESSION_EXPIRED" ? 410 :
           ["FACTORY_EYE_OBSERVATION_STALE","FACTORY_EYE_SCRIPT_VERSION_STALE","FACTORY_EYE_OBSERVATION_NOT_ACTIVE","FACTORY_EYE_OBSERVATION_NOT_VISIBLE","FACTORY_EYE_OBSERVATION_ORIGIN_MISMATCH"].includes(result.code) ? 409 :
           result.code === "FACTORY_EYE_UNAVAILABLE" ? 503 : 400)
        : 200;
      return new Response(JSON.stringify(result), {
        status,
        headers:{ "content-type":"application/json" },
      });
    } catch (error) {
      return new Response(JSON.stringify({
        code:"FACTORY_EYE_UNAVAILABLE",
        reason:clean(error?.message || error, 300),
      }), {
        status:503,
        headers:{ "content-type":"application/json" },
      });
    }
  }
}

export {
  DEFAULT_TTL_MS,
  LIVE_AFTER_MS,
  FRESH_OBSERVATION_VERSION,
  MAX_SCREENSHOT_DATA_URL_CHARS,
};

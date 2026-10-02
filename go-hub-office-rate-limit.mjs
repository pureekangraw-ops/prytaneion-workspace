const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_BLOCK_MS = 15 * 60 * 1000;
const encoder = new TextEncoder();

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function clean(value) { return String(value == null ? "" : value).trim(); }
function finiteNow(value) { return Number.isFinite(Number(value)) ? Number(value) : Date.now(); }
function retryAfterSeconds(until, now) { return Math.max(1, Math.ceil((Number(until) - Number(now)) / 1000)); }
function validKey(value) { const key = clean(value); return key && key.length <= 256 ? key : null; }

function normalizeState(value) {
  return {
    failures: Array.isArray(value?.failures) ? value.failures.map(Number).filter(Number.isFinite) : [],
    blockedUntil: Number.isFinite(Number(value?.blockedUntil)) ? Number(value.blockedUntil) : 0,
  };
}

function prune(state, now, windowMs) {
  const failures = state.failures.filter(at => at > now - windowMs);
  return failures.length === state.failures.length ? state : { ...state, failures };
}

async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(clean(value))));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export class OfficeRateLimitState {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
      const input = await request.json().catch(() => null);
      if (!input || typeof input !== "object" || Array.isArray(input)) return json({ code: "INVALID_JSON" }, 400);
      const key = validKey(input.key);
      if (!key) return json({ code: "OFFICE_RATE_LIMIT_KEY_REQUIRED" }, 400);
      const action = clean(input.action);
      const now = finiteNow(input.now);
      const windowMs = Number.isFinite(Number(input.windowMs)) && Number(input.windowMs) > 0 ? Number(input.windowMs) : DEFAULT_WINDOW_MS;
      const maxFailures = Number.isSafeInteger(Number(input.maxFailures)) && Number(input.maxFailures) > 0 ? Number(input.maxFailures) : DEFAULT_MAX_FAILURES;
      const blockMs = Number.isFinite(Number(input.blockMs)) && Number(input.blockMs) > 0 ? Number(input.blockMs) : DEFAULT_BLOCK_MS;
      const storageKey = "office-rate-limit:" + key;
      let state = prune(normalizeState(await this.ctx.storage.get(storageKey)), now, windowMs);
      if (action === "check") {
        if (state.blockedUntil > now) return json({ ok: false, limited: true, retryAfterSeconds: retryAfterSeconds(state.blockedUntil, now) });
        await this.ctx.storage.put(storageKey, state);
        return json({ ok: true, limited: false });
      }
      if (action === "record_failure") {
        if (state.blockedUntil > now) return json({ ok: false, limited: true, retryAfterSeconds: retryAfterSeconds(state.blockedUntil, now) });
        const failures = [...state.failures, now];
        const limited = failures.length >= maxFailures;
        state = { failures, blockedUntil: limited ? now + blockMs : 0 };
        await this.ctx.storage.put(storageKey, state);
        return json(limited
          ? { ok: false, limited: true, retryAfterSeconds: retryAfterSeconds(state.blockedUntil, now) }
          : { ok: true, limited: false });
      }
      if (action === "clear") {
        await this.ctx.storage.delete(storageKey);
        return json({ ok: true, limited: false });
      }
      return json({ code: "OFFICE_RATE_LIMIT_UNSUPPORTED_ACTION" }, 400);
    } catch (error) {
      return json({ code: error?.message || "OFFICE_RATE_LIMIT_ERROR" }, 503);
    }
  }
}

export function createOfficeRateLimiter({ namespace = null, memory = new Map(), now = () => Date.now(), windowMs = DEFAULT_WINDOW_MS, maxFailures = DEFAULT_MAX_FAILURES, blockMs = DEFAULT_BLOCK_MS } = {}) {
  function localState(key) {
    const current = normalizeState(memory.get(key));
    const currentNow = finiteNow(now());
    const pruned = prune(current, currentNow, windowMs);
    memory.set(key, pruned);
    return { state: pruned, now: currentNow };
  }
  async function durableCall(action, key) {
    if (!namespace || typeof namespace.getByName !== "function") return null;
    const name = "office-rate-limit-" + await digest(key);
    const stub = namespace.getByName(name);
    if (!stub || typeof stub.fetch !== "function") return { ok: false, unavailable: true, code: "OFFICE_RATE_LIMIT_UNAVAILABLE" };
    const response = await stub.fetch(new Request("https://office-rate-limit.internal/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, key, now: finiteNow(now()), windowMs, maxFailures, blockMs }),
    }));
    const body = await response.json().catch(() => ({}));
    return response.ok ? body : { ok: false, unavailable: true, code: body?.code || "OFFICE_RATE_LIMIT_UNAVAILABLE" };
  }
  async function call(action, key) {
    const normalized = validKey(key);
    if (!normalized) return { ok: false, unavailable: true, code: "OFFICE_RATE_LIMIT_KEY_REQUIRED" };
    const durable = await durableCall(action, normalized);
    if (durable) return durable;
    const current = localState(normalized);
    if (action === "check") {
      return current.state.blockedUntil > current.now
        ? { ok: false, limited: true, retryAfterSeconds: retryAfterSeconds(current.state.blockedUntil, current.now) }
        : { ok: true, limited: false };
    }
    if (action === "clear") {
      memory.delete(normalized);
      return { ok: true, limited: false };
    }
    const failures = [...current.state.failures, current.now];
    const limited = failures.length >= maxFailures;
    const next = { failures, blockedUntil: limited ? current.now + blockMs : 0 };
    memory.set(normalized, next);
    return limited
      ? { ok: false, limited: true, retryAfterSeconds: retryAfterSeconds(next.blockedUntil, current.now) }
      : { ok: true, limited: false };
  }
  return Object.freeze({
    check: key => call("check", key),
    recordFailure: key => call("record_failure", key),
    clear: key => call("clear", key),
  });
}

export { DEFAULT_WINDOW_MS, DEFAULT_MAX_FAILURES, DEFAULT_BLOCK_MS };

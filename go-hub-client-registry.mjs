const MAX_CLIENTS = 200;
const STORE_KEY = "clients-v1";

function clean(value, max = 160) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function safeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    intent: clean(value.intent, 40) || null,
    jobType: clean(value.jobType, 40) || null,
    package: clean(value.package, 40) || null,
    pageCount: Number.isSafeInteger(value.pageCount) ? value.pageCount : null,
    desiredDate: clean(value.desiredDate, 80) || null,
    wantsEstimate: value.wantsEstimate === true,
    wantsManager: value.wantsManager === true,
    clientConfirmedComplete: value.clientConfirmedComplete === true,
  };
}

function normalizeClient(input = {}) {
  const clientId = clean(input.clientId, 120);
  const conversationId = clean(input.conversationId, 120);
  if (!clientId) throw new Error("CLIENT_ID_REQUIRED");
  if (!conversationId) throw new Error("CONVERSATION_ID_REQUIRED");
  const at = clean(input.at, 64) || new Date().toISOString();
  return {
    clientId,
    conversationId,
    surface: clean(input.surface, 40) || "GO_CLIENT",
    latestText: clean(input.latestText, 500),
    interpreted: safeResult(input.interpreted),
    firstSeenAt: clean(input.firstSeenAt, 64) || at,
    lastSeenAt: at,
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export class GoHubClientRegistryState {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const stored = await this.ctx.storage.get(STORE_KEY);
      const clients = Array.isArray(stored) ? stored : [];

      if (request.method === "POST" && url.pathname === "/upsert") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);
        const next = normalizeClient(body);
        const prior = clients.find(item => item.clientId === next.clientId);
        const merged = prior ? { ...prior, ...next, firstSeenAt: prior.firstSeenAt || next.firstSeenAt } : next;
        const rest = clients.filter(item => item.clientId !== next.clientId);
        const ordered = [merged, ...rest].sort((a,b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt))).slice(0, MAX_CLIENTS);
        await this.ctx.storage.put(STORE_KEY, ordered);
        return json({ ok:true, client:merged }, prior ? 200 : 201);
      }

      if (request.method === "GET" && url.pathname === "/list") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
        return json({ ok:true, clients:clients.slice(0, limit), count:clients.length });
      }

      return json({ code:"NOT_FOUND" }, 404);
    } catch (error) {
      return json({ code:error?.message || "CLIENT_REGISTRY_ERROR" }, 400);
    }
  }
}

export function createClientRegistryService({ namespace = null } = {}) {
  function stub() {
    if (!namespace || typeof namespace.getByName !== "function") return null;
    return namespace.getByName("yggmetro-client-registry-v1");
  }

  return Object.freeze({
    async upsert(input) {
      const target = stub();
      if (!target) return json({ code:"CLIENT_REGISTRY_NOT_CONFIGURED" }, 503);
      return target.fetch(new Request("https://client-registry.internal/upsert", {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(input),
      }));
    },
    async list({ limit = 50 } = {}) {
      const target = stub();
      if (!target) return json({ code:"CLIENT_REGISTRY_NOT_CONFIGURED" }, 503);
      return target.fetch(new Request("https://client-registry.internal/list?limit=" + encodeURIComponent(String(limit))));
    },
  });
}

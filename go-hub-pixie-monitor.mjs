const PIXIE_MONITOR_INITIAL_MS = 15_000;
const PIXIE_MONITOR_MAX_MS = 120_000;

function nextMonitorDelay(attempt = 0) {
  return Math.min(PIXIE_MONITOR_INITIAL_MS * (2 ** Math.max(0, Number(attempt) || 0)), PIXIE_MONITOR_MAX_MS);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers:{ "content-type":"application/json; charset=utf-8" } });
}

export class GoHubPixieMonitorState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
  }

  async watch({ requestId, workContext } = {}) {
    const id = String(requestId || "").trim();
    if (!id) return json({ code:"PIXIE_REQUEST_ID_INVALID" }, 400);
    const current = await this.storage.get("pending") || {};
    current[id] = { requestId:id, workContext:workContext || null, status:"WAIT", monitorAttempt:0, updatedAt:new Date().toISOString() };
    await this.storage.put("pending", current);
    await this.storage.setAlarm(Date.now() + nextMonitorDelay(0));
    return json({ ok:true, status:"WATCHING", requestId:id });
  }

  async read(requestId) {
    const current = await this.storage.get("pending") || {};
    return current[String(requestId || "").trim()] || null;
  }

  async alarm() {
    const current = await this.storage.get("pending") || {};
    const ids = Object.keys(current);
    if (!ids.length || !this.env?.GITHUB_TOKEN) {
      if (ids.length) {
        const attempt = Math.min(...ids.map(id => Number(current[id]?.monitorAttempt) || 0));
        await this.storage.setAlarm(Date.now() + nextMonitorDelay(attempt));
      }
      return;
    }
    const { createPixieCommandService } = await import("./go-hub-pixie-service.mjs");
    const pixie = createPixieCommandService({ token:this.env.GITHUB_TOKEN });
    let waiting = false;
    for (const id of ids) {
      const response = await pixie.result({ requestId:id });
      const body = await response.json().catch(() => null);
      if (body?.status === "WAIT") {
        waiting = true;
        current[id] = { ...current[id], monitorAttempt:(Number(current[id]?.monitorAttempt) || 0) + 1, updatedAt:new Date().toISOString() };
        continue;
      }
      current[id] = { ...current[id], status:body?.status || "UNKNOWN", result:body?.result || null, evidenceRef:body?.evidenceRef || null, updatedAt:new Date().toISOString() };
    }
    await this.storage.put("pending", current);
    if (waiting) {
      const waitingIds = ids.filter(id => current[id]?.status === "WAIT");
      const attempt = waitingIds.length ? Math.min(...waitingIds.map(id => Number(current[id]?.monitorAttempt) || 0)) : 0;
      await this.storage.setAlarm(Date.now() + nextMonitorDelay(attempt));
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/watch") return this.watch(await request.json().catch(() => ({})));
    if (request.method === "GET" && url.pathname === "/read") return json({ ok:true, watch:await this.read(url.searchParams.get("requestId")) });
    return json({ code:"NOT_FOUND" }, 404);
  }
}

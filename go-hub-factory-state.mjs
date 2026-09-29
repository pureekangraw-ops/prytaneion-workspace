import { createFactoryStatePort } from "./go-hub-factory-state-core.mjs";
import { createFactoryController } from "./go-hub-factory-task-controller.mjs";
import { createGithubLifecycleService } from "./go-hub-worker.mjs";

const FACTORY_MONITOR_MS = 15_000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export class GoHubFactoryState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.port = createFactoryStatePort({ storage: ctx.storage });
  }

  async load() {
    return this.port.load();
  }

  async save(input) {
    const saved = await this.port.save(input);
    await this.scheduleMonitor(saved?.task);
    return saved;
  }

  async scheduleMonitor(task) {
    if (!this.storage || typeof this.storage.setAlarm !== "function") return;
    const waiting = task?.state === "CI_RUNNING" || task?.nextAction === "check-ci" || task?.state === "DEPLOYING" || task?.nextAction === "track-deploy";
    if (waiting) await this.storage.setAlarm(Date.now() + FACTORY_MONITOR_MS);
  }

  async alarm() {
    const stored = await this.port.load();
    const task = stored?.task;
    if (!task) return;
    const action = (task.state === "CI_RUNNING" || task.nextAction === "check-ci") ? "check_ci" : ((task.state === "DEPLOYING" || task.nextAction === "track-deploy") ? "track_deploy" : null);
    if (!action) return;
    if (!this.env?.GITHUB_TOKEN) {
      await this.storage.setAlarm(Date.now() + FACTORY_MONITOR_MS);
      return;
    }
    const lifecycle = createGithubLifecycleService({ fetchImpl:fetch, token:this.env.GITHUB_TOKEN });
    const controller = createFactoryController({ lifecycle, state:{ load:()=>this.port.load(), save:input=>this.port.save(input) } });
    const result = await controller.execute({ taskId:task.id, action, expectedRevision:stored.revision });
    const stillWaiting = result?.task?.state === "CI_RUNNING" || result?.task?.nextAction === "check-ci" || result?.task?.state === "DEPLOYING" || result?.task?.nextAction === "track-deploy";
    if (stillWaiting) await this.storage.setAlarm(Date.now() + FACTORY_MONITOR_MS);
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/load") {
        return json(await this.load());
      }
      if (request.method === "POST" && url.pathname === "/save") {
        const input = await request.json().catch(() => null);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          return json({ code: "INVALID_JSON" }, 400);
        }
        return json(await this.save(input));
      }
      return json({ code: "NOT_FOUND" }, 404);
    } catch (error) {
      return json({ code: error?.message || "FACTORY_STATE_ERROR" }, 400);
    }
  }
}

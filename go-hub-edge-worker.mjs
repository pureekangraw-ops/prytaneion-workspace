import githubWorker, { createGithubLifecycleService } from "./go-hub-worker.mjs";
import { createBrowserInterface } from "./go-hub-browser-interface.js";
import { createFactoryMcpWorker, createCounterDispatchLifecycle } from "./go-hub-factory-mcp-worker.mjs";
import { createFactoryActionService, createFactoryV4Service } from "./go-hub-factory-service.mjs";
import { createCloudflareService } from "./go-hub-cloudflare-service.mjs";
import { createDeploymentProvenanceReader } from "./go-hub-deployment-provenance.mjs";
import { createProjectStatusReadService } from "./go-hub-project-status-service.mjs";
import { correlateControlRoomTruth } from "./go-hub-control-room.js";
import { createAccessToken } from "./go-hub-oauth.mjs";
import { ObserverSessionRegistry } from "./go-hub-browser-observer-session.js";
import { createCentreLiveService } from "./go-hub-centre-live.mjs";
import { createBroadcastService } from "./go-hub-broadcast-state.mjs";
import { createNotionLightService } from "./go-hub-notion-light.mjs";
import { createCounterService } from "./go-hub-counter.mjs";
import { createCounterDispatchService } from "./go-hub-counter-dispatcher.mjs";
import { createGoHubV4, CUTOVER_CONTRACT } from "./go-hub-v4-cutover.mjs";
import {
  createLighthouseControlPortHttpService,
  createLighthouseControlPortMcpService,
  LIGHTHOUSE_CONTROL_PORT_API_ROOT,
  LIGHTHOUSE_CONTROL_PORT_OWNER_PATH,
} from "./go-hub-lighthouse-control-port-service.mjs";
export { HephaestusForeman } from "./go-hub-factory-controller.mjs";
export { createGoHubV4, CUTOVER_CONTRACT };
export { GoHubFactoryState } from "./go-hub-factory-state.mjs";
export { ObserverSessionRegistry } from "./go-hub-browser-observer-session.js";
export { GoHubCentreState } from "./go-hub-centre-live.mjs";
export { GoHubGlobalAuditLog } from "./go-hub-global-audit.mjs";
export { GoHubCounterState, GoHubCounterInboxState } from "./go-hub-counter.mjs";
export { GoHubCounterDispatchState } from "./go-hub-counter-dispatcher.mjs";
export { GoHubNotionLightState } from "./go-hub-notion-light.mjs";
export { GoHubMaintenanceState } from "./go-hub-maintenance-state.mjs";
export { GoHubBroadcastState } from "./go-hub-broadcast-state.mjs";
export { LighthouseControlPortSessionRegistry } from "./go-hub-lighthouse-control-port-session.js";

const CENTRE_API_ROOT = "/hub/api/centre";
const COUNTER_API_ROOT = "/hub/api/counter";
const BROWSER_API_ROOT = "/hub/api/browser";
const OBSERVER_API_ROOT = `${BROWSER_API_ROOT}/observer`;
const FACTORY_ACTION_PATH = "/hub/api/github-workspace/factory-action";
const CONTROL_ROOM_PATH = "/hub/api/centre/control-room";
const LIGHT_MCP_OWNER_PATH = "/hub/light-mcp";
const LIGHT_MCP_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

async function edgeBroadcastSpeaker(env, area, observed = null) {
  if (!env?.GO_HUB_BROADCAST_STATE) return { ok:true, current:null };
  const heard = await createBroadcastService({ namespace:env.GO_HUB_BROADCAST_STATE }).speaker({ area, observed });
  if (!heard?.ok) return { ok:false, response:json(heard, 409) };
  return { ok:true, current:heard.current || null };
}

async function withBroadcastReadback(response, current) {
  if (!current) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response;
  return json({ ...payload, broadcastReadback:current }, response.status, Object.fromEntries(response.headers.entries()));
}

function browserPolicy(policy) {
  if (typeof policy === "string") {
    try {
      return browserPolicy(JSON.parse(policy));
    } catch {
      return { allowedHostnames: [], requireOwnerPasscode: false };
    }
  }
  if (!policy || typeof policy !== "object") {
    return { allowedHostnames: [], requireOwnerPasscode: false };
  }
  return {
    allowedHostnames: Array.isArray(policy.allowedHostnames)
      ? policy.allowedHostnames.filter(value => typeof value === "string" && value.trim())
      : [],
    requireOwnerPasscode: policy.requireOwnerPasscode === true,
  };
}

function timingSafeEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length, 1);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index % Math.max(a.length, 1)] || 0) ^
      (b[index % Math.max(b.length, 1)] || 0);
  }
  return difference === 0;
}

function assertFactoryWorkContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("workContext is required");
  for (const field of ["workId", "checkpointId", "returnAddress", "destination", "task", "requestedResult", "lensReference"]) {
    if (!String(value[field] || "").trim()) throw new Error("workContext missing field: " + field);
  }
  if (String(value.checkpointId) !== String(value.returnAddress)) throw new Error("workContext Return Address must match Checkpoint ID");
  if (String(value.destination) !== "destination://factory") throw new Error("workContext destination must be destination://factory");
  return value;
}

function isBrowserApiPath(pathname) {
  return pathname === BROWSER_API_ROOT || pathname.startsWith(`${BROWSER_API_ROOT}/`);
}

function isObserverApiPath(pathname) {
  return pathname === OBSERVER_API_ROOT || pathname.startsWith(`${OBSERVER_API_ROOT}/`);
}

function gumroadOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "gumroad.com" || host.endsWith(".gumroad.com"))
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function corsFor(request) {
  const origin = gumroadOrigin(request.headers.get("origin"));
  if (!origin) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-go-observer-session-id, x-go-observer-session-token",
    "access-control-max-age": "600",
    "vary": "Origin",
  };
}

function ownerAuthFailure(request, env, policy) {
  if (!policy.requireOwnerPasscode) return null;
  const configuredPasscode = String(env?.GOHUB_OWNER_PASSCODE || "");
  if (!configuredPasscode) return json({ code: "BROWSER_OWNER_AUTH_NOT_CONFIGURED" }, 503);
  const suppliedPasscode = String(request.headers.get("x-go-owner-passcode") || "");
  if (!timingSafeEqual(suppliedPasscode, configuredPasscode)) {
    return json({ code: "BROWSER_OWNER_AUTH_FAILED" }, 403);
  }
  return null;
}

function observerSessionsFor(injected, env) {
  if (injected) return injected;
  if (env?.OBSERVER_SESSIONS && typeof env.OBSERVER_SESSIONS.getByName === "function") {
    const durable = env.OBSERVER_SESSIONS.getByName("go-browser-observer-v1");
    if (!durable) return null;
    if (typeof durable.fetch !== "function") return durable;
    const call = async (path, input = {}) => {
      const response = await durable.fetch(new Request("https://observer-session.internal/" + path, {
        method:"POST",
        headers:{ "content-type":"application/json" },
        body:JSON.stringify(input),
      }));
      const body = await response.json().catch(() => ({ code:"HUB_UNAVAILABLE" }));
      return response.ok ? body : { ok:false, code:body?.code || "HUB_UNAVAILABLE" };
    };
    return Object.freeze({
      start:input => call("start", input),
      acceptSnapshot:input => call("snapshot", input),
      read:input => call("read", input),
      stop:input => call("stop", input),
      grantScreenshot:input => call("grant-screenshot", input),
      consumeScreenshot:input => call("consume-screenshot", input),
      storeScreenshot:input => call("store-screenshot", input),
      latest:() => call("latest"),
      screenshot:input => call("screenshot", input),
    });
  }
  return null;
}

function sessionCredentials(request) {
  return {
    sessionId: String(request.headers.get("x-go-observer-session-id") || ""),
    sessionToken: String(request.headers.get("x-go-observer-session-token") || ""),
  };
}

function observerStatus(code) {
  if (code === "SCHEMA_REJECTED") return 400;
  if (code === "SESSION_EXPIRED") return 410;
  if (code === "STALE_PAGE") return 409;
  if (code === "HUB_UNAVAILABLE") return 503;
  return 403;
}

async function authorizeLighthouseRoom(request, env) {
  const url = new URL(request.url);
  const workId = String(url.searchParams.get("work_id") || "").trim();
  const actor = String(url.searchParams.get("actor") || "").trim();
  if (!workId || !actor) {
    return { ok:false, response:json({ code:"LIGHTHOUSE_CENTRE_PASS_REQUIRED" }, 403) };
  }
  const inspected = await createCentreLiveService({ namespace:env?.GO_HUB_CENTRE_STATE }).action({
    action:"v4_inspect",
    workId,
  });
  if (!inspected.ok) return { ok:false, response:inspected };
  const payload = await inspected.clone().json().catch(() => ({}));
  const work = payload?.work;
  const pass = work?.pass;
  const allowed = Array.isArray(pass?.allowedDestinations) ? pass.allowedDestinations.map(value => String(value || "").trim()) : [];
  const authorized = work?.status === "ON PROCESS" &&
    String(work?.holder || "").trim() === actor &&
    pass?.state === "ACTIVE" &&
    (allowed.includes("lighthouse") || allowed.includes("ALL_GO_HUB_OWNED_AREAS"));
  if (!authorized) {
    return { ok:false, response:json({ code:"LIGHTHOUSE_CENTRE_PASS_REQUIRED" }, 403) };
  }
  return { ok:true, workId, actor };
}

function lightMcpOwnerPage(result = null) {
  const resultHtml = result
    ? `<section><h2>LIGHT MCP ready</h2><p>MCP URL</p><textarea readonly rows="2" style="width:100%">${result.mcpUrl}</textarea><p>Bearer token (expires ${result.expiresLabel})</p><textarea readonly rows="6" style="width:100%">${result.token}</textarea><p>Connect this as a custom MCP server in Notion Agent and enable only the code tools you need.</p></section>`
    : "";
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GO Hub LIGHT MCP</title></head><body style="font-family:system-ui;max-width:760px;margin:48px auto;padding:0 20px"><h1>GO Hub × LIGHT</h1><p>Mint a scoped bearer token for LIGHT. This token can only authenticate to the restricted <code>/mcp/light</code> surface; merge/delete are not exposed there.</p><form method="post"><label>Owner passcode <input name="passcode" type="password" autocomplete="current-password" required></label><button type="submit">Create LIGHT token</button></form>${resultHtml}</body></html>`, {
    headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" },
  });
}

function observerOwnerPage() {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GO Eye Session</title></head><body><h1>GO Browser Eye</h1><p>Create Eye Session on GO Hub, then copy the bootstrap code into the Firefox Observer. The owner passcode stays on this GO Hub page and is never stored by the Observer.</p><form id="eye-form"><label>Owner passcode<input id="passcode" type="password" autocomplete="current-password" required></label><label>Allowed Gumroad origin<input id="origin" value="https://gumroad.com" required></label><button type="submit">Create Eye Session</button></form><label>GO Hub bootstrap<textarea id="bootstrap" readonly placeholder="Bootstrap appears here"></textarea></label><p id="status"></p><script>const form=document.getElementById('eye-form'),out=document.getElementById('bootstrap'),status=document.getElementById('status');form.addEventListener('submit',async e=>{e.preventDefault();out.value='';status.textContent='Creating…';try{const r=await fetch('/hub/api/browser/observer/session/start',{method:'POST',headers:{'content-type':'application/json','x-go-owner-passcode':document.getElementById('passcode').value},body:JSON.stringify({allowed_origin:document.getElementById('origin').value})});const body=await r.json();if(!r.ok)throw new Error(body.code||'SESSION_START_FAILED');out.value=JSON.stringify(body);document.getElementById('passcode').value='';status.textContent='Bootstrap ready. Copy it into GO Eye.';}catch(err){document.getElementById('passcode').value='';status.textContent=err.message||'SESSION_START_FAILED';}});</script></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

async function controlRoomRead({ request, env, fetchImpl }) {
  const url = new URL(request.url);
  const workId = String(url.searchParams.get("workId") || "").trim();
  const checkpointId = String(url.searchParams.get("checkpointId") || "").trim();
  if (!workId || !checkpointId) return json({ code:"CONTROL_ROOM_WORK_CONTEXT_REQUIRED" }, 400);

  const centreResponse = await createCentreLiveService({ namespace:env?.GO_HUB_CENTRE_STATE }).action({
    action:"v4_inspect",
    workId,
    checkpointId,
  });
  const centre = await centreResponse.clone().json().catch(() => ({}));
  if (!centreResponse.ok || !centre?.work) return json({ code:centre?.code || "CONTROL_ROOM_CENTRE_UNAVAILABLE" }, centreResponse.status || 503);

  let projectStatus = { status:"UNKNOWN", reason:"PROJECT_STATUS_UNAVAILABLE" };
  let github = { status:"UNKNOWN", reason:"GITHUB_READER_UNAVAILABLE" };
  if (env?.GITHUB_TOKEN) {
    try {
      const lifecycle = createGithubLifecycleService({ fetchImpl, token:env.GITHUB_TOKEN });
      projectStatus = await createProjectStatusReadService({
        lifecycle,
        factoryBinding:env?.GO_HUB_FACTORY_STATE,
      }).read({ targetId:"standard" });
      const source = projectStatus.sources?.find(item => item.source === "github");
      github = source?.detail ? {
        status:source.freshness || "LIVE",
        repository:source.detail.repo,
        branch:source.detail.branch,
        headSha:source.detail.sha,
        evidenceRef:`github://${source.detail.repo}@${source.detail.branch}#${source.detail.sha}`,
      } : github;
    } catch (error) {
      projectStatus = { status:"UNKNOWN", reason:error?.message || "PROJECT_STATUS_READ_FAILED" };
    }
  }

  let factory = { status:"UNKNOWN", reason:"FACTORY_V4_NOT_FOUND" };
  try {
    const response = await createFactoryV4Service({ binding:env?.GO_HUB_FACTORY_STATE })({ action:"inspect", workId });
    const payload = await response.json().catch(() => ({}));
    factory = response.ok ? payload : { status:"UNKNOWN", reason:payload?.code || "FACTORY_V4_READ_FAILED" };
  } catch (error) {
    factory = { status:"UNKNOWN", reason:error?.message || "FACTORY_V4_READ_FAILED" };
  }

  let cloudflare = { status:"UNKNOWN", reason:"CLOUDFLARE_RUNTIME_READER_UNAVAILABLE" };
  const cfToken = env?.CLOUDFLARE_RUNTIME_API_TOKEN || env?.CLOUDFLARE_API_TOKEN || env?.CLOUDFLARE_TOKEN;
  const cfAccount = env?.CLOUDFLARE_ACCOUNT_ID || env?.CF_ACCOUNT_ID;
  if (cfToken && cfAccount) {
    try {
      const service = createCloudflareService({ fetchImpl, token:cfToken, accountId:cfAccount });
      const [healthResponse, inspectResponse] = await Promise.all([
        service.health(),
        service.inspectWorker({ scriptName:"go-hub" }),
      ]);
      const health = await healthResponse.json().catch(() => ({}));
      const inspected = await inspectResponse.json().catch(() => ({}));
      const deployment = Array.isArray(inspected?.deployments) ? (inspected.deployments[0] || null) : null;
      const provenance = inspectResponse.ok && deployment && env?.GITHUB_TOKEN
        ? await createDeploymentProvenanceReader({ fetchImpl, token:env.GITHUB_TOKEN }).read({ deployment })
        : { status:"UNKNOWN", reason:"DEPLOYMENT_RECEIPT_READER_UNAVAILABLE" };
      const verifiedDeployment = provenance.status === "VERIFIED"
        ? { ...deployment, sourceSha:provenance.sourceSha, evidenceRef:provenance.evidenceRef }
        : deployment;
      cloudflare = healthResponse.ok ? {
        status:health?.upstream === "PASS" ? "LIVE" : "UNKNOWN",
        health,
        worker:inspected?.worker || null,
        deployment:verifiedDeployment,
        provenance,
        deploymentsStatus:inspected?.deploymentsStatus || (inspectResponse.ok ? "PASS" : "UNKNOWN"),
        evidenceRef:provenance.status === "VERIFIED" ? provenance.evidenceRef : (deployment?.id ? `cloudflare://workers/go-hub/deployments/${deployment.id}` : null),
      } : {
        status:"UNKNOWN",
        reason:health?.code || "CLOUDFLARE_HEALTH_FAILED",
      };
    } catch (error) {
      cloudflare = { status:"UNKNOWN", reason:error?.message || "CLOUDFLARE_HEALTH_FAILED" };
    }
  }

  let board = { status:"UNKNOWN", reason:"BOARD_RUNTIME_UNAVAILABLE" };
  try {
    const response = await createLighthouseControlPortMcpService({
      namespace:env?.LIGHTHOUSE_CONTROL_PORT_SESSIONS,
    }).boardRead();
    const payload = await response.json().catch(() => ({}));
    board = response.ok ? {
      ...payload,
      status:"LIVE",
      evidenceRef:payload?.boardId ? `board://${payload.boardId}@${payload.revision ?? 0}` : null,
    } : {
      status:"UNKNOWN",
      reason:payload?.code || "BOARD_RUNTIME_READ_FAILED",
    };
  } catch (error) {
    board = { status:"UNKNOWN", reason:error?.message || "BOARD_RUNTIME_READ_FAILED" };
  }

  const controls = [
    { id:"refresh-observations", label:"Refresh observations", mode:"READ", available:true },
  ];
  const toolReality = {
    centre:{ exposed:true, configured:Boolean(env?.GO_HUB_CENTRE_STATE), authenticated:true, status:centre?.work ? "LIVE" : "UNKNOWN" },
    github:{ exposed:true, configured:Boolean(env?.GITHUB_TOKEN), authenticated:Boolean(env?.GITHUB_TOKEN), status:github.status, evidenceRef:github.evidenceRef },
    factory:{ exposed:true, configured:Boolean(env?.GO_HUB_FACTORY_STATE), authenticated:true, status:factory.status || "UNKNOWN" },
    cloudflare:{ exposed:true, configured:Boolean(cfToken && cfAccount), authenticated:Boolean(cfToken && cfAccount), status:cloudflare.status, evidenceRef:cloudflare.evidenceRef },
    board:{ exposed:true, configured:Boolean(env?.LIGHTHOUSE_CONTROL_PORT_SESSIONS), authenticated:true, status:board.status, evidenceRef:board.evidenceRef },
    notionLight:{ exposed:true, configured:Boolean(env?.GO_HUB_NOTION_LIGHT_STATE), authenticated:false, status:"UNKNOWN", reason:"AUTH_STATE_REQUIRES_LIVE_STATUS_READ" },
    observer:{ exposed:true, configured:Boolean(env?.OBSERVER_SESSIONS), authenticated:false, status:"UNKNOWN", reason:"SESSION_STATE_REQUIRES_LIVE_READ" },
    pixie:{ exposed:true, configured:Boolean(env?.GITHUB_TOKEN), authenticated:Boolean(env?.GITHUB_TOKEN), status:"UNKNOWN", reason:"REQUEST_BOUND_RUNTIME" },
    counter:{ exposed:true, configured:Boolean(env?.GO_HUB_COUNTER_STATE && env?.GO_HUB_COUNTER_DISPATCH_STATE), authenticated:true, status:"UNKNOWN", reason:"TICKET_BOUND_RUNTIME" },
  };
  const observations = correlateControlRoomTruth({
    centre:{ status:centre.work.status, workStatus:centre.work.status },
    projectStatus,
    factory:{ status:factory.status || "UNKNOWN" },
    board, github, cloudflare,
    toolReality,
    capabilities:controls,
    autoRefresh:true,
  });
  return json({
    ok:true, room:"GO_CONTROL_ROOM", entryAuthority:"GO", mode:"LIVE_OBSERVATION_AND_AVAILABLE_CONTROLS",
    workId, checkpointId, observedAt:new Date().toISOString(),
    centre:centre.work, projectStatus, factory, board, github, cloudflare,
    toolReality:observations.toolReality,
    observations, controls:observations.availableControls,
  });
}

export function createEdgeWorkerHandler({ delegate = githubWorker, factoryMcp = createFactoryMcpWorker(), fetchImpl = fetch, observerSessions = null } = {}) {
  if (!delegate || typeof delegate.fetch !== "function") {
    throw new Error("edge delegate fetch is required");
  }
  if (!factoryMcp || typeof factoryMcp.fetch !== "function") {
    throw new Error("Factory MCP handler is required");
  }

  return Object.freeze({
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === LIGHT_MCP_OWNER_PATH) {
        if (request.method === "GET") return lightMcpOwnerPage();
        if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
        if (!env?.GOHUB_MASTER_KEY || !env?.GOHUB_OWNER_PASSCODE) {
          return json({ code:"LIGHT_MCP_AUTH_NOT_CONFIGURED" }, 503);
        }
        const form = await request.formData().catch(() => null);
        const supplied = String(form?.get("passcode") || "");
        if (!timingSafeEqual(supplied, env.GOHUB_OWNER_PASSCODE)) {
          return json({ code:"OWNER_AUTH_FAILED" }, 403);
        }
        const token = await createAccessToken({
          issuer:url.origin,
          signingKey:env.GOHUB_MASTER_KEY,
          resource:url.origin + "/mcp/light",
          subject:"light",
          scope:"go-hub-light",
          ttlSeconds:LIGHT_MCP_TOKEN_TTL_SECONDS,
        });
        return lightMcpOwnerPage({
          mcpUrl:url.origin + "/mcp/light",
          token,
          expiresLabel:"in 30 days",
        });
      }
      if (url.pathname === "/mcp" || url.pathname === "/mcp/light") {
        return factoryMcp.fetch(request, env);
      }
      if (request.method === "GET" && url.pathname === "/hub/api/notion-light/callback") {
        const notionLight = createNotionLightService({ namespace:env?.GO_HUB_NOTION_LIGHT_STATE });
        const result = await notionLight.callback({
          code:url.searchParams.get("code"),
          state:url.searchParams.get("state"),
          iss:url.searchParams.get("iss"),
          error:url.searchParams.get("error"),
          error_description:url.searchParams.get("error_description"),
        });
        const payload = await result.json().catch(() => ({}));
        if (!result.ok || payload?.ok !== true) {
          return new Response(
            `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notion connection failed</title></head><body><h1>Notion connection failed</h1><p>${String(payload?.code || "NOTION_LIGHT_OAUTH_FAILED")}</p><p>Return to ChatGPT and retry the same Counter ticket.</p></body></html>`,
            { status:result.status || 400, headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } },
          );
        }
        return new Response(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notion connected</title></head><body><h1>Notion connected ✅</h1><p>LIGHT is now connected to your Notion workspace.</p><p>You can return to ChatGPT. GO can retry the same Counter ticket.</p></body></html>`,
          { status:200, headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" } },
        );
      }
      if (url.pathname === `${COUNTER_API_ROOT}/ask`) {
        if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);
        const question = String(body.question || body.request || "").trim();
        if (!question) return json({ code:"COUNTER_QUESTION_REQUIRED" }, 400);
        return createNotionLightService({ namespace:env?.GO_HUB_NOTION_LIGHT_STATE }).search({ query:question });
      }
      if (url.pathname === `${COUNTER_API_ROOT}/inbox` || url.pathname === `${COUNTER_API_ROOT}/pickup`) {
        if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);

        const workId = String(body.workId || "").trim();
        const checkpointId = String(body.checkpointId || "").trim();
        if (!workId) return json({ code:"COUNTER_WORK_REQUIRED" }, 400);
        if (!checkpointId) return json({ code:"COUNTER_CHECKPOINT_REQUIRED" }, 400);

        const centreLive = createCentreLiveService({ namespace:env?.GO_HUB_CENTRE_STATE });
        const inspected = await centreLive.action({ action:"v4_inspect", workId });
        if (!inspected.ok) return inspected;
        const centre = await inspected.clone().json().catch(() => ({}));
        if (String(centre?.work?.workId || "") !== workId) {
          return json({ code:"COUNTER_CENTRE_IDENTITY_MISMATCH" }, 409);
        }

        const ownership = centre.ownership && typeof centre.ownership === "object" ? centre.ownership : {};
        const workContext = {
          workId,
          checkpointId,
          returnAddress:checkpointId,
          ...(ownership.ownerId ? { ownerId:String(ownership.ownerId) } : {}),
          ...(ownership.leaseId ? { leaseId:String(ownership.leaseId) } : {}),
          ...(Number.isSafeInteger(ownership.revision) ? { ownershipRevision:ownership.revision } : {}),
        };
        const counter = createCounterService({
          namespace:env?.GO_HUB_COUNTER_STATE,
          inboxNamespace:env?.GO_HUB_COUNTER_INBOX,
        });

        if (url.pathname === `${COUNTER_API_ROOT}/inbox`) {
          const limit = Math.min(Math.max(Number(body.limit || 10), 1), 50);
          return counter.inbox({ actor:"GO", workContext, limit });
        }

        const counterId = String(body.counterId || "").trim();
        if (!counterId) return json({ code:"COUNTER_ID_REQUIRED" }, 400);
        return counter.seen({ counterId, actor:"GO", workContext });
      }
      if (url.pathname === `${COUNTER_API_ROOT}/handoff`) {
        if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code:"INVALID_JSON" }, 400);

        const workId = String(body.workId || "").trim();
        const checkpointId = String(body.checkpointId || "").trim();
        if (!workId) return json({ code:"COUNTER_WORK_REQUIRED" }, 400);
        if (!checkpointId) return json({ code:"COUNTER_CHECKPOINT_REQUIRED" }, 400);

        const centreLive = createCentreLiveService({ namespace:env?.GO_HUB_CENTRE_STATE });
        const inspected = await centreLive.action({ action:"v4_inspect", workId });
        if (!inspected.ok) return inspected;
        const centre = await inspected.clone().json().catch(() => ({}));
        if (String(centre?.work?.workId || "") !== workId) {
          return json({ code:"COUNTER_CENTRE_IDENTITY_MISMATCH" }, 409);
        }

        const requestText = String(body.request || "").trim();
        const requestedResult = String(body.requestedResult || "").trim();
        if (!requestText) return json({ code:"COUNTER_REQUEST_REQUIRED" }, 400);
        if (!requestedResult) return json({ code:"COUNTER_REQUESTED_RESULT_REQUIRED" }, 400);

        const counter = createCounterService({
          namespace:env?.GO_HUB_COUNTER_STATE,
          inboxNamespace:env?.GO_HUB_COUNTER_INBOX,
        });
        const dispatch = createCounterDispatchService({
          namespace:env?.GO_HUB_COUNTER_DISPATCH_STATE,
          hubOrigin:url.origin,
        });
        const notionLight = createNotionLightService({ namespace:env?.GO_HUB_NOTION_LIGHT_STATE });
        const lifecycle = createCounterDispatchLifecycle({ counter, dispatch, notionLight, hubOrigin:url.origin });
        const counterId = String(body.counterId || "").trim() || ("COUNTER-WEB-" + crypto.randomUUID());
        const ownership = centre.ownership && typeof centre.ownership === "object" ? centre.ownership : {};
        const workContext = {
          workId,
          checkpointId,
          returnAddress:checkpointId,
          ...(ownership.ownerId ? { ownerId:String(ownership.ownerId) } : {}),
          ...(ownership.leaseId ? { leaseId:String(ownership.leaseId) } : {}),
          ...(Number.isSafeInteger(ownership.revision) ? { ownershipRevision:ownership.revision } : {}),
        };
        return lifecycle.create({
          counterId,
          mode:"HANDOFF",
          fromActor:"GO",
          toActor:"LIGHT",
          request:requestText,
          requestedResult,
          authority:String(body.authority || "BIG"),
          target:body.target == null ? null : String(body.target),
          projectRef:body.projectRef == null ? "GO Hub" : String(body.projectRef),
          workContext,
          context:{ source:"GO Hub Counter panel" },
          sourceHints:Array.isArray(body.sourceHints) ? body.sourceHints.map(String) : [],
          doNotChange:["Do not create a new Work or Checkpoint"],
        });
      }
      if (request.method === "GET" && url.pathname === "/hub/observer") {
        return observerOwnerPage();
      }
      if (url.pathname === LIGHTHOUSE_CONTROL_PORT_OWNER_PATH ||
          url.pathname.startsWith(LIGHTHOUSE_CONTROL_PORT_API_ROOT + "/")) {
        const ownerRoomPath = url.pathname === LIGHTHOUSE_CONTROL_PORT_OWNER_PATH ||
          url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/owner-state` ||
          url.pathname === `${LIGHTHOUSE_CONTROL_PORT_API_ROOT}/owner-command`;
        if (ownerRoomPath) {
          const access = await authorizeLighthouseRoom(request, env);
          if (!access.ok) return access.response;
        }
        return createLighthouseControlPortHttpService({
          namespace:env?.LIGHTHOUSE_CONTROL_PORT_SESSIONS,
          ownerPasscode:env?.GOHUB_OWNER_PASSCODE,
        }).fetch(request);
      }
      if (request.method === "GET" && url.pathname === CONTROL_ROOM_PATH) {
        return controlRoomRead({ request, env, fetchImpl });
      }
      if (url.pathname === `${CENTRE_API_ROOT}/action`) {
        if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "INVALID_JSON" }, 400);
        const speaker = await edgeBroadcastSpeaker(env, "centre-http", body.broadcast || null);
        if (!speaker.ok) return speaker.response;
        const routedBody = { ...body };
        delete routedBody.broadcast;
        const response = await createCentreLiveService({ namespace: env?.GO_HUB_CENTRE_STATE }).action(routedBody);
        if (response.ok) {
          const view = await response.clone().json().catch(() => null);
          if (view?.ok) {
            try {
              await createLighthouseControlPortMcpService({
                namespace:env?.LIGHTHOUSE_CONTROL_PORT_SESSIONS,
              }).projectCentre(view);
            } catch {}
          }
        }
        return withBroadcastReadback(response, speaker.current);
      }
      if (request.method === "POST" && url.pathname === FACTORY_ACTION_PATH) {
        return json({
          code:"FACTORY_LEGACY_ROUTE_QUARANTINED",
          compatibility:"SOURCE_ONLY",
          nextTool:"go_hub_factory_v4",
        }, 410);
      }
      if (!isBrowserApiPath(url.pathname)) {
        return delegate.fetch(request, env);
      }

      if (isObserverApiPath(url.pathname)) {
        const cors = corsFor(request);
        if (request.method === "OPTIONS") {
          return cors ? new Response(null, { status: 204, headers: cors }) : json({ code: "HOST_BLOCKED" }, 403);
        }
        if (request.method !== "POST") return json({ code: "NOT_FOUND" }, 404, cors || {});

        const sessions = observerSessionsFor(observerSessions, env);
        if (!sessions) return json({ code: "HUB_UNAVAILABLE" }, 503, cors || {});

        if (url.pathname === `${OBSERVER_API_ROOT}/session/start`) {
          const policy = browserPolicy(env?.BROWSER_POLICY);
          if (policy.allowedHostnames.length === 0) return json({ code: "BROWSER_POLICY_NOT_CONFIGURED" }, 503);
          const authFailure = ownerAuthFailure(request, env, policy);
          if (authFailure) return authFailure;
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "INVALID_JSON" }, 400);
          const result = await sessions.start({
            allowedOrigin: String(body.allowed_origin || ""),
            ttlMs: 10 * 60 * 1000,
          });
          if (!result?.ok) return json({ code: result?.code || "HUB_UNAVAILABLE" }, observerStatus(result?.code));
          return json({ ...result, hub_origin: url.origin }, 200);
        }

        const credentials = sessionCredentials(request);
        if (!credentials.sessionId || !credentials.sessionToken) {
          return json({ code: "SESSION_INACTIVE" }, 403, cors || {});
        }

        if (url.pathname === `${OBSERVER_API_ROOT}/snapshot`) {
          const packet = await request.json().catch(() => null);
          if (!packet || typeof packet !== "object" || Array.isArray(packet)) return json({ code: "INVALID_JSON" }, 400, cors || {});
          const result = await sessions.acceptSnapshot({ ...credentials, packet });
          return json(result?.ok ? { ok: true, code: null } : { code: result?.code || "HUB_UNAVAILABLE" },
            result?.ok ? 200 : observerStatus(result?.code), cors || {});
        }

        if (url.pathname === `${OBSERVER_API_ROOT}/session/stop`) {
          const result = await sessions.stop(credentials);
          return json(result?.ok ? { ok: true, code: null } : { code: result?.code || "HUB_UNAVAILABLE" },
            result?.ok ? 200 : observerStatus(result?.code), cors || {});
        }

        if (url.pathname === `${OBSERVER_API_ROOT}/screenshot/consent`) {
          const result = await sessions.grantScreenshot(credentials);
          return json(result?.ok ? { ok: true, code: null } : { code: result?.code || "HUB_UNAVAILABLE" },
            result?.ok ? 200 : observerStatus(result?.code), cors || {});
        }

        if (url.pathname === `${OBSERVER_API_ROOT}/screenshot`) {
          const body = await request.json().catch(() => null);
          if (!body || typeof body !== "object" || Array.isArray(body)) return json({ code: "INVALID_JSON" }, 400, cors || {});
          const result = await sessions.storeScreenshot({
            ...credentials,
            dataUrl: body.data_url,
            pageFingerprint: body.page_fingerprint,
          });
          return json(result?.ok
            ? { ok: true, code: null, screenshot_ref: result.screenshot_ref }
            : { code: result?.code || "HUB_UNAVAILABLE" },
          result?.ok ? 200 : observerStatus(result?.code), cors || {});
        }

        return json({ code: "NOT_FOUND" }, 404, cors || {});
      }

      if (request.method !== "POST" || url.pathname !== `${BROWSER_API_ROOT}/read`) {
        return json({ code: "NOT_FOUND" }, 404);
      }

      const policy = browserPolicy(env?.BROWSER_POLICY);
      if (policy.allowedHostnames.length === 0) {
        return json({ code: "BROWSER_POLICY_NOT_CONFIGURED" }, 503);
      }

      const authFailure = ownerAuthFailure(request, env, policy);
      if (authFailure) return authFailure;

      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json({ code: "INVALID_JSON" }, 400);
      }

      return createBrowserInterface({ browser: env?.BROWSER }).readPage({
        url: body.url,
        waitUntil: body.waitUntil,
        allowedHostnames: policy.allowedHostnames,
      });
    },
  });
}

export default createEdgeWorkerHandler();

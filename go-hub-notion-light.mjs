const NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const NOTION_MCP_RESOURCE = NOTION_MCP_URL;
const MAGNIFICENT_ARCHITECT_AGENT_MENTION = '<mention url="agent://1277043d-9861-8158-a732-000347bf2bab/3e27043d-9861-8026-8e4b-009237cacaec">Magnificent Architect</mention>';
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_SKEW_MS = 60 * 1000;
const MCP_PROTOCOL_VERSION = "2025-11-25";

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type":"application/json; charset=utf-8", ...headers },
  });
}
function html(body, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GO Hub × Notion</title></head><body style="font-family:system-ui;max-width:720px;margin:48px auto;padding:0 20px"><h1>GO Hub × Notion</h1>${body}</body></html>`, {
    status,
    headers:{ "content-type":"text/html; charset=utf-8", "cache-control":"no-store" },
  });
}
function clone(value) { return value == null ? value : structuredClone(value); }
function text(value) { return String(value == null ? "" : value).trim(); }
function safeOrigin(value) {
  const url = new URL(text(value));
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("NOTION_LIGHT_HTTPS_REQUIRED");
  return url.origin;
}
function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}
async function sha256Base64url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(digest));
}
async function fetchJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, init);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}
function contentJson(toolResult) {
  const blocks = Array.isArray(toolResult?.content) ? toolResult.content : [];
  for (const block of blocks) {
    if (block?.type !== "text" || !text(block.text)) continue;
    try { return JSON.parse(block.text); } catch {}
  }
  return null;
}
function firstArray(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.data)) return value.data;
  return [];
}
function pickString(value, keys) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}
function normalizeSearchEvidence(payload, query) {
  const rows = firstArray(payload).slice(0, 10);
  const evidence = rows.map((item, index) => {
    const title = pickString(item, ["title","name","page_title"]);
    const source = pickString(item, ["url","id","source_url","source"]);
    const position = pickString(item, ["path","location","parent","teamspace_name"]) || source;
    const snippet = pickString(item, ["highlight","snippet","text","content"]).slice(0, 500);
    return {
      kind:"notion_ai_search_result",
      rank:index + 1,
      ...(title ? { title } : {}),
      ...(position ? { position } : {}),
      ...(source ? { source } : {}),
      ...(snippet ? { snippet } : {}),
    };
  });
  const sources = [...new Set(evidence.map(item => item.source || item.position).filter(Boolean))];
  const answer = evidence.length
    ? `SEARCH_ONLY — Notion AI Search found ${evidence.length} candidate source${evidence.length === 1 ? "" : "s"}, but no LIGHT Agent answer was produced.`
    : `UNKNOWN — No Notion AI Search results found for: ${query}`;
  return {
    status:"UNKNOWN",
    answer,
    sources:evidence.length ? (sources.length ? sources : ["notion-mcp://ai-search"]) : [],
    evidence:evidence.length ? evidence : [{ kind:"notion_ai_search", query, resultCount:0 }],
    confidence:evidence.length ? "SEARCH_EVIDENCE_ONLY" : "NONE",
    nextRoute:"LIGHT_AGENT",
    resultCount:evidence.length,
    searchOnly:true,
  };
}

export async function discoverNotionOAuth(fetchImpl = fetch) {
  const resourceUrls = [
    "https://mcp.notion.com/mcp/.well-known/oauth-protected-resource",
    "https://mcp.notion.com/.well-known/oauth-protected-resource",
  ];
  let resource = null;
  let lastStatus = 0;
  for (const resourceUrl of resourceUrls) {
    const result = await fetchJson(fetchImpl, resourceUrl, { headers:{ accept:"application/json" } });
    lastStatus = result.response.status;
    if (result.response.ok && Array.isArray(result.payload?.authorization_servers) && result.payload.authorization_servers.length) {
      resource = result.payload;
      break;
    }
  }
  if (!resource) throw Object.assign(new Error("NOTION_MCP_OAUTH_DISCOVERY_FAILED"), { status:lastStatus || 502 });
  const authServer = text(resource.authorization_servers[0]);
  const metadataUrl = new URL("/.well-known/oauth-authorization-server", authServer).toString();
  const metadataResult = await fetchJson(fetchImpl, metadataUrl, { headers:{ accept:"application/json" } });
  if (!metadataResult.response.ok) throw Object.assign(new Error("NOTION_MCP_AUTH_METADATA_FAILED"), { status:metadataResult.response.status });
  const metadata = metadataResult.payload || {};
  if (!text(metadata.authorization_endpoint) || !text(metadata.token_endpoint) || !text(metadata.registration_endpoint)) {
    throw Object.assign(new Error("NOTION_MCP_AUTH_METADATA_INCOMPLETE"), { status:502 });
  }
  return {
    resource,
    metadata:{
      issuer:text(metadata.issuer || authServer),
      authorization_endpoint:text(metadata.authorization_endpoint),
      token_endpoint:text(metadata.token_endpoint),
      registration_endpoint:text(metadata.registration_endpoint),
      scopes_supported:Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.map(String) : [],
    },
  };
}

async function registerClient(fetchImpl, metadata, redirectUri, clientUri) {
  const result = await fetchJson(fetchImpl, metadata.registration_endpoint, {
    method:"POST",
    headers:{ "content-type":"application/json", accept:"application/json" },
    body:JSON.stringify({
      client_name:"GO Hub LIGHT",
      client_uri:clientUri,
      redirect_uris:[redirectUri],
      grant_types:["authorization_code","refresh_token"],
      response_types:["code"],
      token_endpoint_auth_method:"none",
    }),
  });
  if (!result.response.ok || !text(result.payload?.client_id)) {
    throw Object.assign(new Error("NOTION_MCP_CLIENT_REGISTRATION_FAILED"), { status:result.response.status || 502 });
  }
  return {
    clientId:text(result.payload.client_id),
    clientSecret:text(result.payload.client_secret) || null,
    redirectUri,
  };
}

function parseMcpPayload(raw, requestId) {
  if (!raw) return null;
  const contentType = raw.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return raw.json().catch(() => null);
  return raw.text().then(body => {
    const messages = body.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).filter(Boolean);
    for (const message of messages.reverse()) {
      try {
        const value = JSON.parse(message);
        if (requestId == null || value?.id === requestId) return value;
      } catch {}
    }
    return null;
  });
}

async function mcpPost(fetchImpl, token, body, sessionId = null) {
  const headers = {
    authorization:"Bearer " + token,
    "content-type":"application/json",
    accept:"application/json, text/event-stream",
    "mcp-protocol-version":MCP_PROTOCOL_VERSION,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const response = await fetchImpl(NOTION_MCP_URL, {
    method:"POST",
    headers,
    body:JSON.stringify(body),
  });
  const payload = await parseMcpPayload(response.clone(), body.id);
  return { response, payload, sessionId:response.headers.get("mcp-session-id") || sessionId };
}

async function callNotionTool(fetchImpl, accessToken, toolName, args) {
  const init = await mcpPost(fetchImpl, accessToken, {
    jsonrpc:"2.0",
    id:1,
    method:"initialize",
    params:{
      protocolVersion:MCP_PROTOCOL_VERSION,
      capabilities:{},
      clientInfo:{ name:"go-hub-light", version:"1.0.0" },
    },
  });
  if (!init.response.ok || init.payload?.error) {
    throw Object.assign(new Error("NOTION_MCP_INITIALIZE_FAILED"), { status:init.response.status || 502 });
  }
  const sessionId = init.sessionId;
  await mcpPost(fetchImpl, accessToken, {
    jsonrpc:"2.0",
    method:"notifications/initialized",
  }, sessionId);
  const called = await mcpPost(fetchImpl, accessToken, {
    jsonrpc:"2.0",
    id:2,
    method:"tools/call",
    params:{ name:toolName, arguments:args },
  }, sessionId);
  if (!called.response.ok || called.payload?.error || called.payload?.result?.isError) {
    const error = new Error("NOTION_MCP_TOOL_FAILED:" + toolName);
    error.status = called.response.status || 502;
    error.payload = called.payload;
    throw error;
  }
  return called.payload?.result || {};
}

async function listNotionTools(fetchImpl, accessToken) {
  const init = await mcpPost(fetchImpl, accessToken, {
    jsonrpc:"2.0",
    id:1,
    method:"initialize",
    params:{
      protocolVersion:MCP_PROTOCOL_VERSION,
      capabilities:{},
      clientInfo:{ name:"go-hub", version:"1.0.0" },
    },
  });
  if (!init.response.ok || init.payload?.error) {
    throw Object.assign(new Error("NOTION_MCP_INITIALIZE_FAILED"), { status:init.response.status || 502 });
  }
  const sessionId = init.sessionId;
  await mcpPost(fetchImpl, accessToken, {
    jsonrpc:"2.0",
    method:"notifications/initialized",
  }, sessionId);

  const tools = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const listed = await mcpPost(fetchImpl, accessToken, {
      jsonrpc:"2.0",
      id:2 + page,
      method:"tools/list",
      params:cursor ? { cursor } : {},
    }, sessionId);
    if (!listed.response.ok || listed.payload?.error) {
      throw Object.assign(new Error("NOTION_MCP_TOOLS_LIST_FAILED"), { status:listed.response.status || 502 });
    }
    const result = listed.payload?.result || {};
    for (const tool of Array.isArray(result.tools) ? result.tools : []) {
      if (tool && typeof tool === "object" && text(tool.name)) tools.push(clone(tool));
    }
    cursor = text(result.nextCursor || result.next_cursor);
    if (!cursor) break;
  }
  const unique = new Map();
  for (const tool of tools) unique.set(tool.name, tool);
  return [...unique.values()];
}

export class GoHubNotionLightState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.fetchImpl = fetch;
  }
  async stored(key) { return (await this.ctx.storage.get(key)) || null; }
  async put(key, value) { await this.ctx.storage.put(key, clone(value)); }
  async delete(key) { await this.ctx.storage.delete(key); }

  async status() {
    const auth = await this.stored("auth");
    const client = await this.stored("client");
    return {
      ok:true,
      connected:Boolean(auth?.accessToken && client?.clientId),
      workspaceId:auth?.workspaceId || null,
      userId:auth?.userId || null,
      expiresAt:auth?.expiresAt || null,
      clientRegistered:Boolean(client?.clientId),
      authorizationStored:Boolean(auth?.accessToken),
      refreshAvailable:Boolean(auth?.refreshToken),
    };
  }

  async prepare(input = {}) {
    const origin = safeOrigin(input.hubOrigin);
    const redirectUri = origin + "/hub/api/notion-light/callback";
    const discovered = await discoverNotionOAuth(this.fetchImpl);
    let client = await this.stored("client");
    if (!client || client.redirectUri !== redirectUri || !client.clientId) {
      client = await registerClient(this.fetchImpl, discovered.metadata, redirectUri, origin);
      await this.put("client", client);
    }
    const verifier = randomToken(32);
    const challenge = await sha256Base64url(verifier);
    const state = randomToken(32);
    const pending = {
      state,
      verifier,
      redirectUri,
      metadata:discovered.metadata,
      issuer:discovered.metadata.issuer,
      resource:NOTION_MCP_RESOURCE,
      createdAt:Date.now(),
      expiresAt:Date.now() + OAUTH_PENDING_TTL_MS,
    };
    await this.put("pending", pending);
    const params = new URLSearchParams({
      response_type:"code",
      client_id:client.clientId,
      redirect_uri:redirectUri,
      state,
      code_challenge:challenge,
      code_challenge_method:"S256",
      resource:NOTION_MCP_RESOURCE,
      prompt:"consent",
    });
    if (discovered.metadata.scopes_supported.length) {
      params.set("scope", discovered.metadata.scopes_supported.join(" "));
    }
    return {
      ok:true,
      connected:false,
      authorizationUrl:discovered.metadata.authorization_endpoint + "?" + params.toString(),
      callbackUrl:redirectUri,
      expiresAt:new Date(pending.expiresAt).toISOString(),
    };
  }

  async callback(input = {}) {
    const pending = await this.stored("pending");
    const client = await this.stored("client");
    if (!pending || !client) throw Object.assign(new Error("NOTION_LIGHT_OAUTH_NOT_STARTED"), { status:409 });
    if (Date.now() > Number(pending.expiresAt || 0)) {
      await this.delete("pending");
      throw Object.assign(new Error("NOTION_LIGHT_OAUTH_EXPIRED"), { status:410 });
    }
    if (text(input.error)) throw Object.assign(new Error("NOTION_LIGHT_OAUTH_DENIED:" + text(input.error)), { status:400 });
    if (text(input.iss) && text(pending.issuer) && text(input.iss) !== text(pending.issuer)) {
      throw Object.assign(new Error("NOTION_LIGHT_OAUTH_ISSUER_MISMATCH"), { status:403 });
    }
    if (!text(input.state) || text(input.state) !== pending.state) {
      throw Object.assign(new Error("NOTION_LIGHT_OAUTH_STATE_MISMATCH"), { status:403 });
    }
    const code = text(input.code);
    if (!code) throw Object.assign(new Error("NOTION_LIGHT_OAUTH_CODE_REQUIRED"), { status:400 });
    const params = new URLSearchParams({
      grant_type:"authorization_code",
      code,
      client_id:client.clientId,
      redirect_uri:pending.redirectUri,
      code_verifier:pending.verifier,
      resource:text(pending.resource) || NOTION_MCP_RESOURCE,
    });
    if (client.clientSecret) params.set("client_secret", client.clientSecret);
    const exchanged = await fetchJson(this.fetchImpl, pending.metadata.token_endpoint, {
      method:"POST",
      headers:{
        "content-type":"application/x-www-form-urlencoded",
        accept:"application/json",
        "user-agent":"GO-Hub-LIGHT/1.0",
      },
      body:params.toString(),
    });
    if (!exchanged.response.ok || !text(exchanged.payload?.access_token)) {
      throw Object.assign(new Error("NOTION_LIGHT_TOKEN_EXCHANGE_FAILED"), { status:exchanged.response.status || 502 });
    }
    const expiresIn = Number(exchanged.payload.expires_in || 3600);
    const auth = {
      accessToken:text(exchanged.payload.access_token),
      refreshToken:text(exchanged.payload.refresh_token) || null,
      tokenType:text(exchanged.payload.token_type) || "Bearer",
      scope:text(exchanged.payload.scope) || null,
      workspaceId:text(exchanged.payload.workspace_id) || null,
      userId:text(exchanged.payload.user_id) || null,
      emailDomain:text(exchanged.payload.email_domain) || null,
      expiresAt:Date.now() + Math.max(60, expiresIn) * 1000,
      tokenEndpoint:pending.metadata.token_endpoint,
      resource:text(pending.resource) || NOTION_MCP_RESOURCE,
    };
    await this.put("auth", auth);
    await this.delete("pending");
    return { ok:true, connected:true, workspaceId:auth.workspaceId, userId:auth.userId };
  }

  async accessToken() {
    let auth = await this.stored("auth");
    const client = await this.stored("client");
    if (!auth?.accessToken || !client?.clientId) {
      throw Object.assign(new Error("NOTION_LIGHT_AUTH_REQUIRED"), { status:428 });
    }
    if (Number(auth.expiresAt || 0) > Date.now() + TOKEN_SKEW_MS) return auth.accessToken;
    if (!auth.refreshToken || !auth.tokenEndpoint) {
      throw Object.assign(new Error("NOTION_LIGHT_REAUTH_REQUIRED"), { status:428 });
    }
    const params = new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:auth.refreshToken,
      client_id:client.clientId,
      resource:text(auth.resource) || NOTION_MCP_RESOURCE,
    });
    if (client.clientSecret) params.set("client_secret", client.clientSecret);
    const refreshed = await fetchJson(this.fetchImpl, auth.tokenEndpoint, {
      method:"POST",
      headers:{
        "content-type":"application/x-www-form-urlencoded",
        accept:"application/json",
        "user-agent":"GO-Hub-LIGHT/1.0",
      },
      body:params.toString(),
    });
    if (!refreshed.response.ok || !text(refreshed.payload?.access_token)) {
      throw Object.assign(new Error("NOTION_LIGHT_REAUTH_REQUIRED"), { status:428 });
    }
    auth = {
      ...auth,
      accessToken:text(refreshed.payload.access_token),
      refreshToken:text(refreshed.payload.refresh_token) || auth.refreshToken,
      expiresAt:Date.now() + Math.max(60, Number(refreshed.payload.expires_in || 3600)) * 1000,
    };
    await this.put("auth", auth);
    return auth.accessToken;
  }

  async search(input = {}) {
    const query = text(input.query);
    if (!query) throw Object.assign(new Error("NOTION_LIGHT_QUERY_REQUIRED"), { status:400 });
    const token = await this.accessToken();
    const selfResult = await callNotionTool(this.fetchImpl, token, "notion-fetch", { id:"self" });
    const selfPayload = contentJson(selfResult);
    const self = selfPayload?.self || {};
    const aiSearch = self?.current_tool_access?.ai_search;
    if (!["available","available_with_limit"].includes(aiSearch?.status)) {
      return {
        ok:false,
        code:"NOTION_AI_SEARCH_UNAVAILABLE",
        status:aiSearch?.status || "missing",
        workspaceId:self?.workspace?.id || null,
        upgradeUrl:aiSearch?.upgrade_url || aiSearch?.landing_page_url || null,
      };
    }
    const searchResult = await callNotionTool(this.fetchImpl, token, "notion-ai-search", { query:query.slice(0, 600) });
    const searchPayload = contentJson(searchResult) || {};
    const normalized = normalizeSearchEvidence(searchPayload, query);
    return {
      ok:true,
      workspaceId:self?.workspace?.id || null,
      workspaceName:self?.workspace?.name || null,
      userName:self?.user?.name || null,
      tool:"notion-ai-search",
      ...normalized,
    };
  }

  async tools() {
    const token = await this.accessToken();
    const tools = await listNotionTools(this.fetchImpl, token);
    return { ok:true, count:tools.length, tools };
  }

  async callTool(input = {}) {
    const toolName = text(input.toolName);
    if (!toolName) throw Object.assign(new Error("NOTION_TOOL_NAME_REQUIRED"), { status:400 });
    const args = input.arguments == null ? {} : input.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw Object.assign(new Error("NOTION_TOOL_ARGUMENTS_INVALID"), { status:400 });
    }
    const token = await this.accessToken();
    const result = await callNotionTool(this.fetchImpl, token, toolName, args);
    return { ok:true, tool:toolName, result };
  }

  async ring(input = {}) {
    const bellType = text(input.bellType || "LIGHT_HANDOFF").toUpperCase();
    const counterId = text(input.counterId);
    const workId = text(input.workId);
    const checkpointId = text(input.checkpointId);
    if (!["LIGHT_HANDOFF","MIRROR_REFRESH"].includes(bellType)) {
      throw Object.assign(new Error("LIGHT_BELL_TYPE_INVALID"), { status:400 });
    }
    if (bellType === "LIGHT_HANDOFF" && !counterId) {
      throw Object.assign(new Error("LIGHT_BELL_COUNTER_REQUIRED"), { status:400 });
    }
    if (!workId) throw Object.assign(new Error("LIGHT_BELL_WORK_REQUIRED"), { status:400 });
    if (!checkpointId) throw Object.assign(new Error("LIGHT_BELL_CHECKPOINT_REQUIRED"), { status:400 });

    const token = await this.accessToken();

    // Mirror refresh remains a comment signal. Counter handoff uses the dedicated
    // Bell Inbox data source so Notion's page.created trigger can wake the Agent.
    if (bellType === "MIRROR_REFRESH") {
      const pageId = text(input.pageId || this.env?.LIGHT_BELL_PAGE_ID);
      if (!pageId) throw Object.assign(new Error("LIGHT_BELL_PAGE_REQUIRED"), { status:400 });
      const markdown = [
        "🪞 GO Hub Mirror Bell",
        MAGNIFICENT_ARCHITECT_AGENT_MENTION,
        "Trigger: NOTION_PAGE_COMMENT",
        "อัพเดทมิเรอร์",
        "Work: " + workId,
        "Checkpoint: " + checkpointId,
        "Action: Refresh GO HUB BOARD — LIGHT MIRROR from the existing Work and verified Owner Source. Do not create a new Work or Checkpoint.",
      ].join("\n");
      const toolResult = await callNotionTool(this.fetchImpl, token, "notion-create-comment", { page_id:pageId, markdown });
      const payload = contentJson(toolResult) || {};
      const resultPayload = payload?.result && typeof payload.result === "object" ? payload.result : payload;
      return {
        ok:true, tool:"notion-create-comment", signal:"MIRROR_REFRESH_BELL_COMMENT_CREATED",
        bellType, pageId, counterId:counterId || null, workId, checkpointId,
        receiptId:pickString(resultPayload, ["id","comment_id"]) || null,
      };
    }

    const dataSourceId = text(input.dataSourceId || this.env?.LIGHT_BELL_DATA_SOURCE_ID || "2d3b7c19-f429-4d72-92d0-9022d772f8a1");
    if (!dataSourceId) throw Object.assign(new Error("LIGHT_BELL_DATA_SOURCE_REQUIRED"), { status:400 });
    const command = text(input.command) || "Open GO Hub MCP Counter inbox, pick up this exact Counter first, process it under the existing Work/Checkpoint, and answer through the same Counter.";
    const properties = {
      "Name":"Bell " + counterId,
      "Status":"NEW",
      "Target Agent":"Magnificent Architect",
      "Origin Actor":text(input.originActor || "GO"),
      "Target Actor":text(input.targetActor || "LIGHT"),
      "Work ID":workId,
      "Checkpoint ID":checkpointId,
      "Counter ID":counterId,
      "Requested Result":text(input.requestedResult),
      "Command":command,
      "Source / Return Address":text(input.returnAddress || checkpointId),
      "Evidence":text(input.evidence),
      "Error / Blocker":"",
    };
    const toolResult = await callNotionTool(this.fetchImpl, token, "notion-create-pages", {
      parent:{ type:"data_source_id", data_source_id:dataSourceId },
      pages:[{ properties }],
    });
    const payload = contentJson(toolResult) || {};
    const resultPayload = payload?.result && typeof payload.result === "object" ? payload.result : payload;
    const rows = firstArray(resultPayload);
    const created = rows[0] || resultPayload;
    return {
      ok:true,
      tool:"notion-create-pages",
      signal:"LIGHT_BELL_INBOX_RECORD_CREATED",
      bellType,
      dataSourceId,
      counterId,
      workId,
      checkpointId,
      receiptId:pickString(created, ["id","page_id"]) || null,
    };
  }

  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
      const input = await request.json().catch(() => ({}));
      const action = text(input.action).toLowerCase();
      const result = action === "status" ? await this.status()
        : action === "prepare" ? await this.prepare(input)
        : action === "callback" ? await this.callback(input)
        : action === "search" ? await this.search(input)
        : action === "tools" ? await this.tools()
        : action === "call" ? await this.callTool(input)
        : action === "ring" ? await this.ring(input)
        : (() => { throw Object.assign(new Error("NOTION_LIGHT_ACTION_UNSUPPORTED"), { status:400 }); })();
      return json(result, result?.ok === false ? 409 : 200);
    } catch (error) {
      return json({ ok:false, code:error?.message || "NOTION_LIGHT_ERROR" }, error?.status || 500);
    }
  }
}

export function notionLightStub(namespace) {
  if (!namespace || typeof namespace.getByName !== "function") return null;
  return namespace.getByName("notion-light-primary");
}

export function createNotionLightService({ namespace } = {}) {
  async function call(action, input = {}) {
    const stub = notionLightStub(namespace);
    if (!stub || typeof stub.fetch !== "function") return json({ ok:false, code:"NOTION_LIGHT_STATE_NOT_CONFIGURED" }, 503);
    return stub.fetch(new Request("https://notion-light.internal/" + action, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ ...input, action }),
    }));
  }
  return Object.freeze({
    status:() => call("status"),
    prepare:input => call("prepare", input),
    callback:input => call("callback", input),
    search:input => call("search", input),
    tools:() => call("tools"),
    callTool:input => call("call", input),
    ring:input => call("ring", input),
  });
}

export { NOTION_MCP_URL, NOTION_MCP_RESOURCE, MCP_PROTOCOL_VERSION, OAUTH_PENDING_TTL_MS };

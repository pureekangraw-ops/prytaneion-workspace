"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-notion-light.mjs")).href;

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed).map(([k,v]) => [k, structuredClone(v)]));
  return {
    async get(key) { return values.has(key) ? structuredClone(values.get(key)) : undefined; },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); },
    values,
  };
}
function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json", ...headers },
  });
}

test("Notion LIGHT prepare performs OAuth discovery, DCR, and PKCE without exposing secrets", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url:String(url), init });
    if (String(url).includes("oauth-protected-resource")) {
      return jsonResponse({ authorization_servers:["https://auth.notion.example"] });
    }
    if (String(url).includes(".well-known/oauth-authorization-server")) {
      return jsonResponse({
        issuer:"https://auth.notion.example",
        authorization_endpoint:"https://auth.notion.example/authorize",
        token_endpoint:"https://auth.notion.example/token",
        registration_endpoint:"https://auth.notion.example/register",
        scopes_supported:["mcp"],
      });
    }
    if (String(url) === "https://auth.notion.example/register") {
      return jsonResponse({ client_id:"client-1" });
    }
    throw new Error("unexpected URL " + url);
  };
  try {
    const { GoHubNotionLightState } = await import(moduleUrl + "?prepare=" + Date.now());
    const storage = memoryStorage();
    const light = new GoHubNotionLightState({ storage }, {});
    const result = await light.prepare({ hubOrigin:"https://hub.example" });
    const authUrl = new URL(result.authorizationUrl);
    assert.equal(authUrl.origin + authUrl.pathname, "https://auth.notion.example/authorize");
    assert.equal(authUrl.searchParams.get("client_id"), "client-1");
    assert.equal(calls[0].url, "https://mcp.notion.com/mcp/.well-known/oauth-protected-resource");
    assert.equal(authUrl.searchParams.get("redirect_uri"), "https://hub.example/hub/api/notion-light/callback");
    assert.equal(authUrl.searchParams.get("resource"), "https://mcp.notion.com/mcp");
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authUrl.searchParams.get("code_challenge"));
    assert.ok(authUrl.searchParams.get("state"));
    const pending = await storage.get("pending");
    assert.ok(pending.verifier);
    assert.equal(result.authorizationUrl.includes(pending.verifier), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Notion LIGHT callback exchanges code and stores a reusable workspace connection", async () => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/hub/api/notion-light/callback" },
    pending:{
      state:"state-1",
      verifier:"verifier-1",
      redirectUri:"https://hub.example/hub/api/notion-light/callback",
      metadata:{ token_endpoint:"https://auth.notion.example/token" },
      issuer:"https://auth.notion.example",
      resource:"https://mcp.notion.com/mcp",
      createdAt:now,
      expiresAt:now + 600000,
    },
  });
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://auth.notion.example/token");
    const params = new URLSearchParams(init.body);
    assert.equal(params.get("code_verifier"), "verifier-1");
    assert.equal(params.get("resource"), "https://mcp.notion.com/mcp");
    return jsonResponse({
      access_token:"access-1",
      refresh_token:"refresh-1",
      token_type:"Bearer",
      expires_in:3600,
      workspace_id:"workspace-1",
      user_id:"user-1",
    });
  };
  try {
    const { GoHubNotionLightState } = await import(moduleUrl + "?callback=" + Date.now());
    const light = new GoHubNotionLightState({ storage }, {});
    const result = await light.callback({ code:"code-1", state:"state-1", iss:"https://auth.notion.example" });
    assert.equal(result.connected, true);
    const status = await light.status();
    assert.equal(status.connected, true);
    assert.equal(status.workspaceId, "workspace-1");
    assert.equal(await storage.get("pending"), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Notion LIGHT rejects a mismatched OAuth issuer before token exchange", async () => {
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/hub/api/notion-light/callback" },
    pending:{
      state:"state-1",
      verifier:"verifier-1",
      redirectUri:"https://hub.example/hub/api/notion-light/callback",
      metadata:{ token_endpoint:"https://auth.notion.example/token" },
      issuer:"https://auth.notion.example",
      resource:"https://mcp.notion.com/mcp",
      createdAt:Date.now(),
      expiresAt:Date.now()+600000,
    },
  });
  const { GoHubNotionLightState } = await import(moduleUrl + "?issuer-mismatch=" + Date.now());
  const light = new GoHubNotionLightState({ storage }, {});
  await assert.rejects(
    () => light.callback({ code:"code-1", state:"state-1", iss:"https://evil.example" }),
    /NOTION_LIGHT_OAUTH_ISSUER_MISMATCH/,
  );
});

test("Notion LIGHT uses notion-fetch self then notion-ai-search when AI Search is available", async () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/callback" },
    auth:{
      accessToken:"access-1",
      refreshToken:"refresh-1",
      expiresAt:Date.now() + 3600000,
      tokenEndpoint:"https://auth.notion.example/token",
    },
  });
  const toolCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://mcp.notion.com/mcp");
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return jsonResponse({ jsonrpc:"2.0", id:1, result:{ protocolVersion:"2025-11-25", capabilities:{}, serverInfo:{ name:"notion", version:"1" } } }, 200, { "mcp-session-id":"session-1" });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status:202, headers:{ "content-type":"application/json" } });
    }
    if (body.method === "tools/call") {
      toolCalls.push(body.params.name);
      if (body.params.name === "notion-fetch") {
        return jsonResponse({
          jsonrpc:"2.0",
          id:2,
          result:{
            content:[{
              type:"text",
              text:JSON.stringify({
                self:{
                  workspace:{ id:"workspace-1", name:"Big Workspace" },
                  user:{ id:"user-1", name:"Big" },
                  current_tool_access:{ ai_search:{ status:"available" } },
                },
              }),
            }],
          },
        });
      }
      if (body.params.name === "notion-ai-search") {
        assert.match(body.params.arguments.query, /Counter/);
        return jsonResponse({
          jsonrpc:"2.0",
          id:2,
          result:{
            content:[{
              type:"text",
              text:JSON.stringify({
                results:[{
                  title:"Counter Contract",
                  url:"https://notion.so/page-1",
                  path:"GO Hub / Counter",
                  highlight:"Dispatcher contract",
                }],
              }),
            }],
          },
        });
      }
    }
    throw new Error("unexpected MCP request " + init.body);
  };
  try {
    const { GoHubNotionLightState } = await import(moduleUrl + "?search=" + Date.now());
    const light = new GoHubNotionLightState({ storage }, {});
    const result = await light.search({ query:"Find Counter Contract" });
    assert.equal(result.ok, true);
    assert.equal(result.tool, "notion-ai-search");
    assert.deepEqual(toolCalls, ["notion-fetch","notion-ai-search"]);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.searchOnly, true);
    assert.equal(result.confidence, "SEARCH_EVIDENCE_ONLY");
    assert.equal(result.nextRoute, "LIGHT_AGENT");
    assert.deepEqual(result.sources, ["https://notion.so/page-1"]);
    assert.match(result.answer, /SEARCH_ONLY/);
    assert.match(result.answer, /1 candidate source/);
    assert.equal(result.evidence[0].position, "GO Hub / Counter");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Notion LIGHT HANDOFF ring creates a NEW Bell Inbox record instead of commenting the Mirror", async () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/callback" },
    auth:{ accessToken:"access-1", refreshToken:"refresh-1", expiresAt:Date.now()+3600000, tokenEndpoint:"https://auth.notion.example/token" },
  });
  const toolCalls = [];
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") return jsonResponse({ jsonrpc:"2.0", id:1, result:{ protocolVersion:"2025-11-25", capabilities:{}, serverInfo:{ name:"notion", version:"1" } } },200,{"mcp-session-id":"session-1"});
    if (body.method === "notifications/initialized") return new Response("",{status:202});
    if (body.method === "tools/call") {
      toolCalls.push(body.params.name);
      assert.equal(body.params.name,"notion-create-pages");
      assert.deepEqual(body.params.arguments.parent,{type:"data_source_id",data_source_id:"2d3b7c19-f429-4d72-92d0-9022d772f8a1"});
      const p=body.params.arguments.pages[0].properties;
      assert.equal(p.Status,"NEW");
      assert.equal(p["Target Agent"],"Magnificent Architect");
      assert.equal(p["Counter ID"],"COUNTER-BELL-001");
      assert.equal(p["Work ID"],"WORK-BELL-001");
      assert.equal(p["Checkpoint ID"],"CP-BELL-001");
      assert.equal(p["Requested Result"],"MAGNIFICENT_BELL_INBOX_E2E_OK");
      assert.match(p.Command,/pick up/i);
      return jsonResponse({jsonrpc:"2.0",id:2,result:{content:[{type:"text",text:JSON.stringify({results:[{id:"bell-page-1"}]})}]}});
    }
    throw new Error("unexpected MCP request "+init.body);
  };
  try {
    const {GoHubNotionLightState}=await import(moduleUrl+"?ring="+Date.now());
    const light=new GoHubNotionLightState({storage},{LIGHT_BELL_PAGE_ID:"88970e1da0a64ceebaa1ac1928361911"});
    const result=await light.ring({
      counterId:"COUNTER-BELL-001",workId:"WORK-BELL-001",checkpointId:"CP-BELL-001",
      requestedResult:"MAGNIFICENT_BELL_INBOX_E2E_OK",command:"Pick up this exact Counter and answer it."
    });
    assert.equal(result.ok,true);
    assert.equal(result.signal,"LIGHT_BELL_INBOX_RECORD_CREATED");
    assert.equal(result.receiptId,"bell-page-1");
    assert.deepEqual(toolCalls,["notion-create-pages"]);
  } finally { globalThis.fetch=originalFetch; }
});

test("Notion LIGHT Mirror bell uses the Bell page comment trigger without creating a Counter ticket", async () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/callback" },
    auth:{
      accessToken:"access-1",
      refreshToken:"refresh-1",
      expiresAt:Date.now() + 3600000,
      tokenEndpoint:"https://auth.notion.example/token",
    },
  });
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return jsonResponse({ jsonrpc:"2.0", id:1, result:{ protocolVersion:"2025-11-25", capabilities:{}, serverInfo:{ name:"notion", version:"1" } } }, 200, { "mcp-session-id":"session-1" });
    }
    if (body.method === "notifications/initialized") return new Response("", { status:202 });
    if (body.method === "tools/call") {
      assert.equal(body.params.name, "notion-create-comment");
      assert.equal(body.params.arguments.page_id, "88970e1da0a64ceebaa1ac1928361911");
      assert.match(body.params.arguments.markdown, /GO Hub Mirror Bell/);
      assert.match(body.params.arguments.markdown, /Trigger: NOTION_PAGE_COMMENT/);
      assert.match(body.params.arguments.markdown, /<mention url="agent:\/\/1277043d-9861-8158-a732-000347bf2bab\/3e27043d-9861-8026-8e4b-009237cacaec">Magnificent Architect<\/mention>/g);
      assert.match(body.params.arguments.markdown, /อัพเดทมิเรอร์/);
      assert.match(body.params.arguments.markdown, /WORK-MIRROR-001/);
      assert.doesNotMatch(body.params.arguments.markdown, /Counter:/);
      return jsonResponse({
        jsonrpc:"2.0",
        id:2,
        result:{ content:[{ type:"text", text:JSON.stringify({ result:{ status:"success", id:"comment-mirror-1" } }) }] },
      });
    }
    throw new Error("unexpected MCP request " + init.body);
  };
  try {
    const { GoHubNotionLightState } = await import(moduleUrl + "?mirror-ring=" + Date.now());
    const light = new GoHubNotionLightState({ storage }, {
      LIGHT_BELL_PAGE_ID:"88970e1da0a64ceebaa1ac1928361911",
    });
    const result = await light.ring({
      bellType:"MIRROR_REFRESH",
      workId:"WORK-MIRROR-001",
      checkpointId:"CP-MIRROR-001",
    });
    assert.equal(result.ok, true);
    assert.equal(result.bellType, "MIRROR_REFRESH");
    assert.equal(result.signal, "MIRROR_REFRESH_BELL_COMMENT_CREATED");
    assert.equal(result.counterId, null);
    assert.equal(result.receiptId, "comment-mirror-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Notion LIGHT does not silently fall back when AI Search is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/callback" },
    auth:{
      accessToken:"access-1",
      refreshToken:"refresh-1",
      expiresAt:Date.now() + 3600000,
      tokenEndpoint:"https://auth.notion.example/token",
    },
  });
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return jsonResponse({ jsonrpc:"2.0", id:1, result:{ protocolVersion:"2025-11-25", capabilities:{}, serverInfo:{ name:"notion", version:"1" } } }, 200, { "mcp-session-id":"session-1" });
    }
    if (body.method === "notifications/initialized") return new Response("", { status:202 });
    if (body.method === "tools/call" && body.params.name === "notion-fetch") {
      return jsonResponse({
        jsonrpc:"2.0",
        id:2,
        result:{ content:[{ type:"text", text:JSON.stringify({
          self:{
            workspace:{ id:"workspace-1", name:"Big Workspace" },
            current_tool_access:{ ai_search:{ status:"upgrade_required", upgrade_url:"https://notion.so/upgrade" } },
          },
        }) }] },
      });
    }
    throw new Error("notion-search fallback must not be called");
  };
  try {
    const { GoHubNotionLightState } = await import(moduleUrl + "?blocked=" + Date.now());
    const light = new GoHubNotionLightState({ storage }, {});
    const result = await light.search({ query:"Find Counter Contract" });
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOTION_AI_SEARCH_UNAVAILABLE");
    assert.equal(result.status, "upgrade_required");
    assert.equal(result.upgradeUrl, "https://notion.so/upgrade");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Notion LIGHT exposes the complete live MCP tool catalog and can call any advertised tool", async () => {
  const originalFetch = globalThis.fetch;
  const storage = memoryStorage({
    client:{ clientId:"client-1", clientSecret:null, redirectUri:"https://hub.example/callback" },
    auth:{ accessToken:"access-1", refreshToken:"refresh-1", expiresAt:Date.now()+3600000, tokenEndpoint:"https://auth.notion.example/token" },
  });
  const seenCalls = [];
  let listPage = 0;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") {
      return jsonResponse({ jsonrpc:"2.0", id:1, result:{ protocolVersion:"2025-11-25", capabilities:{}, serverInfo:{ name:"notion", version:"1" } } }, 200, { "mcp-session-id":"session-full" });
    }
    if (body.method === "notifications/initialized") return new Response("", { status:202 });
    if (body.method === "tools/list") {
      listPage += 1;
      if (listPage === 1) {
        assert.deepEqual(body.params, {});
        return jsonResponse({
          jsonrpc:"2.0",
          id:body.id,
          result:{
            tools:[
              { name:"notion-fetch", description:"Fetch a page", inputSchema:{ type:"object", properties:{ id:{ type:"string" } }, required:["id"] } },
              { name:"notion-create-pages", description:"Create pages", inputSchema:{ type:"object", properties:{ parent:{ type:"object" }, pages:{ type:"array" } }, required:["parent","pages"] } },
            ],
            nextCursor:"cursor-2",
          },
        });
      }
      assert.equal(body.params.cursor, "cursor-2");
      return jsonResponse({
        jsonrpc:"2.0",
        id:body.id,
        result:{
          tools:[
            { name:"notion-update-page", description:"Update a page", inputSchema:{ type:"object", properties:{ page_id:{ type:"string" }, properties:{ type:"object" } }, required:["page_id"] } },
            { name:"notion-create-comment", description:"Create a comment", inputSchema:{ type:"object", properties:{ page_id:{ type:"string" }, markdown:{ type:"string" } }, required:["page_id","markdown"] } },
          ],
        },
      });
    }
    if (body.method === "tools/call") {
      seenCalls.push(body.params);
      assert.equal(body.params.name, "notion-update-page");
      assert.deepEqual(body.params.arguments, { page_id:"page-1", properties:{ Status:"Done" } });
      return jsonResponse({
        jsonrpc:"2.0",
        id:body.id,
        result:{ content:[{ type:"text", text:JSON.stringify({ result:{ status:"success", id:"page-1" } }) }] },
      });
    }
    throw new Error("unexpected MCP request " + init.body);
  };
  try {
    const { GoHubNotionLightState } = await import(moduleUrl + "?full-tools=" + Date.now());
    const light = new GoHubNotionLightState({ storage }, {});
    const listed = await light.tools();
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 4);
    assert.deepEqual(listed.tools.map(tool => tool.name), [
      "notion-fetch",
      "notion-create-pages",
      "notion-update-page",
      "notion-create-comment",
    ]);

    const called = await light.callTool({
      toolName:"notion-update-page",
      arguments:{ page_id:"page-1", properties:{ Status:"Done" } },
      workContext:{ workId:"WORK-IGNORED-UPSTREAM", checkpointId:"CP-IGNORED-UPSTREAM" },
    });
    assert.equal(called.ok, true);
    assert.equal(called.tool, "notion-update-page");
    assert.equal(seenCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

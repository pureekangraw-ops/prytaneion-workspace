"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const oauthUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-oauth.mjs")).href;
const factoryUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-factory-mcp-worker.mjs")).href;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json" },
  });
}

test("GO Hub publishes and wires the existing Notion MCP bridge", async () => {
  const { createAccessToken } = await import(oauthUrl + "?notion-publication=" + Date.now());
  const { createFactoryMcpWorker } = await import(factoryUrl + "?notion-publication=" + Date.now());

  const seen = [];
  const notionNamespace = {
    getByName(name) {
      assert.equal(name, "notion-light-primary");
      return {
        fetch: async request => {
          const action = new URL(request.url).pathname.slice(1);
          const input = await request.json();
          seen.push({ action, input });
          if (action === "status") {
            return jsonResponse({ ok:true, connected:true, workspaceId:"workspace-1", userId:"user-1" });
          }
          if (action === "prepare") {
            return jsonResponse({
              ok:true,
              connected:false,
              authorizationUrl:"https://auth.notion.example/authorize?state=owner",
              callbackUrl:"https://hub.example/hub/api/notion-light/callback",
            });
          }
          if (action === "search") {
            assert.equal(input.query, "Counter contract");
            return jsonResponse({
              ok:true,
              workspaceId:"workspace-1",
              workspaceName:"Big Workspace",
              tool:"notion-ai-search",
              status:"UNKNOWN",
              answer:"SEARCH_ONLY",
              sources:["https://notion.so/page-1"],
              evidence:[],
              confidence:"SEARCH_EVIDENCE_ONLY",
              nextRoute:"LIGHT_AGENT",
              resultCount:1,
              searchOnly:true,
            });
          }
          if (action === "tools") {
            return jsonResponse({
              ok:true,
              count:4,
              tools:[
                { name:"notion-fetch", inputSchema:{ type:"object" } },
                { name:"notion-create-pages", inputSchema:{ type:"object" } },
                { name:"notion-update-page", inputSchema:{ type:"object" } },
                { name:"notion-create-comment", inputSchema:{ type:"object" } },
              ],
            });
          }
          return jsonResponse({ ok:false, code:"UNEXPECTED_ACTION" }, 400);
        },
      };
    },
  };

  const worker = createFactoryMcpWorker({
    fetchImpl: async () => { throw new Error("network should not be used"); },
  });
  const env = {
    GITHUB_TOKEN:"github-token",
    GOHUB_MASTER_KEY:"master-secret",
    GOHUB_OWNER_PASSCODE:"owner-passcode",
    GO_HUB_NOTION_LIGHT_STATE:notionNamespace,
  };
  const token = await createAccessToken({
    issuer:"https://hub.example",
    signingKey:"master-secret",
    resource:"https://hub.example/mcp",
    subject:"GO",
    scope:"go-hub",
    ttlSeconds:3600,
  });

  async function rpc(id, method, params = {}) {
    const response = await worker.fetch(new Request("https://hub.example/mcp", {
      method:"POST",
      headers:{ authorization:"Bearer " + token, "content-type":"application/json" },
      body:JSON.stringify({ jsonrpc:"2.0", id, method, params }),
    }), env);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.error, undefined);
    return payload.result;
  }

  const listed = await rpc(1, "tools/list");
  const names = listed.tools.map(tool => tool.name);
  for (const name of ["go_hub_notion_status","go_hub_notion_connect","go_hub_notion_search","go_hub_notion_tools","go_hub_notion_call"]) {
    assert.ok(names.includes(name), "missing Notion MCP tool: " + name);
  }

  const statusResult = await rpc(2, "tools/call", {
    name:"go_hub_notion_status",
    arguments:{},
  });
  const status = JSON.parse(statusResult.content[0].text);
  assert.equal(status.connected, true);
  assert.equal(status.workspaceId, "workspace-1");

  const connectResult = await rpc(3, "tools/call", {
    name:"go_hub_notion_connect",
    arguments:{},
  });
  const connect = JSON.parse(connectResult.content[0].text);
  assert.match(connect.authorizationUrl, /^https:\/\/auth\.notion\.example\/authorize/);

  const searchResult = await rpc(4, "tools/call", {
    name:"go_hub_notion_search",
    arguments:{ query:"Counter contract" },
  });
  const search = JSON.parse(searchResult.content[0].text);
  assert.equal(search.tool, "notion-ai-search");
  assert.equal(search.workspaceName, "Big Workspace");

  const toolsResult = await rpc(5, "tools/call", {
    name:"go_hub_notion_tools",
    arguments:{},
  });
  const upstreamTools = JSON.parse(toolsResult.content[0].text);
  assert.equal(upstreamTools.count, 4);
  assert.deepEqual(upstreamTools.tools.map(tool => tool.name), [
    "notion-fetch",
    "notion-create-pages",
    "notion-update-page",
    "notion-create-comment",
  ]);

  const aionResult = await rpc(6, "tools/call", {
    name:"go_hub_aion_open",
    arguments:{ context:{ intent:"inspect", requestedResult:"see current Notion capability" } },
  });
  const aion = JSON.parse(aionResult.content[0].text);
  const currentNames = aion.capabilities.map(item => item.name);
  for (const name of ["go_hub_notion_status","go_hub_notion_connect","go_hub_notion_search","go_hub_notion_tools","go_hub_notion_call"]) {
    assert.ok(currentNames.includes(name), "AION CURRENT missing Notion capability: " + name);
  }

  assert.deepEqual(seen.map(item => item.action), ["status","prepare","search","tools"]);
});

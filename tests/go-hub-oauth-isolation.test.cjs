"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const oauthUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-oauth.mjs")).href;
const issuer = "https://hub.example";
const resource = issuer + "/mcp";
const signingKey = "test-signing-key-with-enough-entropy";
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

async function challengeFor(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(bytes).toString("base64url");
}

function basic(clientId, clientSecret) {
  return "Basic " + Buffer.from(clientId + ":" + clientSecret).toString("base64");
}

function config(now = 1_789_391_000) {
  return {
    issuer,
    signingKey,
    ownerPasscode:"owner-approval-only",
    clients:[
      {
        clientId:"go-hub-go",
        clientSecret:"go-secret",
        redirectUris:["https://chatgpt.com/connector_platform_oauth_redirect"],
        resources:[resource],
        subject:"GO",
        scope:"go-hub",
      },
      {
        clientId:"go-hub-light",
        clientSecret:"light-secret",
        redirectUris:["https://app.notion.com/workflows/mcp/oauth/callback"],
        resources:[resource],
        subject:"LIGHT",
        scope:"go-hub-light",
      },
    ],
    now:() => now,
  };
}

async function exchange(handler, oauth, clientIndex, subject, scope) {
  const client = oauth.clients[clientIndex];
  const code = await (await import(oauthUrl + "?code=" + client.clientId + Date.now())).createTestAuthorizationCode({
    ...oauth,
    clientId:client.clientId,
    subject,
    scope,
    redirectUri:client.redirectUris[0],
    codeChallenge:await challengeFor(verifier),
    resource,
  });
  const response = await handler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{
      authorization:basic(client.clientId, client.clientSecret),
      "content-type":"application/x-www-form-urlencoded",
    },
    body:new URLSearchParams({
      grant_type:"authorization_code",
      code,
      redirect_uri:client.redirectUris[0],
      code_verifier:verifier,
      resource,
    }),
  }));
  assert.equal(response.status, 200);
  return response.json();
}

test("GO and LIGHT share one canonical MCP resource but keep distinct token identities", async () => {
  const { createOAuthHandler, verifyAccessToken } = await import(oauthUrl + "?single-entry=" + Date.now());
  const oauth = config();
  const handler = createOAuthHandler(oauth);

  const go = await exchange(handler, oauth, 0, "GO", "go-hub");
  const light = await exchange(handler, oauth, 1, "LIGHT", "go-hub-light");

  assert.deepEqual(await verifyAccessToken(
    new Request(resource, { headers:{ authorization:"Bearer " + go.access_token } }),
    {
      issuer, signingKey, resource, clientId:"go-hub-go", requireClientId:true,
      acceptedIdentities:[{ subject:"GO", scope:"go-hub" }], now:oauth.now,
    },
  ), { subject:"GO", scope:"go-hub" });

  assert.deepEqual(await verifyAccessToken(
    new Request(resource, { headers:{ authorization:"Bearer " + light.access_token } }),
    {
      issuer, signingKey, resource, clientId:"go-hub-light", requireClientId:true,
      acceptedIdentities:[{ subject:"LIGHT", scope:"go-hub-light" }], now:oauth.now,
    },
  ), { subject:"LIGHT", scope:"go-hub-light" });

  await assert.rejects(
    verifyAccessToken(
      new Request(resource, { headers:{ authorization:"Bearer " + go.access_token } }),
      {
        issuer, signingKey, resource, clientId:"go-hub-light", requireClientId:true,
        acceptedIdentities:[{ subject:"LIGHT", scope:"go-hub-light" }], now:oauth.now,
      },
    ),
    /invalid access token/,
  );
  await assert.rejects(
    verifyAccessToken(
      new Request(resource, { headers:{ authorization:"Bearer " + light.access_token } }),
      {
        issuer, signingKey, resource, clientId:"go-hub-go", requireClientId:true,
        acceptedIdentities:[{ subject:"GO", scope:"go-hub" }], now:oauth.now,
      },
    ),
    /invalid access token/,
  );
});

test("refresh tokens stay bound to their actor client on the shared resource", async () => {
  const { createOAuthHandler, createTestAuthorizationCode } = await import(oauthUrl + "?refresh-single-entry=" + Date.now());
  const oauth = config();
  const light = oauth.clients[1];
  const code = await createTestAuthorizationCode({
    ...oauth,
    clientId:light.clientId,
    subject:"LIGHT",
    scope:"go-hub-light",
    redirectUri:light.redirectUris[0],
    codeChallenge:await challengeFor(verifier),
    resource,
  });
  const handler = createOAuthHandler(oauth);
  const initial = await handler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic(light.clientId, light.clientSecret), "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"authorization_code",
      code,
      redirect_uri:light.redirectUris[0],
      code_verifier:verifier,
      resource,
    }),
  }));
  assert.equal(initial.status, 200);
  const first = await initial.json();

  const crossedClient = await handler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic("go-hub-go", "go-secret"), "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({ grant_type:"refresh_token", refresh_token:first.refresh_token, resource }),
  }));
  assert.equal(crossedClient.status, 400);

  const retiredResource = await handler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic(light.clientId, light.clientSecret), "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:first.refresh_token,
      resource:issuer + "/mcp/light",
    }),
  }));
  assert.equal(retiredResource.status, 400);
});

test("legacy client ids remain actor-bounded on the canonical GO resource during migration", async () => {
  const { createAccessToken, verifyAccessToken } = await import(oauthUrl + "?legacy-single-entry=" + Date.now());
  const now = () => 1_789_391_000;
  const legacyGo = await createAccessToken({
    issuer, signingKey, clientId:"go-hub-chatgpt", resource,
    subject:"big", scope:"go-hub", now,
  });
  const legacyLight = await createAccessToken({
    issuer, signingKey, clientId:"go-hub-notion", resource,
    subject:"notion", scope:"go-hub", now,
  });

  assert.deepEqual(await verifyAccessToken(
    new Request(resource, { headers:{ authorization:"Bearer " + legacyGo } }),
    {
      issuer, signingKey, resource, clientId:"go-hub-go",
      acceptedClientIds:["go-hub-go","go-hub-chatgpt"], requireClientId:true,
      acceptedIdentities:[{ subject:"GO", scope:"go-hub" }, { subject:"big", scope:"go-hub" }], now,
    },
  ), { subject:"big", scope:"go-hub" });

  assert.deepEqual(await verifyAccessToken(
    new Request(resource, { headers:{ authorization:"Bearer " + legacyLight } }),
    {
      issuer, signingKey, resource, clientId:"go-hub-light",
      acceptedClientIds:["go-hub-light","go-hub-notion"], requireClientId:true,
      acceptedIdentities:[{ subject:"LIGHT", scope:"go-hub-light" }, { subject:"notion", scope:"go-hub" }], now,
    },
  ), { subject:"notion", scope:"go-hub" });

  await assert.rejects(
    verifyAccessToken(
      new Request(resource, { headers:{ authorization:"Bearer " + legacyGo } }),
      {
        issuer, signingKey, resource, clientId:"go-hub-light",
        acceptedClientIds:["go-hub-light","go-hub-notion"], requireClientId:true,
        acceptedIdentities:[{ subject:"LIGHT", scope:"go-hub-light" }, { subject:"notion", scope:"go-hub" }], now,
      },
    ),
    /invalid access token/,
  );
});

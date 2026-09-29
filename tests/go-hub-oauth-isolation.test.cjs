"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const oauthUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-oauth.mjs")).href;
const issuer = "https://hub.example";
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
    ownerPasscode: "owner-approval-only",
    clients: [
      {
        clientId: "go-hub-go",
        clientSecret: "go-secret",
        redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
        resources: [issuer + "/mcp"],
        subject: "GO",
        scope: "go-hub",
      },
      {
        clientId: "go-hub-light",
        clientSecret: "light-secret",
        redirectUris: ["https://app.notion.com/workflows/mcp/oauth/callback"],
        resources: [issuer + "/mcp/light"],
        subject: "LIGHT",
        scope: "go-hub-light",
      },
    ],
    now: () => now,
  };
}

test("GO and LIGHT clients receive distinct actor/resource-bound access tokens", async () => {
  const { createOAuthHandler, createTestAuthorizationCode, verifyAccessToken } =
    await import(oauthUrl + "?isolation=" + Date.now());
  const oauth = config();
  const goCode = await createTestAuthorizationCode({
    ...oauth,
    clientId: "go-hub-go",
    subject: "GO",
    scope: "go-hub",
    redirectUri: oauth.clients[0].redirectUris[0],
    codeChallenge: await challengeFor(verifier),
    resource: issuer + "/mcp",
  });
  const handler = createOAuthHandler(oauth);
  const goResponse = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: { authorization: basic("go-hub-go", "go-secret"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: goCode, redirect_uri: oauth.clients[0].redirectUris[0], code_verifier: verifier, resource: issuer + "/mcp" }),
  }));
  assert.equal(goResponse.status, 200);
  const go = await goResponse.json();
  assert.deepEqual(await verifyAccessToken(
    new Request(issuer + "/mcp", { headers: { authorization: "Bearer " + go.access_token } }),
    { issuer, signingKey, resource: issuer + "/mcp", clientId: "go-hub-go", requireClientId: true, acceptedIdentities: [{ subject: "GO", scope: "go-hub" }], now: oauth.now },
  ), { subject: "GO", scope: "go-hub" });
  await assert.rejects(
    verifyAccessToken(
      new Request(issuer + "/mcp/light", { headers: { authorization: "Bearer " + go.access_token } }),
      { issuer, signingKey, resource: issuer + "/mcp/light", clientId: "go-hub-light", requireClientId: true, acceptedIdentities: [{ subject: "LIGHT", scope: "go-hub-light" }], now: oauth.now },
    ),
    /invalid access token/,
  );
});

test("refresh tokens are bound to the original client and exact resource", async () => {
  const { createOAuthHandler, createTestAuthorizationCode } = await import(oauthUrl + "?refresh-isolation=" + Date.now());
  const oauth = config();
  const redirectUri = oauth.clients[1].redirectUris[0];
  const code = await createTestAuthorizationCode({ ...oauth, clientId: "go-hub-light", subject: "LIGHT", scope: "go-hub-light", redirectUri, codeChallenge: await challengeFor(verifier), resource: issuer + "/mcp/light" });
  const handler = createOAuthHandler(oauth);
  const initial = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: { authorization: basic("go-hub-light", "light-secret"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, resource: issuer + "/mcp/light" }),
  }));
  assert.equal(initial.status, 200);
  const first = await initial.json();
  const crossedClient = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: { authorization: basic("go-hub-go", "go-secret"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.refresh_token, resource: issuer + "/mcp/light" }),
  }));
  assert.equal(crossedClient.status, 400);
  const crossedResource = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: { authorization: basic("go-hub-light", "light-secret"), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.refresh_token, resource: issuer + "/mcp" }),
  }));
  assert.equal(crossedResource.status, 400);
});

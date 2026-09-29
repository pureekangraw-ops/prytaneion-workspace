"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const oauthUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-oauth.mjs")).href;
const issuer = "https://hub.example";
let now = 1_789_391_000;
const config = {
  issuer,
  signingKey: "test-signing-key-with-enough-entropy",
  ownerPasscode: "owner-passcode",
  clientId: "chatgpt-go-hub",
  clientSecret: "client-secret",
  redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
  now: () => now,
};
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";

async function challengeFor(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(bytes).toString("base64url");
}

function basicAuth() {
  return "Basic " + Buffer.from(config.clientId + ":" + config.clientSecret).toString("base64");
}

async function initialToken(handler, createTestAuthorizationCode) {
  const code = await createTestAuthorizationCode({
    ...config,
    codeChallenge: await challengeFor(verifier),
    resource: issuer + "/mcp",
  });
  return handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: {
      authorization: basicAuth(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
      resource: issuer + "/mcp",
    }),
  }));
}

test("OAuth metadata advertises refresh_token grant support", async () => {
  now = 1_789_391_000;
  const { createOAuthHandler } = await import(oauthUrl + "?refresh-metadata=" + Date.now());
  const handler = createOAuthHandler(config);
  const response = await handler(new Request(issuer + "/.well-known/oauth-authorization-server"));
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
});

test("authorization exchange returns a rotating refresh token that renews access without owner authorization", async () => {
  now = 1_789_391_000;
  const { createOAuthHandler, createTestAuthorizationCode, verifyAccessToken } =
    await import(oauthUrl + "?refresh-flow=" + Date.now());
  const handler = createOAuthHandler(config);

  const initial = await initialToken(handler, createTestAuthorizationCode);
  assert.equal(initial.status, 200);
  const first = await initial.json();
  assert.equal(typeof first.refresh_token, "string");
  assert.ok(first.refresh_token.length > 20);
  assert.equal(first.refresh_token_expires_in, 30 * 24 * 60 * 60);

  now += 3601;
  const refreshed = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: {
      authorization: basicAuth(),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      resource: issuer + "/mcp",
    }),
  }));
  assert.equal(refreshed.status, 200);
  const second = await refreshed.json();
  assert.equal(second.token_type, "Bearer");
  assert.equal(second.expires_in, 3600);
  assert.equal(typeof second.access_token, "string");
  assert.equal(typeof second.refresh_token, "string");
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal(second.refresh_token_expires_in, 30 * 24 * 60 * 60);

  const identity = await verifyAccessToken(
    new Request(issuer + "/mcp", { headers: { authorization: "Bearer " + second.access_token } }),
    config,
  );
  assert.deepEqual(identity, { subject: "big", scope: "go-hub" });

  now += 3601;
  const afterDeployHandler = createOAuthHandler(config);
  const afterDeployRefresh = await afterDeployHandler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{
      authorization:basicAuth(),
      "content-type":"application/x-www-form-urlencoded",
    },
    body:new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:second.refresh_token,
      resource:issuer + "/mcp",
    }),
  }));
  assert.equal(afterDeployRefresh.status, 200);
  const third = await afterDeployRefresh.json();
  assert.equal(typeof third.access_token, "string");
  assert.equal(typeof third.refresh_token, "string");
  assert.notEqual(third.refresh_token, second.refresh_token);
});

test("refresh grant fails closed for wrong resource and expired refresh tokens", async () => {
  now = 1_789_391_000;
  const { createOAuthHandler, createTestAuthorizationCode } =
    await import(oauthUrl + "?refresh-fail=" + Date.now());
  const handler = createOAuthHandler(config);
  const initial = await initialToken(handler, createTestAuthorizationCode);
  assert.equal(initial.status, 200);
  const first = await initial.json();
  assert.equal(typeof first.refresh_token, "string");

  const wrongResource = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      resource: issuer + "/other",
    }),
  }));
  assert.equal(wrongResource.status, 400);
  assert.deepEqual(await wrongResource.json(), { error: "invalid_grant" });

  now += 30 * 24 * 60 * 60 + 1;
  const expired = await handler(new Request(issuer + "/oauth/token", {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      resource: issuer + "/mcp",
    }),
  }));
  assert.equal(expired.status, 400);
  assert.deepEqual(await expired.json(), { error: "invalid_grant" });
});


test("Notion LIGHT OAuth client keeps a sliding refresh chain across worker recreation", async () => {
  now = 1_789_391_000;
  const { createOAuthHandler, createTestAuthorizationCode, verifyAccessToken } =
    await import(oauthUrl + "?notion-refresh=" + Date.now());
  const notionRedirect = "https://app.notion.com/workflows/mcp/oauth/callback";
  const notionConfig = {
    issuer,
    signingKey:config.signingKey,
    ownerPasscode:config.ownerPasscode,
    clients:[
      {
        clientId:"go-hub-chatgpt",
        clientSecret:"chatgpt-secret",
        redirectUris:[config.redirectUri],
        subject:"big",
        scope:"go-hub",
      },
      {
        clientId:"go-hub-notion",
        clientSecret:"notion-secret",
        redirectUris:[notionRedirect],
        subject:"notion",
        scope:"go-hub",
      },
    ],
    now:() => now,
  };
  const code = await createTestAuthorizationCode({
    ...notionConfig,
    clientId:"go-hub-notion",
    subject:"notion",
    scope:"go-hub",
    redirectUri:notionRedirect,
    codeChallenge:await challengeFor(verifier),
    resource:issuer + "/mcp",
  });
  const basic = "Basic " + Buffer.from("go-hub-notion:notion-secret").toString("base64");
  const firstHandler = createOAuthHandler(notionConfig);
  const initial = await firstHandler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic, "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"authorization_code",
      code,
      redirect_uri:notionRedirect,
      code_verifier:verifier,
      resource:issuer + "/mcp",
    }),
  }));
  assert.equal(initial.status, 200);
  const first = await initial.json();
  assert.equal(typeof first.refresh_token, "string");

  now += 3601;
  const recreatedHandler = createOAuthHandler(notionConfig);
  const refreshed = await recreatedHandler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic, "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:first.refresh_token,
      resource:issuer + "/mcp",
    }),
  }));
  assert.equal(refreshed.status, 200);
  const second = await refreshed.json();
  assert.notEqual(second.refresh_token, first.refresh_token);
  const identity = await verifyAccessToken(
    new Request(issuer + "/mcp", { headers:{ authorization:"Bearer " + second.access_token } }),
    notionConfig,
  );
  assert.deepEqual(identity, { subject:"notion", scope:"go-hub" });
});


test("Notion OAuth can authorize and rotate refresh tokens on the shared MCP resource", async () => {
  now = 1_789_391_000;
  const { createOAuthHandler, verifyAccessToken } =
    await import(oauthUrl + "?light-resource-oauth=" + Date.now());
  const notionRedirect = "https://app.notion.com/workflows/mcp/oauth/callback";
  const lightResource = issuer + "/mcp";
  const lightConfig = {
    issuer,
    signingKey:config.signingKey,
    ownerPasscode:config.ownerPasscode,
    clients:[
      {
        clientId:"go-hub-chatgpt",
        clientSecret:"chatgpt-secret",
        redirectUris:[config.redirectUri],
        subject:"big",
        scope:"go-hub",
      },
      {
        clientId:"go-hub-notion",
        clientSecret:"notion-secret",
        redirectUris:[notionRedirect],
        resources:[lightResource],
        subject:"notion",
        scope:"go-hub",
      },
    ],
    now:() => now,
  };
  const handler = createOAuthHandler(lightConfig);

  const metadata = await handler(new Request(issuer + "/.well-known/oauth-protected-resource/mcp/light"));
  assert.equal(metadata.status, 200);
  const metadataPayload = await metadata.json();
  assert.equal(metadataPayload.resource, lightResource);
  assert.ok(metadataPayload.scopes_supported.includes("go-hub"));

  const challenge = await challengeFor(verifier);
  const authorize = await handler(new Request(issuer + "/oauth/authorize?" + new URLSearchParams({
    response_type:"code",
    client_id:"go-hub-notion",
    redirect_uri:notionRedirect,
    code_challenge:challenge,
    code_challenge_method:"S256",
    resource:lightResource,
  })));
  assert.equal(authorize.status, 200);

  const codeResponse = await handler(new Request(issuer + "/oauth/authorize", {
    method:"POST",
    headers:{ "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      response_type:"code",
      client_id:"go-hub-notion",
      redirect_uri:notionRedirect,
      code_challenge:challenge,
      code_challenge_method:"S256",
      resource:lightResource,
      passcode:config.ownerPasscode,
    }),
    redirect:"manual",
  }));
  assert.equal(codeResponse.status, 302);
  const code = new URL(codeResponse.headers.get("location")).searchParams.get("code");

  const basic = "Basic " + Buffer.from("go-hub-notion:notion-secret").toString("base64");
  const initial = await handler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic, "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"authorization_code",
      code,
      redirect_uri:notionRedirect,
      code_verifier:verifier,
      resource:lightResource,
    }),
  }));
  assert.equal(initial.status, 200);
  const first = await initial.json();
  assert.equal(typeof first.refresh_token, "string");

  const identity = await verifyAccessToken(
    new Request(lightResource, { headers:{ authorization:"Bearer " + first.access_token } }),
    {
      issuer,
      signingKey:config.signingKey,
      resource:lightResource,
      acceptedIdentities:[{ subject:"notion", scope:"go-hub" }],
      now:() => now,
    },
  );
  assert.deepEqual(identity, { subject:"notion", scope:"go-hub" });

  now += 3601;
  const recreatedHandler = createOAuthHandler(lightConfig);
  const refreshed = await recreatedHandler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:basic, "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:first.refresh_token,
      resource:lightResource,
    }),
  }));
  assert.equal(refreshed.status, 200);
  const second = await refreshed.json();
  assert.equal(typeof second.access_token, "string");
  assert.equal(typeof second.refresh_token, "string");
  assert.notEqual(second.refresh_token, first.refresh_token);

  const chatgptBasic = "Basic " + Buffer.from("go-hub-chatgpt:chatgpt-secret").toString("base64");
  const crossed = await recreatedHandler(new Request(issuer + "/oauth/token", {
    method:"POST",
    headers:{ authorization:chatgptBasic, "content-type":"application/x-www-form-urlencoded" },
    body:new URLSearchParams({
      grant_type:"refresh_token",
      refresh_token:second.refresh_token,
      resource:lightResource,
    }),
  }));
  assert.equal(crossed.status, 400);
  assert.deepEqual(await crossed.json(), { error:"invalid_grant" });
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const serviceUrl = pathToFileURL(path.resolve(__dirname, "..", "go-hub-google-drive-service.mjs")).href;

async function load(tag) {
  return import(serviceUrl + "?" + tag + "=" + Date.now());
}

function driveFile(overrides = {}) {
  return {
    id: "file-a",
    name: "alpha.txt",
    mimeType: "text/plain",
    size: "12",
    modifiedTime: "2026-09-19T00:00:00.000Z",
    md5Checksum: "abc123",
    version: "7",
    parents: ["folder-old"],
    trashed: false,
    webViewLink: "https://drive.google.com/file/d/file-a/view",
    ...overrides,
  };
}

test("Drive service fails closed when auth is missing", async () => {
  const { createGoogleDriveService } = await load("missing");
  let calls = 0;
  const service = createGoogleDriveService({
    fetchImpl: async () => { calls += 1; throw new Error("must not call upstream"); },
  });

  const capabilities = await service.capabilities();
  assert.deepEqual(await capabilities.json(), {
    configured: false,
    authMode: null,
    rootScopeConfigured: false,
    operations: ["capabilities", "health", "diagnostics", "root", "get_item", "list_children", "read_document", "download_file", "create_folder", "move_item", "rename_item", "upload_file", "upload_file_internal", "download_file_internal", "ensure_folder_path_internal"],
    destructiveDeleteExposed: false,
    mutationReadbackRequired: true,
  });

  const response = await service.getItem({ fileId: "file-a" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "DRIVE_NOT_CONFIGURED" });
  assert.equal(calls, 0);
});

test("Drive service refreshes OAuth token server-side and never echoes secrets", async () => {
  const { createGoogleDriveService } = await load("refresh");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      assert.match(String(init.body), /client_id=client-a/);
      assert.match(String(init.body), /refresh_token=refresh-secret/);
      return new Response(JSON.stringify({ access_token: "access-secret", expires_in: 3600 }), {
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(init.headers.authorization, "Bearer access-secret");
    return new Response(JSON.stringify(driveFile()), {
      headers: { "content-type": "application/json" },
    });
  };

  const service = createGoogleDriveService({
    fetchImpl,
    refreshToken: "refresh-secret",
    clientId: "client-a",
    clientSecret: "client-secret",
  });
  const response = await service.getItem({ fileId: "file-a" });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.item.id, "file-a");
  assert.equal(payload.item.md5Checksum, "abc123");
  assert.equal(requests.length, 2);
  assert.doesNotMatch(JSON.stringify(payload), /access-secret|refresh-secret|client-secret/);
});

test("Drive diagnostics reports sanitized account identity and granted refresh scopes", async () => {
  const { createGoogleDriveService } = await load("diagnostics");
  const service = createGoogleDriveService({
    refreshToken: "refresh-secret",
    clientId: "client-a",
    clientSecret: "client-secret",
    fetchImpl: async (url, init = {}) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({
          access_token: "access-secret",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email",
        }), { headers: { "content-type": "application/json" } });
      }
      assert.equal(String(url), "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId)");
      assert.equal(init.headers.authorization, "Bearer access-secret");
      return new Response(JSON.stringify({
        user: {
          displayName: "BIG",
          emailAddress: "big@example.com",
          permissionId: "permission-a",
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  const response = await service.diagnostics();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, {
    ok: true,
    authMode: "refresh_token",
    account: {
      displayName: "BIG",
      emailAddress: "big@example.com",
      permissionId: "permission-a",
    },
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    scopeSource: "refresh_response",
  });
  assert.doesNotMatch(JSON.stringify(payload), /refresh-secret|client-secret|access-secret/);
});

test("Drive root returns only governed root identity and hides outer parents", async () => {
  const { createGoogleDriveService } = await load("root");
  const service = createGoogleDriveService({
    accessToken: "token-a",
    rootFolderId: "root-governed",
    fetchImpl: async (url, init = {}) => {
      assert.match(String(url), /\/files\/root-governed\?/);
      assert.equal(init.headers.authorization, "Bearer token-a");
      return new Response(JSON.stringify(driveFile({
        id: "root-governed",
        name: "GO Hub",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["outer-private-parent"],
      })), { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(service.defaultParentId(), "root-governed");
  const response = await service.root();
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.scope, "GOVERNED_ROOT");
  assert.equal(payload.item.id, "root-governed");
  assert.deepEqual(payload.item.parents, []);
});

test("Drive health proves auth and upstream without returning account data", async () => {
  const { createGoogleDriveService } = await load("health");
  let calls = 0;
  const service = createGoogleDriveService({
    accessToken: "token-a",
    fetchImpl: async (url, init = {}) => {
      calls += 1;
      assert.equal(String(url), "https://www.googleapis.com/drive/v3/about?fields=storageQuota(limit,usage)");
      assert.equal(init.headers.authorization, "Bearer token-a");
      return new Response(JSON.stringify({ storageQuota: { limit: "1", usage: "0" } }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const response = await service.health();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, upstream: "PASS", authMode: "access_token" });
  assert.equal(calls, 1);
});

test("Drive resolves and creates a governed folder path from configured root", async () => {
  const { createGoogleDriveService } = await load("path");
  const folders = new Map([
    ["root-governed", driveFile({ id: "root-governed", name: "ROOT", mimeType: "application/vnd.google-apps.folder", parents: [] })],
    ["go-id", driveFile({ id: "go-id", name: "GO", mimeType: "application/vnd.google-apps.folder", parents: ["root-governed"] })],
  ]);
  let createdId = 0;
  const fetchImpl = async (url, init = {}) => {
    const current = new URL(String(url));
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      const id = "made-" + (++createdId);
      const item = driveFile({ id, name: body.name, mimeType: "application/vnd.google-apps.folder", parents: body.parents });
      folders.set(id, item);
      return new Response(JSON.stringify(item), { headers: { "content-type": "application/json" } });
    }
    const fileMatch = current.pathname.match(/\/files\/([^/]+)$/);
    if (fileMatch) {
      const id = decodeURIComponent(fileMatch[1]);
      return new Response(JSON.stringify(folders.get(id)), { headers: { "content-type": "application/json" } });
    }
    const q = current.searchParams.get("q") || "";
    const parent = q.match(/^'([^']+)' in parents/)?.[1];
    const name = q.match(/name = '([^']+)'/)?.[1];
    const items = [...folders.values()].filter(item => item.parents?.includes(parent) && item.name === name);
    return new Response(JSON.stringify({ files: items }), { headers: { "content-type": "application/json" } });
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken: "token-a", rootFolderId: "root-governed" });
  const response = await service.ensureFolderPath({ path: "GO/ระบบ-งาน/GO-HUB/Build Archive/LIGHTHOUSE" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.readback, "PASS");
  assert.equal(payload.item.name, "LIGHTHOUSE");
  assert.equal(payload.createdFolderIds.length, 4);
});

test("Drive createFolder requires readback before PASS", async () => {
  const { createGoogleDriveService } = await load("create");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), {
        name: "Archive",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["parent-a"],
      });
      return new Response(JSON.stringify(driveFile({
        id: "folder-new",
        name: "Archive",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["parent-a"],
      })), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(driveFile({
      id: "folder-new",
      name: "Archive",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["parent-a"],
    })), { headers: { "content-type": "application/json" } });
  };

  const service = createGoogleDriveService({ fetchImpl, accessToken: "token-a" });
  const response = await service.createFolder({ parentId: "parent-a", name: "Archive" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.readback, "PASS");
  assert.equal(payload.item.id, "folder-new");
  assert.equal(requests.length, 2);
});

test("Drive move uses native parent update and verifies destination readback", async () => {
  const { createGoogleDriveService } = await load("move");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) {
      return new Response(JSON.stringify(driveFile({ parents: ["folder-old"] })), {
        headers: { "content-type": "application/json" },
      });
    }
    if (requests.length === 2) {
      const current = new URL(String(url));
      assert.equal(init.method, "PATCH");
      assert.equal(current.searchParams.get("addParents"), "folder-new");
      assert.equal(current.searchParams.get("removeParents"), "folder-old");
      return new Response(JSON.stringify(driveFile({ parents: ["folder-new"] })), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(driveFile({ parents: ["folder-new"] })), {
      headers: { "content-type": "application/json" },
    });
  };

  const service = createGoogleDriveService({ fetchImpl, accessToken: "token-a" });
  const response = await service.moveItem({ fileId: "file-a", destinationFolderId: "folder-new" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.readback, "PASS");
  assert.deepEqual(payload.previousParents, ["folder-old"]);
  assert.deepEqual(payload.item.parents, ["folder-new"]);
  assert.equal(requests.length, 3);
});

test("Drive rename verifies the new name by readback", async () => {
  const { createGoogleDriveService } = await load("rename");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (init.method === "PATCH") {
      assert.deepEqual(JSON.parse(init.body), { name: "renamed.txt" });
    }
    return new Response(JSON.stringify(driveFile({ name: "renamed.txt" })), {
      headers: { "content-type": "application/json" },
    });
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken: "token-a" });
  const response = await service.renameItem({ fileId: "file-a", name: "renamed.txt" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.readback, "PASS");
  assert.equal(payload.item.name, "renamed.txt");
  assert.equal(requests.length, 2);
});

test("Drive readback mismatch fails closed", async () => {
  const { createGoogleDriveService } = await load("mismatch");
  let calls = 0;
  const fetchImpl = async (_url, init = {}) => {
    calls += 1;
    const name = init.method === "PATCH" ? "renamed.txt" : "old.txt";
    return new Response(JSON.stringify(driveFile({ name })), {
      headers: { "content-type": "application/json" },
    });
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken: "token-a" });
  const response = await service.renameItem({ fileId: "file-a", name: "renamed.txt" });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: "DRIVE_READBACK_MISMATCH", field: "name" });
  assert.equal(calls, 2);
});

test("Drive root scope blocks items outside configured root", async () => {
  const { createGoogleDriveService } = await load("scope");
  const fetchImpl = async url => {
    const id = decodeURIComponent(String(url).match(/\/files\/([^?]+)/)?.[1] || "");
    if (id === "outside") {
      return new Response(JSON.stringify(driveFile({ id: "outside", parents: ["other-root"] })), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(driveFile({ id: "other-root", parents: [] })), {
      headers: { "content-type": "application/json" },
    });
  };
  const service = createGoogleDriveService({
    fetchImpl,
    accessToken: "token-a",
    rootFolderId: "allowed-root",
  });
  const response = await service.getItem({ fileId: "outside" });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: "DRIVE_SCOPE_VIOLATION" });
});

test("Drive upstream failures are sanitized", async () => {
  const { createGoogleDriveService } = await load("sanitize");
  const service = createGoogleDriveService({
    accessToken: "super-secret-token",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "super-secret-token leaked", errors: [{ reason: "forbidden" }] },
    }), { status: 403, headers: { "content-type": "application/json" } }),
  });
  const response = await service.getItem({ fileId: "file-a" });
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.deepEqual(payload, { code: "DRIVE_UPSTREAM_ERROR", category: "forbidden" });
  assert.doesNotMatch(JSON.stringify(payload), /super-secret-token/);
});


test("Drive readDocument falls back to governed Drive export when Docs API returns 403", async () => {
  const { createGoogleDriveService } = await load("doc-export-fallback");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const current = String(url);
    requests.push(current);
    if (current.startsWith("https://www.googleapis.com/drive/v3/files/doc-a?")) {
      return new Response(JSON.stringify(driveFile({
        id:"doc-a",
        name:"LIGHT REGISTRY QUEUE — CURRENT",
        mimeType:"application/vnd.google-apps.document",
        parents:["folder-a"],
      })), { headers:{ "content-type":"application/json" } });
    }
    if (current === "https://docs.googleapis.com/v1/documents/doc-a?includeTabsContent=true") {
      return new Response(JSON.stringify({
        error:{ code:403, status:"PERMISSION_DENIED", message:"Docs API rejected the request" },
      }), { status:403, headers:{ "content-type":"application/json" } });
    }
    if (current === "https://www.googleapis.com/drive/v3/files/doc-a/export?mimeType=text%2Fplain") {
      assert.equal(init.headers.authorization, "Bearer token-a");
      return new Response("SYSTEM / WORK\nDrive Folder ID: folder-system\n", {
        headers:{ "content-type":"text/plain; charset=utf-8" },
      });
    }
    throw new Error("unexpected upstream " + current);
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken:"token-a" });
  const response = await service.readDocument({ documentId:"doc-a", maxChars:5000 });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.document.id, "doc-a");
  assert.equal(payload.document.title, "LIGHT REGISTRY QUEUE — CURRENT");
  assert.equal(payload.document.source, "drive_export");
  assert.equal(payload.document.fallbackCategory, "PERMISSION_DENIED");
  assert.equal(payload.document.revisionId, null);
  assert.match(payload.document.text, /folder-system/);
  assert.deepEqual(payload.document.paragraphs.map(item => item.text), [
    "SYSTEM / WORK",
    "Drive Folder ID: folder-system",
  ]);
  assert.equal(requests.length, 3);
});

test("Drive readDocument keeps Docs API as the primary structured source", async () => {
  const { createGoogleDriveService } = await load("doc-primary");
  const fetchImpl = async url => {
    const current = String(url);
    if (current.startsWith("https://www.googleapis.com/drive/v3/files/doc-a?")) {
      return new Response(JSON.stringify(driveFile({
        id:"doc-a",
        name:"Doc A",
        mimeType:"application/vnd.google-apps.document",
      })), { headers:{ "content-type":"application/json" } });
    }
    if (current === "https://docs.googleapis.com/v1/documents/doc-a?includeTabsContent=true") {
      return new Response(JSON.stringify({
        title:"Doc A",
        revisionId:"rev-1",
        body:{ content:[
          { paragraph:{ elements:[{ textRun:{ content:"hello\n" } }] } },
        ] },
      }), { headers:{ "content-type":"application/json" } });
    }
    throw new Error("unexpected upstream " + current);
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken:"token-a" });
  const response = await service.readDocument({ documentId:"doc-a" });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.document.source, "docs_api");
  assert.equal(payload.document.revisionId, "rev-1");
  assert.equal(payload.document.text, "hello");
});

test("Drive public binary download returns bounded base64 with SHA-256", async () => {
  const { createGoogleDriveService } = await load("public-binary");
  const fetchImpl = async (url, init = {}) => {
    const current = String(url);
    if (current.includes("alt=media")) {
      assert.equal(init.headers.authorization, "Bearer access-secret");
      return new Response(new Uint8Array([104, 105]), { headers:{ "content-type":"application/zip" } });
    }
    if (current.includes("/files/file-zip?")) {
      return new Response(JSON.stringify(driveFile({
        id:"file-zip", name:"pixie.zip", mimeType:"application/zip", size:"2", parents:[],
      })), { headers:{ "content-type":"application/json" } });
    }
    throw new Error("unexpected " + current);
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken:"access-secret" });
  const response = await service.downloadFile({ fileId:"file-zip", maxBytes:1024 });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.item.name, "pixie.zip");
  assert.equal(payload.size, 2);
  assert.equal(payload.contentBase64, "aGk=");
  assert.equal(payload.sha256, "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4");
});

test("Drive internal binary read returns governed file bytes", async () => {
  const { createGoogleDriveService } = await load("binary");
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const current = String(url); requests.push({ url: current, init });
    if (current.includes("alt=media")) {
      assert.equal(init.headers.authorization, "Bearer access-secret");
      return new Response(new Uint8Array([104, 105]), { headers: { "content-type": "image/png" } });
    }
    if (current.includes("/files/file-image?")) {
      return new Response(JSON.stringify(driveFile({
        id: "file-image", name: "proof.png", mimeType: "image/png", size: "2", parents: [],
      })), { headers: { "content-type": "application/json" } });
    }
    throw new Error("unexpected " + current);
  };
  const service = createGoogleDriveService({ fetchImpl, accessToken: "access-secret" });
  const result = await service.readFileBytes({ fileId: "file-image", maxBytes: 1024 });
  assert.equal(result.item.name, "proof.png");
  assert.deepEqual(Array.from(result.bytes), [104, 105]);
  assert.equal(requests.length, 2);
});


test("Drive public upload validates base64, size, and SHA-256 before mutation", async () => {
  const { createGoogleDriveService } = await load("public-upload-validation");
  let calls = 0;
  const service = createGoogleDriveService({
    accessToken: "token-a",
    rootFolderId: "root-governed",
    fetchImpl: async () => { calls += 1; throw new Error("validation must fail before upstream"); },
  });

  const badBase64 = await service.uploadFile({
    parentId: "root-governed",
    name: "artifact.zip",
    mimeType: "application/zip",
    contentBase64: "***",
    sha256: "0".repeat(64),
  });
  assert.equal(badBase64.status, 400);
  assert.deepEqual(await badBase64.json(), { code: "DRIVE_UPLOAD_INVALID_INPUT" });

  const encoded = btoa("pixie");
  const sizeMismatch = await service.uploadFile({
    parentId: "root-governed",
    name: "artifact.zip",
    mimeType: "application/zip",
    contentBase64: encoded,
    size: 99,
    sha256: "0".repeat(64),
  });
  assert.equal(sizeMismatch.status, 409);
  assert.deepEqual(await sizeMismatch.json(), { code: "DRIVE_UPLOAD_SIZE_MISMATCH", actualSize: 5 });

  const shaMismatch = await service.uploadFile({
    parentId: "root-governed",
    name: "artifact.zip",
    mimeType: "application/zip",
    contentBase64: encoded,
    size: 5,
    sha256: "0".repeat(64),
  });
  assert.equal(shaMismatch.status, 409);
  const mismatchPayload = await shaMismatch.json();
  assert.equal(mismatchPayload.code, "DRIVE_UPLOAD_SHA256_MISMATCH");
  assert.match(mismatchPayload.actualSha256, /^[a-f0-9]{64}$/);
  assert.equal(calls, 0);
});


test("Drive refresh-token failures expose only the sanitized OAuth error code", async () => {
  const { createGoogleDriveService } = await load("oauth-error-category");
  const service = createGoogleDriveService({
    refreshToken:"refresh-secret",
    clientId:"client-a",
    clientSecret:"client-secret",
    fetchImpl:async url => {
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      return new Response(JSON.stringify({
        error:"invalid_grant",
        error_description:"Token has been expired or revoked.",
      }), { status:400, headers:{ "content-type":"application/json" } });
    },
  });
  const response = await service.health();
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.deepEqual(payload, { code:"DRIVE_AUTH_UPSTREAM_ERROR", category:"invalid_grant" });
  assert.doesNotMatch(JSON.stringify(payload), /refresh-secret|client-secret|expired or revoked/i);
});

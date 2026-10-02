"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("GO Hub exclusively owns the published root PWA identity", () => {
  assert.equal(fs.existsSync(path.join(root, "go-hub.webmanifest")), true);
  const manifest = JSON.parse(read("go-hub.webmanifest"));
  assert.equal(manifest.name, "GO Hub");
  assert.equal(manifest.short_name, "GO Hub");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");

  const release = JSON.parse(read("RELEASE_MANIFEST.json"));
  const published = release.productionFiles.map(item => item.path);
  assert.equal(published.includes("go-hub.webmanifest"), true);
  assert.equal(published.includes("manifest.webmanifest"), false);

  assert.equal(fs.existsSync(path.join(root, "manifest.webmanifest")), true, "legacy manifest may remain as unpublished source reference");
});

test("GO Hub dedicated service worker is active from the root and legacy-free", () => {
  assert.equal(fs.existsSync(path.join(root, "go-hub-sw.js")), true);
  assert.equal(fs.existsSync(path.join(root, "go-hub-sw-bootstrap.js")), true);

  const source = read("go-hub-sw.js");
  assert.match(source, /go-hub-app-/);
  assert.match(source, /index\.html/);
  assert.match(source, /go-hub\.html/);
  assert.match(source, /skipWaiting/);
  assert.match(source, /clients\.claim/);
  assert.doesNotMatch(source, /ygph-standard-app-/);
  assert.doesNotMatch(source, /normalpocket/i);
  assert.doesNotMatch(source, /metropolis-r5/i);

  const bootstrap = read("go-hub-sw-bootstrap.js");
  assert.match(bootstrap, /serviceWorker\.register\(["']\.\/go-hub-sw\.js["']/);
  assert.doesNotMatch(bootstrap, /register\(["']sw\.js["']/);

  const rootHtml = read("index.html");
  assert.match(rootHtml, /go-hub\.webmanifest/);
  assert.match(rootHtml, /go-hub-sw-bootstrap\.js/);
  assert.doesNotMatch(rootHtml, /normalpocket-root-compat\.js/);
  assert.doesNotMatch(rootHtml, /manifest\.webmanifest/);

  const hubHtml = read("go-hub.html");
  assert.match(hubHtml, /go-hub\.webmanifest/);
  assert.doesNotMatch(hubHtml, /normalpocket-root-compat\.js/);

  const release = JSON.parse(read("RELEASE_MANIFEST.json"));
  assert.equal(release.serviceWorker.file, "go-hub-sw.js");
  assert.equal(release.serviceWorker.mode, "go-hub-exclusive");
});


test("GO Hub runtime assets cannot stay stale across a shell contract deploy", () => {
  const source = read("go-hub-sw.js");
  assert.match(source, /v14-office-assets/);
  assert.match(source, /await fetch\(event\.request\)/);
  assert.match(source, /cache\.put\(event\.request, response\.clone\(\)\)/);
  assert.match(source, /const cached = await caches\.match\(event\.request\)/);

  const shell = read("go-hub-shell.js");
  const rootHtml = read("index.html");
  assert.match(rootHtml, /name="personaReference"/);
  assert.match(rootHtml, /name="workingView"/);
  assert.match(shell, /field\("personaReference"\)/);
  assert.match(shell, /field\("workingView"\)/);
});

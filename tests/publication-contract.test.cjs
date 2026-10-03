"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manifest = JSON.parse(read("RELEASE_MANIFEST.json"));

function sorted(values) {
  return [...values].sort();
}

function cloudflareAllowlist() {
  return read(".assetsignore")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("!/") && line.length > 2)
    .map(line => line.slice(2));
}

function hubOfflineShell() {
  const source = read("go-hub-sw.js");
  const match = source.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  assert.ok(match, "GO Hub service worker must declare APP_SHELL");
  return [...match[1].matchAll(/["']\.\/([^"']+)["']/g)].map(item => item[1]);
}

test("active publication metadata follows the GO Hub hard cutover", () => {
  assert.equal(manifest.release, "go-hub-v4-cutover-1");
  assert.equal(manifest.product, "GO Hub");
  assert.equal(manifest.rootEntry, "index.html");
  assert.equal(Object.hasOwn(manifest, "compatibility"), false);
  assert.equal(manifest.serviceWorker.file, "go-hub-sw.js");
  assert.equal(manifest.serviceWorker.mode, "go-hub-exclusive");
  assert.equal(manifest.serviceWorker.cachePrefix, "go-hub-app-");
  assert.equal(manifest.serviceWorker.cacheGeneration, "v14-office-assets");
  assert.equal(manifest.serviceWorker.autoActivate, true);
});

test("release manifest, Cloudflare allowlist, and GO Hub offline shell cannot drift", () => {
  assert.ok(Array.isArray(manifest.productionFiles), "release manifest must list productionFiles");
  const manifestFiles = manifest.productionFiles.map(entry => typeof entry === "string" ? entry : entry.path);
  const allowed = cloudflareAllowlist();
  const shell = hubOfflineShell();

  assert.deepEqual(sorted(allowed), sorted(manifestFiles));
  assert.deepEqual(sorted(shell), sorted(manifestFiles.filter(file => file !== "go-hub-sw.js")));

  for (const file of manifestFiles) {
    assert.ok(fs.existsSync(path.join(root, file)), `publication file does not exist: ${file}`);
  }
});

test("legacy Worker alias may remain infrastructure-only and does not own GO Hub release identity", () => {
  const wrangler = JSON.parse(read("wrangler.jsonc"));
  const guide = read("UPLOAD_GUIDE.md");
  assert.equal(wrangler.name, "normalpocket");
  assert.equal(Object.hasOwn(manifest, "compatibility"), false);
  assert.equal(Object.hasOwn(manifest.serviceWorker, "workerName"), false);
  assert.match(guide, /Worker[^\n]*`normalpocket`/);
  assert.equal(manifest.product, "GO Hub");
});

function localModuleDependencies(file) {
  const source = read(file);
  return [...source.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']\.\/([^"']+)["']/g)]
    .map(match => match[1]);
}

test("published GO Hub module graph is closed", () => {
  const manifestFiles = manifest.productionFiles.map(entry => typeof entry === "string" ? entry : entry.path);
  const published = new Set(manifestFiles);
  const missing = [];

  for (const file of manifestFiles.filter(file => file.endsWith(".js"))) {
    for (const dependency of localModuleDependencies(file)) {
      if (!published.has(dependency)) missing.push(`${file} -> ${dependency}`);
    }
  }

  assert.deepEqual(missing, [], "every relative browser module dependency must be published");
});

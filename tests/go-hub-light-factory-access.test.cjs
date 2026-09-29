"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const worker = fs.readFileSync(path.join(root, "go-hub-factory-mcp-worker.mjs"), "utf8");
const registry = fs.readFileSync(path.join(root, "go-hub-mcp-registry.mjs"), "utf8");

test("LIGHT is not restricted by a separate tool allowlist", () => {
  assert.doesNotMatch(worker, /LIGHT_MUTATION_TOOL_NAMES/);
  assert.doesNotMatch(worker, /LIGHT_DENIED_TOOL_NAMES/);
  assert.doesNotMatch(worker, /LIGHT_TOOL_NOT_ALLOWED/);
  assert.doesNotMatch(worker, /restrictRegistry/);
  assert.match(registry, /go_hub_merge_pull_request/);
  assert.match(registry, /go_hub_delete_file/);
  assert.match(registry, /go_hub_maintenance/);
  assert.match(registry, /go_hub_factory_v4/);
});

test("LIGHT-specific compatibility aliases remain actor-bound without reducing generic tools", () => {
  assert.match(registry, /go_hub_light_factory_v4_action/);
  assert.match(registry, /v4_open_pass/);
  assert.match(worker, /work\.holder !== "LIGHT"/);
  assert.match(worker, /LIGHT_FACTORY_PASS_REQUIRED/);
  assert.match(worker, /destinations = \["factory"\]/);
  assert.match(worker, /runMutation\("factory\.v4\.light\."/);
  assert.match(worker, /mergePullRequest: input => runMutation\("github\.merge_pull_request"/);
  assert.match(worker, /deleteFile: input => runMutation\("github\.delete_file"/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("Current Card tool_access is the only room-entry authority", () => {
  const source = fs.readFileSync(path.join(root, "go-hub-mcp-registry.mjs"), "utf8");
  const start = source.indexOf("function cardToolAllowed");
  const end = source.indexOf("async function assertCardAccess", start);
  const guard = source.slice(start, end);
  assert.match(guard, /card\.tool_access/);
  assert.doesNotMatch(guard, /MAINTENANCE/);
  assert.doesNotMatch(guard, /access_scope/);
});

test("Control Room exposes operational owner controls without owning room logic", () => {
  const source = fs.readFileSync(path.join(root, "go-hub-edge-worker.mjs"), "utf8");
  for (const tool of [
    "go_hub_centre_inspect",
    "go_hub_factory_v4",
    "go_hub_maintenance",
    "go_hub_pixie_result",
    "go_hub_lighthouse_control_port_state",
    "go_hub_project_status",
    "go_hub_centre_live_action",
  ]) assert.match(source, new RegExp(tool));
  assert.match(source, /currentCard/);
  assert.match(source, /pending/);
});

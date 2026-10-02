"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const roomUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-agent-lens-room.mjs")).href;
async function body(response) { return response.json(); }

test("Lens Fitting Room exposes the eight canonical lenses on the Agent Capability Lane", async () => {
  const { createAgentLensRoom } = await import(roomUrl + "?list=" + Date.now());
  const result = await body(await createAgentLensRoom().action({ action:"list" }));
  assert.equal(result.ok, true);
  assert.equal(result.room, "AGENT_LENS_ROOM");
  assert.equal(result.siblingOf, "AGENT_PERSONA_ROOM");
  assert.equal(result.optional, true);
  assert.equal(result.autoEntry, false);
  assert.equal(result.lenses.length, 8);
  assert.deepEqual(result.lenses.map(x => x.name), ["EVIDENCE", "CURRENT", "SYSTEM", "ESSENCE", "FRICTION", "FORM", "CONSEQUENCE", "ACTION"]);
  assert.equal(result.source.type, "USER_ATTACHED_SPEC");
  assert.equal(result.capabilityBoundary.lane, "AGENT_CAPABILITY");
  assert.equal(result.capabilityBoundary.workRequired, false);
  assert.equal(result.capabilityBoundary.tabletRequired, false);
  assert.equal(result.capabilityBoundary.evidenceSource, "FACTORY_EYE");
  assert.equal(result.capabilityBoundary.evidenceMode, "READ_ONLY");
  assert.equal(result.capabilityBoundary.browserMutation, false);
  assert.equal(result.capabilityBoundary.credentialsExposed, false);
});

test("Lens comparison is read-only and never auto-selects", async () => {
  const { createAgentLensRoom } = await import(roomUrl + "?compare=" + Date.now());
  const result = await body(await createAgentLensRoom().action({ action:"compare", lensIds:["LENS-EVIDENCE", "LENS-CURRENT"] }));
  assert.equal(result.ok, true);
  assert.equal(result.selectedAutomatically, false);
  assert.equal(result.mutates, false);
  assert.equal(result.authorityCreated, false);
  assert.equal(result.routeChanged, false);
  assert.equal(result.workChanged, false);
});

test("Lens selection is explicit and session-scoped without Work Tablet or Work identity", async () => {
  const { createAgentLensRoom } = await import(roomUrl + "?select=" + Date.now());
  const selected = await body(await createAgentLensRoom().action({ action:"select", agentId:"GO", lensId:"LENS-EVIDENCE" }));
  assert.equal(selected.ok, true);
  assert.equal(selected.confirmation, "LENS_SELECTED");
  assert.equal(selected.persisted, false);
  assert.equal(selected.persistence, "SESSION_RESPONSE_ONLY");
  assert.equal(selected.selectedAutomatically, false);
  assert.equal(selected.exited, true);
  assert.equal(selected.authorityCreated, false);
  assert.equal(selected.routeChanged, false);
  assert.equal(selected.workChanged, false);
  assert.equal(selected.passOpened, false);
  assert.equal(selected.toolAccessChanged, false);
  assert.equal(selected.lens.lensId, "LENS-EVIDENCE");
  assert.equal(Object.hasOwn(selected, "tabletId"), false);
  assert.equal(Object.hasOwn(selected, "workContext"), false);
});

test("Lens Room rejects implicit entry and invented lenses", async () => {
  const { createAgentLensRoom } = await import(roomUrl + "?errors=" + Date.now());
  const room = createAgentLensRoom();
  const implicit = await room.action({ action:"enter", agentId:"GO" });
  assert.equal(implicit.status, 400);
  assert.equal((await body(implicit)).code, "LENS_ROOM_EXPLICIT_SELECT_REQUIRED");
  const unknown = await room.action({ action:"select", agentId:"GO", lensId:"LENS-MADE-UP" });
  assert.equal(unknown.status, 404);
  assert.equal((await body(unknown)).code, "LENS_ROOM_LENS_UNKNOWN");
});

test("Lens Room discovery stays outside Work Tablet and Door/Gate wiring", () => {
  const root = path.resolve(__dirname, "..");
  const registrySource = fs.readFileSync(path.join(root, "go-hub-mcp-registry.mjs"), "utf8");
  const workerSource = fs.readFileSync(path.join(root, "go-hub-factory-mcp-worker.mjs"), "utf8");
  assert.match(registrySource, /go_hub_agent_lens_room/);
  assert.match(registrySource, /agentLensRoom/);
  assert.match(workerSource, /agentLensRoom: input => agentLensRoom\.action\(input\)/);
  assert.match(workerSource, /agentMission: input => agentMission\.action\(input\)/);
  assert.doesNotMatch(workerSource, /readTablet:\s*input\s*=>\s*agentMission\.action/);
  assert.doesNotMatch(workerSource, /updateTablet:\s*input\s*=>\s*agentMission\.action/);
});

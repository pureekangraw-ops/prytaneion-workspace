"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const roomUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-agent-persona-room.mjs")).href;
async function body(response) { return response.json(); }

test("Persona Room exposes the 14 canonical personas with stable semantic IDs", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?list=" + Date.now());
  const result = await body(await createAgentPersonaRoom().action({ action:"list" }));
  assert.equal(result.ok, true);
  assert.equal(result.source.registryId, "MIR-109");
  assert.equal(result.source.sourceId, "3ce7043d-9861-81c4-91e7-f1453dbb0b2b");
  assert.equal(result.personas.length, 14);
  assert.ok(result.personas.some(x => x.personaId === "PERSONA-OPERATIONS-CHIEF"));
  assert.ok(result.personas.some(x => x.personaId === "PERSONA-STRATEGY"));
});

test("Persona Room equips a canonical persona only on explicit equip and exits immediately", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?equip=" + Date.now());
  const result = await body(await createAgentPersonaRoom().action({
    action:"equip", agentId:"GO", personaId:"PERSONA-DETECTIVE",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryMode, "OWNER_EXPLICIT_ONLY");
  assert.equal(result.autoEntry, false);
  assert.equal(result.persona.name, "Detective");
  assert.equal(result.persona.source.registryId, "MIR-109");
  assert.equal(result.persona.state, "ACTIVE");
  assert.equal(result.confirmation, "PERSONA_ACTIVE");
  assert.equal(result.exited, true);
  assert.equal(result.authorityCreated, false);
  assert.equal(result.routeChanged, false);
  assert.equal(result.workChanged, false);
});

test("Persona Room refuses implicit entry", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?implicit=" + Date.now());
  const response = await createAgentPersonaRoom().action({
    action:"enter", agentId:"GO", personaId:"PERSONA-DETECTIVE",
  });
  assert.equal(response.status, 400);
  assert.equal((await body(response)).code, "PERSONA_ROOM_EXPLICIT_EQUIP_REQUIRED");
});

test("Persona Room rejects missing and unknown personas instead of inventing one", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?unknown=" + Date.now());
  const room = createAgentPersonaRoom();
  const missing = await room.action({ action:"equip", agentId:"GO" });
  assert.equal(missing.status, 400);
  assert.equal((await body(missing)).code, "PERSONA_ROOM_PERSONA_REQUIRED");
  const unknown = await room.action({ action:"equip", agentId:"GO", personaId:"PERSONA-MADE-UP" });
  assert.equal(unknown.status, 404);
  assert.equal((await body(unknown)).code, "PERSONA_ROOM_PERSONA_UNKNOWN");
});


test("Persona Room has a direct GO Hub door without becoming an Agent Mission gate", async () => {
  const fs = require("node:fs");
  const root = path.resolve(__dirname, "..");
  const registrySource = fs.readFileSync(path.join(root, "go-hub-mcp-registry.mjs"), "utf8");
  const workerSource = fs.readFileSync(path.join(root, "go-hub-factory-mcp-worker.mjs"), "utf8");
  assert.match(registrySource, /go_hub_agent_persona_room/);
  assert.match(registrySource, /agentPersonaRoom/);
  assert.match(workerSource, /agentPersonaRoom: input => agentPersonaRoom\(input\)/);
  assert.match(workerSource, /agentMission: input => agentMission\.action\(input\)/);
  assert.doesNotMatch(workerSource, /agentMission\.action\([^\n]*agentPersonaRoom/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const roomUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-agent-persona-room.mjs")).href;

async function body(response) { return response.json(); }

test("Persona Room equips only on an explicit equip command and exits immediately", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?equip=" + Date.now());
  const room = createAgentPersonaRoom();
  const result = await body(await room.action({
    action:"equip",
    agentId:"GO",
    personaId:"GO-CORE",
    personaReference:"notion://persona/go-core",
  }));
  assert.equal(result.ok, true);
  assert.equal(result.entryMode, "OWNER_EXPLICIT_ONLY");
  assert.equal(result.autoEntry, false);
  assert.equal(result.persona.state, "ACTIVE");
  assert.equal(result.confirmation, "PERSONA_ACTIVE");
  assert.equal(result.exited, true);
  assert.equal(result.authorityCreated, false);
  assert.equal(result.routeChanged, false);
  assert.equal(result.workChanged, false);
});

test("Persona Room refuses implicit entry", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?implicit=" + Date.now());
  const room = createAgentPersonaRoom();
  const response = await room.action({ action:"enter", agentId:"GO", personaId:"GO-CORE" });
  assert.equal(response.status, 400);
  assert.equal((await body(response)).code, "PERSONA_ROOM_EXPLICIT_EQUIP_REQUIRED");
});

test("Persona Room requires an assigned persona", async () => {
  const { createAgentPersonaRoom } = await import(roomUrl + "?missing=" + Date.now());
  const room = createAgentPersonaRoom();
  const response = await room.action({ action:"equip", agentId:"GO" });
  assert.equal(response.status, 400);
  assert.equal((await body(response)).code, "PERSONA_ROOM_PERSONA_REQUIRED");
});

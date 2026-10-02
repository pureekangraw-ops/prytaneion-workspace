"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("canonical Fitting Room lists Persona and Lens on the Agent Capability Lane without Work", async () => {
  const { createAgentFittingRoom } = await import("../go-hub-agent-fitting-room.mjs");
  const response = await createAgentFittingRoom().action({ action:"list" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.room, "AGENT_FITTING_ROOM");
  assert.equal(body.lane, "AGENT_CAPABILITY");
  assert.ok(body.personas.length >= 1);
  assert.ok(body.lenses.length >= 1);
  assert.equal(body.workRequired, false);
  assert.equal(body.tabletRequired, false);
  assert.equal(body.authorityCreated, false);
  assert.equal(body.routeChanged, false);
  assert.equal(body.workChanged, false);
});

test("canonical Fitting Room fits Persona and Lens without Tablet, Door, Pass, or route mutation", async () => {
  const { createAgentFittingRoom } = await import("../go-hub-agent-fitting-room.mjs");
  const response = await createAgentFittingRoom().action({
    action:"fit", agentId:"GO", personaId:"PERSONA-HOUSEKEEPER", lensId:"LENS-SYSTEM",
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.confirmation, "FITTING_ACTIVE");
  assert.equal(body.lane, "AGENT_CAPABILITY");
  assert.equal(body.persona.name, "Housekeeper");
  assert.equal(body.lens.name, "SYSTEM");
  assert.equal(body.persistence, "SESSION_RESPONSE_ONLY");
  assert.equal(body.workRequired, false);
  assert.equal(body.tabletRequired, false);
  assert.equal(body.authorityCreated, false);
  assert.equal(body.routeChanged, false);
  assert.equal(body.workChanged, false);
  assert.equal(body.passOpened, false);
  assert.equal(body.toolAccessChanged, false);
  assert.equal(Object.hasOwn(body, "tabletId"), false);
  assert.equal(Object.hasOwn(body, "workContext"), false);
});

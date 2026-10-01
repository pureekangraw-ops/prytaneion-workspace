"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("canonical Fitting Room lists Persona and Lens in one room without authority", async () => {
  const { createAgentFittingRoom } = await import("../go-hub-agent-fitting-room.mjs");
  const room = createAgentFittingRoom();
  const response = await room.action({ action:"list", workContext:{ workId:"WORK-1", checkpointId:"CP-WORK-1" } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.room, "AGENT_FITTING_ROOM");
  assert.ok(body.personas.length >= 1);
  assert.ok(body.lenses.length >= 1);
  assert.equal(body.authorityCreated, false);
  assert.equal(body.routeChanged, false);
  assert.equal(body.workChanged, false);
});

test("canonical Fitting Room fits Persona and Lens on the same tablet", async () => {
  const { createAgentFittingRoom } = await import("../go-hub-agent-fitting-room.mjs");
  let data = { note:"same work" };
  const room = createAgentFittingRoom({
    readTablet: async () => new Response(JSON.stringify({ ok:true, data }), { status:200 }),
    updateTablet: async input => {
      data = input.data;
      return new Response(JSON.stringify({ ok:true, data, tablet:{ tabletId:input.tabletId, data } }), { status:200 });
    },
  });
  const response = await room.action({
    action:"fit", agentId:"GO", personaId:"PERSONA-HOUSEKEEPER", lensId:"LENS-SYSTEM",
    tabletId:"TABLET:TEST", accessScope:"MAINTENANCE",
    workContext:{ workId:"WORK-1", checkpointId:"CP-WORK-1" },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.confirmation, "FITTING_ACTIVE");
  assert.equal(body.persona.name, "Housekeeper");
  assert.equal(body.lens.name, "SYSTEM");
  assert.equal(data.lensSelection.name, "SYSTEM");
  assert.equal(body.authorityCreated, false);
  assert.equal(body.passOpened, false);
  assert.equal(body.toolAccessChanged, false);
});

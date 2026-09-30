"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const roomUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-agent-lens-room.mjs")).href;
async function body(response) { return response.json(); }

const workContext = {
  workId:"WORK-LENS-FITTING-ROOM-20260930-001",
  checkpointId:"CP-WORK-LENS-FITTING-ROOM-20260930-001",
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers:{ "content-type":"application/json" } });
}

test("Lens Fitting Room exposes the eight canonical lenses as an optional Persona sibling", async () => {
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

test("Lens selection is explicit, persists only in Work Tablet data, and preserves Work identity", async () => {
  let tabletData = { existing:"keep", personaSelection:{ personaId:"PERSONA-DETECTIVE" }, lensSelection:{ lensId:"LENS-CURRENT" } };
  let updateInput = null;
  const { createAgentLensRoom } = await import(roomUrl + "?select=" + Date.now());
  const room = createAgentLensRoom({
    readTablet: async input => response({ ok:true, action:"pickup_tablet", tabletId:input.tabletId, data:tabletData }),
    updateTablet: async input => {
      updateInput = input;
      tabletData = input.data;
      return response({ ok:true, action:"update_tablet", tabletId:input.tabletId, data:tabletData, tablet:{ data:tabletData } });
    },
  });

  const first = await body(await room.action({ action:"select", agentId:"GO", lensId:"LENS-EVIDENCE", tabletId:"TABLET:3009-B86I", workContext }));
  assert.equal(first.ok, true);
  assert.equal(first.confirmation, "LENS_SELECTED");
  assert.equal(first.persisted, true);
  assert.equal(first.selectedAutomatically, false);
  assert.equal(first.exited, true);
  assert.equal(first.authorityCreated, false);
  assert.equal(first.routeChanged, false);
  assert.equal(first.workChanged, false);
  assert.equal(first.workIdentityUnchanged, true);
  assert.equal(first.passOpened, false);
  assert.equal(first.toolAccessChanged, false);
  assert.equal(updateInput.data.existing, "keep");
  assert.equal(updateInput.data.personaSelection.personaId, "PERSONA-DETECTIVE");
  assert.equal(updateInput.data.lensSelection.lensId, "LENS-EVIDENCE");

  const second = await body(await room.action({ action:"select", agentId:"GO", lensId:"LENS-FRICTION", tabletId:"TABLET:3009-B86I", workContext }));
  assert.equal(second.ok, true);
  assert.equal(second.data.existing, "keep");
  assert.equal(second.data.personaSelection.personaId, "PERSONA-DETECTIVE");
  assert.equal(second.data.lensSelection.lensId, "LENS-FRICTION");
  assert.deepEqual(second.workContext, workContext);
});

test("Lens Room rejects implicit entry and invented lenses", async () => {
  const { createAgentLensRoom } = await import(roomUrl + "?errors=" + Date.now());
  const room = createAgentLensRoom();
  const implicit = await room.action({ action:"enter", agentId:"GO" });
  assert.equal(implicit.status, 400);
  assert.equal((await body(implicit)).code, "LENS_ROOM_EXPLICIT_SELECT_REQUIRED");
  const unknown = await room.action({ action:"select", agentId:"GO", lensId:"LENS-MADE-UP", tabletId:"TABLET:3009-B86I", workContext });
  assert.equal(unknown.status, 404);
  assert.equal((await body(unknown)).code, "LENS_ROOM_LENS_UNKNOWN");
});

test("Lens Room has a direct sibling door and does not become a Work Tablet gate", () => {
  const root = path.resolve(__dirname, "..");
  const registrySource = fs.readFileSync(path.join(root, "go-hub-mcp-registry.mjs"), "utf8");
  const workerSource = fs.readFileSync(path.join(root, "go-hub-factory-mcp-worker.mjs"), "utf8");
  assert.match(registrySource, /go_hub_agent_lens_room/);
  assert.match(registrySource, /agentLensRoom/);
  assert.match(workerSource, /agentLensRoom: input => agentLensRoom\.action\(input\)/);
  assert.match(workerSource, /agentMission: input => agentMission\.action\(input\)/);
  assert.doesNotMatch(workerSource, /agentMission\.action\([^\n]*agentLensRoom/);
});

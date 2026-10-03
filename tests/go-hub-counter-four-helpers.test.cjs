"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

function mod(file) {
  return import(pathToFileURL(path.join(process.cwd(), file)).href + "?four-helpers=" + Date.now() + Math.random());
}

const workContext = { workId:"WORK-COUNTER-FOUR-HELPERS", checkpointId:"CP-COUNTER-FOUR-HELPERS" };

test("Counter exposes the four helper roster and accepts HERMES/SPECTRUM targets", async () => {
  const { createCounterCore, COUNTER_HELPERS } = await mod("go-hub-counter.mjs");
  assert.deepEqual([...COUNTER_HELPERS], ["PIXIE","HERMES","LIGHT","SPECTRUM"]);
  const core = createCounterCore({ now:() => "2026-10-03T05:00:00.000Z" });
  const hermes = core.create({
    counterId:"COUNTER-HERMES-001",
    fromActor:"GO",
    toActor:"HERMES",
    request:"Resume the current Tablet",
    workContext,
  });
  assert.equal(hermes.counter.to, "HERMES");
  assert.deepEqual(hermes.helpers, ["PIXIE","HERMES","LIGHT","SPECTRUM"]);

  const spectrum = core.create({
    counterId:"COUNTER-SPECTRUM-001",
    fromActor:"GO",
    toActor:"SPECTRUM",
    request:"Plan from the same Tablet context",
    workContext,
  });
  assert.equal(spectrum.counter.to, "SPECTRUM");
});

test("all four helpers use the bounded Counter actor inbox transport", async () => {
  const { GoHubCounterDispatchState } = await mod("go-hub-counter-dispatcher.mjs");
  for (const helper of ["PIXIE","HERMES","LIGHT","SPECTRUM"]) {
    let stored = null;
    const ctx = { storage:{
      async get(){ return stored; },
      async put(_key,value){ stored = structuredClone(value); },
      async setAlarm(){},
    }};
    const dispatch = new GoHubCounterDispatchState(ctx, {});
    const result = await dispatch.enqueueOpen({
      counterId:"COUNTER-" + helper + "-TRANSPORT-001",
      workId:workContext.workId,
      checkpointId:workContext.checkpointId,
      workContext,
      fromActor:"GO",
      toActor:helper,
      request:"Take this Counter ticket",
    });
    assert.equal(result.dispatch.legs[helper].status, "WAITING_PICKUP");
    assert.equal(result.transport, "COUNTER_INBOX");
    assert.equal(result.targetConfigured, true);
    assert.equal(result.pickupRequired, true);
  }
});

test("MCP Counter create exposes only the four helper choices", async () => {
  const { createMcpRegistry } = await mod("go-hub-mcp-registry.mjs");
  const lifecycle = new Proxy({}, {
    get:() => async () => new Response(JSON.stringify({ ok:true }), { headers:{ "content-type":"application/json" } }),
  });
  const registry = createMcpRegistry({ lifecycle });
  const tool = registry.listTools().find(item => item.name === "go_hub_counter_create");
  assert.deepEqual(tool.inputSchema.properties.helper.enum, ["PIXIE","HERMES","LIGHT","SPECTRUM"]);
  assert.equal(tool.inputSchema.required.includes("helper"), false);
});

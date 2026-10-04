const test = require("node:test");
const assert = require("node:assert/strict");

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});
const scene = { schemaVersion: 1, frames: [], nodes: [] };

function fakeMonitor() {
  const calls = [];
  const binding = {
    idFromName: name => `id:${name}`,
    get: () => ({
      async fetch(request) {
        calls.push({ method: request.method, url: request.url, body: await request.json() });
        return response(new URL(request.url).pathname === "/read"
          ? { ok: true, watch: { status: "WAIT" } }
          : { ok: true, status: "WATCHING" });
      },
    }),
  };
  return { binding, calls };
}

test("PIXIE bridge dispatches only approved packets and preserves approvedVersionId", async () => {
  const { createPixiePreviewBridge } = await import("../go-hub-pixie-preview-bridge.mjs");
  const monitor = fakeMonitor();
  const commands = [];
  const bridge = createPixiePreviewBridge({
    pixie: {
      command: async input => { commands.push(input); return response({ ok: true, status: "QUEUED" }, 202); },
      result: async () => response({}),
    },
    monitorBinding: monitor.binding,
  });
  const result = await bridge.dispatch({
    requestId: "PREVIEW-V2",
    packet: { approval: "APPROVED", approvedVersionId: "V2", previewId: "PREVIEW-V2", scene },
  });
  assert.equal(result.ok, true);
  assert.equal(result.approvedVersionId, "V2");
  assert.equal(commands[0].command, "ui_scene_render");
  assert.equal(commands[0].args.approvedVersionId, "V2");
  assert.deepEqual(commands[0].args.scene, scene);
  assert.equal(monitor.calls[0].body.workContext.approvedVersionId, "V2");
});

test("PIXIE bridge rejects draft and missing scene without dispatch", async () => {
  const { createPixiePreviewBridge } = await import("../go-hub-pixie-preview-bridge.mjs");
  const bridge = createPixiePreviewBridge({
    pixie: { command: async () => { throw new Error("must not dispatch"); }, result: async () => response({}) },
    monitorBinding: fakeMonitor().binding,
  });
  assert.equal((await bridge.dispatch({ requestId: "P", packet: { approval: "DRAFT", approvedVersionId: "V2", scene } })).code, "PIXIE_APPROVAL_REQUIRED");
  assert.equal((await bridge.dispatch({ requestId: "P", packet: { approval: "APPROVED", approvedVersionId: "V2" } })).code, "PIXIE_SCENE_REQUIRED");
});

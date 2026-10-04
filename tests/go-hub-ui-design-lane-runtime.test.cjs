const test = require("node:test");
const assert = require("node:assert/strict");

test("remote PIXIE failures never fabricate observedScene", async () => {
  const { createPreviewResult } = await import("../go-hub-ui-design-lane-model.mjs");
  const request = {
    previewId: "PREVIEW-V2",
    protocol: "GO_UI_DESIGN_PREVIEW_V1",
    packetId: "PACKET-V2",
    designId: "DESIGN-YGG",
    workId: "WORK-YGG",
    approvedVersionId: "V2",
    scene: { frames: [{ frameId: "FRAME" }], nodes: [] },
  };
  const failed = createPreviewResult(request, { status: "FAILED", renderer: "PIXIE_REMOTE_V1" });
  const unknown = createPreviewResult(request, { status: "UNKNOWN", renderer: "PIXIE_REMOTE_V1" });
  const missing = createPreviewResult(request, { status: "RENDERED", renderer: "PIXIE_REMOTE_V1" });
  assert.equal(failed.observedScene, null);
  assert.equal(unknown.observedScene, null);
  assert.equal(missing.status, "UNKNOWN");
  assert.equal(missing.observedScene, null);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let api;
test.before(async () => {
  api = await import(pathToFileURL(path.join(__dirname, "..", "go-hub-ui-design-lane-model.mjs")).href);
});

test("creates a governed UI scene with frame, node, layout, and provenance", () => {
  let design = api.createUiDesignDocument({ designId: "DESIGN-001", workId: "WORK-001" });
  design = api.addFrame(design, { frameId: "FRAME-MOBILE", name: "Mobile", width: 390, height: 844 });
  design = api.addNode(design, {
    nodeId: "NODE-BUTTON",
    kind: "COMPONENT_INSTANCE",
    parentId: "FRAME-MOBILE",
    componentId: "button",
    variant: "primary",
    state: "default",
    layout: { mode: "STACK", padding: [12, 20], gap: 8, width: "HUG", height: "HUG" },
    provenance: { workId: "WORK-001", decisionRef: "DEC-001", sourceRef: "SOURCE-001" },
  });
  const node = design.nodes.find(item => item.nodeId === "NODE-BUTTON");
  assert.equal(node.layout.mode, "STACK");
  assert.deepEqual(node.layout.padding, [12, 20, 20, 20]);
  assert.equal(node.layout.width, "HUG");
  assert.deepEqual(design.frames[0].children, ["NODE-BUTTON"]);
  assert.equal(api.validateUiDesignDocument(design).ok, true);
});

test("rejects invalid parents and cycles", () => {
  let design = api.addFrame(api.createUiDesignDocument(), { frameId: "FRAME-1" });
  assert.throws(() => api.addNode(design, { nodeId: "NODE-1", parentId: "MISSING", kind: "RECTANGLE" }), /PARENT_NOT_FOUND/);
  design = api.addNode(design, { nodeId: "NODE-1", parentId: "FRAME-1", kind: "GROUP" });
  design = api.addNode(design, { nodeId: "NODE-2", parentId: "NODE-1", kind: "RECTANGLE" });
  assert.throws(() => api.moveNode(design, "NODE-1", "NODE-2"), /CYCLE/);
});

test("snapshots, compares, and restores without losing the version ledger", () => {
  let design = api.addFrame(api.createUiDesignDocument(), { frameId: "FRAME-1" });
  design = api.addNode(design, { nodeId: "NODE-1", parentId: "FRAME-1", kind: "RECTANGLE", geometry: { width: 100, height: 40 } });
  design = api.createDesignVersion(design, { versionId: "V1", changeSummary: "initial" });
  design = api.updateNode(design, "NODE-1", { geometry: { width: 220, height: 40 } });
  design = api.createDesignVersion(design, { versionId: "V2", changeSummary: "wider button" });
  const diff = api.compareDesignVersions(design, "V1", "V2");
  assert.equal(diff.changed, true);
  assert.deepEqual(diff.changedNodeIds, ["NODE-1"]);
  const restored = api.restoreDesignVersion(design, "V1");
  assert.equal(restored.nodes[0].geometry.width, 100);
  assert.equal(restored.status, "DRAFT");
  assert.equal(restored.versions.length, 2);
});

test("handoff requires explicit approval and carries provenance", () => {
  let design = api.addFrame(api.createUiDesignDocument({ workId: "WORK-001", provenance: { sourceRef: "SOURCE-001" } }), { frameId: "FRAME-1" });
  design = api.createDesignVersion(design, { versionId: "V1" });
  assert.throws(() => api.createDesignHandoffPacket(design), /APPROVAL_REQUIRED/);
  design = api.approveDesignVersion(design, "V1", { decisionRef: "DEC-001", approvedBy: "USER-001" });
  const packet = api.createDesignHandoffPacket(design, { packetId: "PACKET-001" });
  assert.equal(packet.protocol, "GO_UI_DESIGN_HANDOFF_V1");
  assert.equal(packet.approval, "APPROVED");
  assert.equal(packet.approvedVersionId, "V1");
  assert.equal(packet.provenance.decisionRef, "DEC-001");
  assert.equal(packet.productionAuthority, false);
});

test("approved design closes the preview, readback, and evidence loop", () => {
  let design = api.addFrame(api.createUiDesignDocument({ workId: "WORK-YGG-METRO" }), { frameId: "FRAME-DESKTOP", width: 1440, height: 900 });
  design = api.addNode(design, { nodeId: "NODE-HERO", parentId: "FRAME-DESKTOP", kind: "RECTANGLE", geometry: { x: 24, y: 24, width: 900, height: 420 } });
  design = api.createDesignVersion(design, { versionId: "V2", changeSummary: "spacing and text approved" });
  design = api.approveDesignVersion(design, "V2", { decisionRef: "DEC-YGG-METRO-V2" });
  const request = api.createPixiePreviewRequest(design, { previewId: "PREVIEW-V2" });
  const preview = api.createPreviewResult(request, { artifactRef: "pixie://preview/V2" });
  design = api.recordPreviewResult(design, preview);
  const readback = api.createReadbackReport(request, preview, { readbackId: "READBACK-V2" });
  assert.equal(readback.status, "PASS");
  design = api.recordReadback(design, readback);
  assert.equal(design.status, "VERIFIED");
  assert.equal(design.approvedVersionId, "V2");
  assert.equal(design.evidence[0].approvedVersionId, "V2");
  assert.equal(design.evidence[0].status, "PASS");
});

test("preview failure and node mismatch never rewrite approval", () => {
  let design = api.addFrame(api.createUiDesignDocument({ workId: "WORK-YGG-METRO" }), { frameId: "FRAME-MOBILE", width: 390, height: 844 });
  design = api.addNode(design, { nodeId: "NODE-CARD", parentId: "FRAME-MOBILE", kind: "RECTANGLE", geometry: { x: 20, y: 20, width: 240, height: 120 } });
  design = api.createDesignVersion(design, { versionId: "V2" });
  design = api.approveDesignVersion(design, "V2", { decisionRef: "DEC-002" });
  const request = api.createPixiePreviewRequest(design, { previewId: "PREVIEW-FAIL" });
  const failedPreview = api.createPreviewResult(request, { status: "FAILED", error: "PIXIE_TIMEOUT" });
  design = api.recordPreviewResult(design, failedPreview);
  assert.equal(design.status, "APPROVED");
  assert.equal(design.approvedVersionId, "V2");
  const unknownReadback = api.createReadbackReport(request, failedPreview, { readbackId: "READBACK-FAIL" });
  design = api.recordReadback(design, unknownReadback);
  assert.equal(design.status, "APPROVED");
  const mismatchScene = structuredClone(request.scene);
  mismatchScene.frames = mismatchScene.frames.map(frame => ({ ...frame, width: frame.width + 1 }));
  const renderedPreview = api.createPreviewResult(request, { previewId: "PREVIEW-MISMATCH", observedScene: mismatchScene });
  const mismatch = api.createReadbackReport(request, renderedPreview, { readbackId: "READBACK-MISMATCH" });
  assert.equal(mismatch.status, "PASS");
  // Frame-only changes are intentionally outside the first node-level readback scope.
  const nodeMismatchScene = structuredClone(request.scene);
  nodeMismatchScene.nodes = [{ ...nodeMismatchScene.nodes[0], geometry: { ...nodeMismatchScene.nodes[0].geometry, width: 999 } }];
  const nodePreview = api.createPreviewResult(request, { previewId: "PREVIEW-NODE-MISMATCH", observedScene: nodeMismatchScene });
  const nodeMismatch = api.createReadbackReport(request, nodePreview, { readbackId: "READBACK-NODE-MISMATCH" });
  assert.equal(nodeMismatch.status, "FAIL");
  assert.equal(nodeMismatch.checks[0].nodeId, nodeMismatchScene.nodes[0]?.nodeId);
});

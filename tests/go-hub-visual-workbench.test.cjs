"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const modelUrl = pathToFileURL(path.join(root, "go-hub-visual-workbench-model.js")).href;
const IMAGE = "data:image/png;base64,AAAA";

async function model() {
  return import(`${modelUrl}?visual=${Date.now()}-${Math.random()}`);
}

test("Visual Workbench UI is exactly two clipboards + one main workspace + one thin history strip", () => {
  const html = read("pixie-visual-workbench.html");
  assert.equal((html.match(/data-visual-clipboard=/g) || []).length, 2);
  assert.equal((html.match(/data-visual-main/g) || []).length, 1);
  assert.equal((html.match(/data-visual-history/g) || []).length, 1);
  assert.match(html, /IDEA \/ REFERENCE/);
  assert.match(html, /BRIEF \/ PROMPT/);
  assert.match(html, /MAIN WORKSPACE/);
  assert.match(html, /V1 · V2 · V3/);
  assert.doesNotMatch(html, /dashboard/i);
});

test("reference source is locked separately from render history", async () => {
  const { createVisualWorkbenchState, addReference, promoteReferenceToSource, addVersion, activeVisual } = await model();
  let state = createVisualWorkbenchState({});
  state = addReference(state, { id:"REF-1", kind:"IMAGE", label:"Base", content:IMAGE });
  state = promoteReferenceToSource(state, "REF-1");
  assert.equal(state.sourceReferenceId, "REF-1");
  assert.equal(activeVisual(state).kind, "SOURCE");
  assert.equal(state.versions.length, 0);

  state = addVersion(state, { id:"VER-1", label:"V1", content:IMAGE });
  assert.equal(activeVisual(state).kind, "VERSION");
  assert.equal(activeVisual(state).label, "V1");
  assert.equal(state.sourceReferenceId, "REF-1");
});

test("selected or pinned reference text can be appended to Brief without mutating the reference", async () => {
  const { createVisualWorkbenchState, addReference, appendReferenceTextToBrief } = await model();
  let state = createVisualWorkbenchState({ brief:{ prompt:"Start" } });
  state = addReference(state, { id:"NOTE-1", kind:"TEXT", label:"Rule", content:"Keep map geometry" });
  state = appendReferenceTextToBrief(state, "Keep map geometry");
  assert.equal(state.brief.prompt, "Start\n\nKeep map geometry");
  assert.equal(state.references[0].content, "Keep map geometry");
});

test("render packet mirrors PIXIE semantics but grants no image-generation or production authority", async () => {
  const { createVisualWorkbenchState, addReference, promoteReferenceToSource, updateBrief, createRenderPacket } = await model();
  let state = createVisualWorkbenchState({});
  state = addReference(state, { id:"REF-1", kind:"IMAGE", label:"Map", content:IMAGE });
  state = promoteReferenceToSource(state, "REF-1");
  state = updateBrief(state, {
    intent:"Show current flood risk",
    prompt:"Overlay verified flood facts on the fixed base",
    mustKeep:"base geography\nhome anchor",
    mustRemove:"traffic UI",
    constraints:"do not invent coordinates",
  });
  const packet = createRenderPacket(state, { packetId:"PACK-1" });
  assert.equal(packet.packetId, "PACK-1");
  assert.equal(packet.sourceRef, "local-reference://REF-1");
  assert.deepEqual(packet.mustKeep, ["base geography", "home anchor"]);
  assert.deepEqual(packet.mustRemove, ["traffic UI"]);
  assert.deepEqual(packet.constraints, ["do not invent coordinates"]);
  assert.deepEqual(packet.unknowns, []);
  assert.equal(packet.externalExecutionRequired, true);
  assert.equal(packet.imageGenerationAuthority, false);
  assert.equal(packet.productionAuthority, false);
  assert.equal(packet.approval, "NOT_AN_APPROVAL");
});

test("missing source or brief stays UNKNOWN and local verify never invents readiness", async () => {
  const { createVisualWorkbenchState, createRenderPacket, verifyLocalDraft } = await model();
  const state = createVisualWorkbenchState({});
  const packet = createRenderPacket(state, { packetId:"PACK-X" });
  assert.deepEqual(packet.unknowns, ["SOURCE_IMAGE_NOT_SELECTED", "INTENT_MISSING", "PROMPT_MISSING"]);
  const verified = verifyLocalDraft(state);
  assert.equal(verified.verification.status, "UNKNOWN");
  assert.equal(verified.verification.checks.every(item => item.status === "UNKNOWN"), true);
});

test("storage contract is bounded instead of silently accepting an unbounded draft", async () => {
  const { createVisualWorkbenchState, storagePayload } = await model();
  const normal = createVisualWorkbenchState({ brief:{ prompt:"small" } });
  assert.doesNotThrow(() => storagePayload(normal));

  const oversized = createVisualWorkbenchState({
    references:Array.from({ length:12 }, (_, index) => ({
      id:`REF-${index}`,
      kind:"IMAGE",
      content:"data:image/png;base64," + "A".repeat(450000),
    })),
  });
  assert.throws(() => storagePayload(oversized), /STORAGE_BUDGET_EXCEEDED/);
});

test("explicit selection can return from a rendered version to the source", async () => {
  const { createVisualWorkbenchState, addReference, promoteReferenceToSource, addVersion, activeVisual } = await model();
  let state = createVisualWorkbenchState({});
  state = addReference(state, { id:"REF-1", kind:"IMAGE", label:"Base", content:IMAGE });
  state = promoteReferenceToSource(state, "REF-1");
  state = addVersion(state, { id:"VER-1", label:"V1", content:IMAGE });
  assert.equal(activeVisual(state).kind, "VERSION");
  state = promoteReferenceToSource(state, "REF-1");
  assert.equal(activeVisual(state).kind, "SOURCE");
  assert.equal(activeVisual(state).id, "REF-1");
});

test("viewport state is bounded and resettable", async () => {
  const { createVisualWorkbenchState, setViewport, resetViewport } = await model();
  let state = createVisualWorkbenchState({});
  state = setViewport(state, { zoom:99, panX:99999, panY:-99999 });
  assert.equal(state.viewport.zoom, 4);
  assert.equal(state.viewport.panX, 4000);
  assert.equal(state.viewport.panY, -4000);
  state = resetViewport(state);
  assert.deepEqual(state.viewport, { zoom:1, panX:0, panY:0 });
});

test("PIXIE handshake maps local workbench state to existing visual commands without browser authority", async () => {
  const { createVisualWorkbenchState, addReference, promoteReferenceToSource, attachPixieDraft, createPixieHandshake } = await model();
  let state = createVisualWorkbenchState({});
  state = addReference(state, { id:"REF-1", kind:"IMAGE", label:"Base", content:IMAGE });
  state = promoteReferenceToSource(state, "REF-1");
  const createHandshake = createPixieHandshake(state);
  assert.equal(createHandshake.command, "visual_create");
  assert.equal(createHandshake.mode, "PREPARE_CREATE");
  assert.equal(createHandshake.args.sourceRef, "local-reference://REF-1");
  assert.equal(createHandshake.args.sourceVersion, "unknown");
  assert.equal(createHandshake.args.sourceHash, null);
  assert.equal(createHandshake.externalDispatchRequired, true);
  assert.equal(createHandshake.browserMutationAuthority, false);
  assert.equal(createHandshake.imageGenerationAuthority, false);
  assert.ok(createHandshake.unknowns.includes("PIXIE_DRAFT_NOT_LINKED"));
  assert.ok(createHandshake.unknowns.includes("SOURCE_VERSION_UNKNOWN"));

  state = attachPixieDraft(state, "VISUAL-REMOTE-1");
  const compareHandshake = createPixieHandshake(state);
  assert.equal(compareHandshake.command, "visual_compare");
  assert.deepEqual(compareHandshake.args, { visualDraftId:"VISUAL-REMOTE-1" });
  assert.equal(compareHandshake.browserMutationAuthority, false);
});

test("browser UI prepares/copies packets locally and has no direct image-generation or remote mutation path", () => {
  const source = read("pixie-visual-workbench.js");
  assert.match(source, /createRenderPacket/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /application\/x-go-reference/);
  assert.match(source, /promoteReferenceToSource/);
  assert.match(source, /appendReferenceTextToBrief/);
  assert.match(source, /addVersion/);
  assert.match(source, /createPixieHandshake/);
  assert.match(source, /pointerdown/);
  assert.match(source, /dataTransfer/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /go_hub_pixie_command|visual_create\s*\(/i);
  assert.doesNotMatch(source, /generate[_-]?image/i);
  assert.doesNotMatch(source, /mergePull|deploy|externalWrite/i);
});

test("Visual Workbench has responsive/mobile treatment and remains a dedicated page", () => {
  const css = read("pixie-visual-workbench.css");
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 780px\)/);
  assert.match(css, /\.visual-clipboards\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.visual-canvas/);
  assert.match(css, /touch-action:\s*none/);
  const html = read("pixie-visual-workbench.html");
  assert.match(html, /data-zoom-out/);
  assert.match(html, /data-zoom-in/);
  assert.match(html, /data-reset-view/);
  assert.match(html, /data-copy-pixie-handshake/);
});


test("GO Hub exposes the dedicated desk without embedding another dashboard and PWA caches its assets", () => {
  for (const shell of ["index.html", "go-hub.html"]) {
    const html = read(shell);
    assert.match(html, /href="\.\/pixie-visual-workbench\.html"/);
    assert.match(html, /PIXIE Visual Workbench/);
  }
  const sw = read("go-hub-sw.js");
  for (const asset of [
    "./pixie-visual-workbench.html",
    "./pixie-visual-workbench.css",
    "./pixie-visual-workbench.js",
    "./go-hub-visual-workbench-model.js",
  ]) {
    assert.equal(sw.includes(asset), true, `service worker must cache ${asset}`);
  }
  assert.match(sw, /go-hub-app-/);
});

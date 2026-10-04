import {
  createUiDesignDocument,
  addFrame,
  addNode,
  updateNode,
  addInteraction,
  createDesignVersion,
  compareDesignVersions,
  restoreDesignVersion,
  approveDesignVersion,
  createDesignHandoffPacket,
  createPixiePreviewRequest,
  createPreviewResult,
  recordPreviewResult,
  createReadbackReport,
  recordReadback,
  serializeUiDesignDocument,
} from "./go-hub-ui-design-lane-model.mjs";

const STORAGE_KEY = "go-hub:pixie-ui-design-lane:v1";
const DEFAULT_WORK_ID = "WORK-UI-DESIGN-LANE-V1";
const q = (root, selector) => root.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>\"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[char]));
const text = value => String(value ?? "").trim();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const now = () => new Date().toISOString();
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function findRuntimeReceipt(value, seen = new Set()) {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object") return null;
  if (seen.has(parsed)) return null;
  seen.add(parsed);
  if (parsed.observedScene && parsed.approvedVersionId) return parsed;
  for (const key of ["result", "output", "data", "payload"]) {
    const found = findRuntimeReceipt(parsed[key], seen);
    if (found) return found;
  }
  return null;
}

async function dispatchRuntimePreview(request) {
  const dispatchResponse = await fetch("/hub/api/pixie/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: request.previewId, packet: request }),
  });
  const dispatchBody = await dispatchResponse.json().catch(() => ({}));
  if (!dispatchResponse.ok || dispatchBody?.ok !== true) {
    throw new Error(dispatchBody?.code || "PIXIE_DISPATCH_FAILED");
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(1000);
    const pollResponse = await fetch(`/hub/api/pixie/preview/${encodeURIComponent(request.previewId)}`);
    const pollBody = await pollResponse.json().catch(() => ({}));
    if (!pollResponse.ok || pollBody?.ok !== true) throw new Error(pollBody?.code || "PIXIE_MONITOR_READ_FAILED");
    const watch = pollBody.watch;
    if (!watch || watch.status === "WAIT") continue;
    if (watch.status === "FAILED") {
      return createPreviewResult(request, {
        status: "FAILED",
        renderer: "PIXIE_REMOTE_V1",
        error: watch.result?.error || "PIXIE_RUNTIME_FAILED",
      });
    }
    if (watch.status === "ANSWERED") {
      const runtime = findRuntimeReceipt(watch.result);
      if (!runtime?.observedScene) {
        return createPreviewResult(request, {
          status: "UNKNOWN",
          renderer: "PIXIE_REMOTE_V1",
          error: "PIXIE_OBSERVED_SCENE_MISSING",
        });
      }
      if (runtime.approvedVersionId !== request.approvedVersionId) {
        return createPreviewResult(request, {
          status: "UNKNOWN",
          renderer: "PIXIE_REMOTE_V1",
          error: "PIXIE_APPROVED_VERSION_MISMATCH",
        });
      }
      return createPreviewResult(request, {
        status: "RENDERED",
        observedScene: runtime.observedScene,
        artifactRef: runtime.artifactRef,
        renderer: "PIXIE_REMOTE_V1",
      });
    }
    return createPreviewResult(request, {
      status: "UNKNOWN",
      renderer: "PIXIE_REMOTE_V1",
      error: `PIXIE_MONITOR_STATUS_${watch.status || "UNKNOWN"}`,
    });
  }
  return createPreviewResult(request, {
    status: "UNKNOWN",
    renderer: "PIXIE_REMOTE_V1",
    error: "PIXIE_RUNTIME_TIMEOUT",
  });
}

function readStoredDesign() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? createUiDesignDocument(JSON.parse(raw)) : createUiDesignDocument({ workId: DEFAULT_WORK_ID });
  } catch {
    return createUiDesignDocument({ workId: DEFAULT_WORK_ID });
  }
}

function sampleDesign() {
  let design = createUiDesignDocument({
    designId: "DESIGN-YGG-METRO-HERO",
    workId: "WORK-YGG-METRO-HERO-V1",
    provenance: { workId: "WORK-YGG-METRO-HERO-V1", sourceRef: "SOURCE-YGG-METRO" },
  });
  design = addFrame(design, { frameId: "FRAME-DESKTOP", name: "Desktop", device: "desktop", width: 1440, height: 900, background: "#101820" });
  design = addFrame(design, { frameId: "FRAME-MOBILE", name: "Mobile", device: "mobile", width: 390, height: 844, background: "#101820" });
  for (const frameId of ["FRAME-DESKTOP", "FRAME-MOBILE"]) {
    design = addNode(design, {
      nodeId: `${frameId}-HERO`, kind: "RECTANGLE", name: "YGG METRO Hero", parentId: frameId,
      geometry: { x: 24, y: 24, width: frameId === "FRAME-DESKTOP" ? 1392 : 342, height: frameId === "FRAME-DESKTOP" ? 420 : 280 },
      style: { fill: "#20394a", radius: 24, stroke: "#6ec5c8" },
      layout: { mode: "STACK", padding: [24, 24, 24, 24], gap: 12, width: "FILL", height: "FIXED" },
      provenance: { workId: "WORK-YGG-METRO-HERO-V1", sourceRef: "SOURCE-YGG-METRO" },
    });
    design = addNode(design, {
      nodeId: `${frameId}-TITLE`, kind: "TEXT", name: "YGG METRO Title", parentId: `${frameId}-HERO`, text: "YGG METRO",
      geometry: { x: 48, y: 72, width: frameId === "FRAME-DESKTOP" ? 500 : 240, height: 56 },
      style: { color: "#f4f8f8", fontSize: 38, fontWeight: 700 },
      provenance: { workId: "WORK-YGG-METRO-HERO-V1", sourceRef: "SOURCE-YGG-METRO" },
    });
    design = addNode(design, {
      nodeId: `${frameId}-CARD`, kind: "RECTANGLE", name: "Product Card", parentId: frameId,
      geometry: { x: 24, y: frameId === "FRAME-DESKTOP" ? 476 : 328, width: frameId === "FRAME-DESKTOP" ? 420 : 342, height: 180 },
      style: { fill: "#f1ead9", radius: 18, stroke: "#d4b875" },
      layout: { mode: "STACK", padding: [20, 20, 20, 20], gap: 8, width: "FIXED", height: "FIXED" },
      provenance: { workId: "WORK-YGG-METRO-HERO-V1", sourceRef: "SOURCE-YGG-METRO" },
    });
    design = addNode(design, {
      nodeId: `${frameId}-CARD-TEXT`, kind: "TEXT", name: "Product Card Label", parentId: `${frameId}-CARD`, text: "Product Card",
      geometry: { x: 44, y: frameId === "FRAME-DESKTOP" ? 504 : 356, width: 220, height: 32 },
      style: { color: "#17252b", fontSize: 22, fontWeight: 700 },
      provenance: { workId: "WORK-YGG-METRO-HERO-V1", sourceRef: "SOURCE-YGG-METRO" },
    });
  }
  return design;
}

function selectedNode(design, selectedId) {
  return design.nodes.find(node => node.nodeId === selectedId) || null;
}

function selectedParent(design, frameId, selectedId) {
  const node = selectedNode(design, selectedId);
  if (node && (node.kind === "GROUP" || node.kind === "COMPONENT_INSTANCE")) return node.nodeId;
  return frameId;
}

function selectedFrame(design, frameId) {
  return design.frames.find(frame => frame.frameId === frameId) || design.frames[0] || null;
}

function rootNodes(design, parentId) {
  return design.nodes.filter(node => node.parentId === parentId);
}

function renderNode(design, node, selectedId, onSelect) {
  const selected = node.nodeId === selectedId;
  const background = node.style?.fill || (node.kind === "TEXT" ? "transparent" : "#38586c");
  const color = node.style?.color || "#f4f8f8";
  const style = [
    `left:${node.geometry.x}px`, `top:${node.geometry.y}px`,
    `width:${node.geometry.width}px`, `height:${node.geometry.height}px`,
    `background:${esc(background)}`, `color:${esc(color)}`,
    `border-radius:${number(node.style?.radius, 8)}px`,
    `border:1px solid ${esc(node.style?.stroke || (selected ? "#ffd166" : "rgba(255,255,255,.22)"))}`,
    `font-size:${number(node.style?.fontSize, 14)}px`, `font-weight:${number(node.style?.fontWeight, 500)}`,
  ].join(";");
  const content = node.kind === "TEXT" ? esc(node.text || node.name) : `<span>${esc(node.name)}</span>`;
  const children = rootNodes(design, node.nodeId).map(child => renderNode(design, child, selectedId, onSelect)).join("");
  return `<div role="button" tabindex="0" class="ui-design-node${selected ? " is-selected" : ""}" data-ui-node="${esc(node.nodeId)}" style="${style}">${content}${children}${selected ? `<span class="ui-design-resize" data-ui-resize="${esc(node.nodeId)}" aria-label="Resize"></span>` : ""}</div>`;
}

function svgForFrame(design, frame) {
  const nodes = rootNodes(design, frame.frameId);
  const render = node => {
    const fill = esc(node.style?.fill || (node.kind === "TEXT" ? "none" : "#38586c"));
    const stroke = esc(node.style?.stroke || "none");
    const x = node.geometry.x, y = node.geometry.y, w = node.geometry.width, h = node.geometry.height;
    const children = rootNodes(design, node.nodeId).map(render).join("");
    const body = node.kind === "TEXT"
      ? `<text x="${x}" y="${y + Math.max(16, number(node.style?.fontSize, 14))}" fill="${esc(node.style?.color || "#ffffff")}" font-size="${number(node.style?.fontSize, 14)}" font-weight="${number(node.style?.fontWeight, 500)}">${esc(node.text || node.name)}</text>`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${number(node.style?.radius, 8)}" fill="${fill}" stroke="${stroke}" />`;
    return `${body}${children}`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}"><rect width="100%" height="100%" fill="${esc(frame.background || "#101820")}" />${nodes.map(render).join("")}</svg>`;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function mountUiDesignLane(root) {
  if (!root) return;
  let design = readStoredDesign();
  let selectedId = null;
  let frameId = design.frames[0]?.frameId || null;
  let drag = null;

  const status = message => {
    const target = q(root, "[data-ui-design-status]");
    if (target) target.textContent = message;
  };
  const persist = () => {
    localStorage.setItem(STORAGE_KEY, serializeUiDesignDocument(design));
  };
  const commit = nextDesign => {
    design = createUiDesignDocument(nextDesign);
    frameId = selectedFrame(design, frameId)?.frameId || design.frames[0]?.frameId || null;
    if (selectedId && !selectedNode(design, selectedId)) selectedId = null;
    persist();
    render();
  };

  function renderLayers() {
    const target = q(root, "[data-ui-design-layers]");
    if (!target) return;
    const rows = [];
    for (const frame of design.frames) {
      rows.push(`<button type="button" class="ui-design-layer ui-design-layer--frame${frame.frameId === frameId ? " is-active" : ""}" data-ui-frame="${esc(frame.frameId)}">▣ ${esc(frame.name)}</button>`);
      for (const node of rootNodes(design, frame.frameId)) rows.push(layerRow(node, 1));
    }
    target.innerHTML = rows.join("") || `<p class="ui-design-empty">Create a frame to begin.</p>`;
    target.querySelectorAll("[data-ui-frame]").forEach(button => button.addEventListener("click", () => { frameId = button.dataset.uiFrame; selectedId = null; render(); }));
    target.querySelectorAll("[data-ui-layer-node]").forEach(button => button.addEventListener("click", () => { selectedId = button.dataset.uiLayerNode; frameId = selectedNode(design, selectedId)?.parentId || frameId; render(); }));
  }

  function layerRow(node, depth) {
    const children = rootNodes(design, node.nodeId).map(child => layerRow(child, depth + 1)).join("");
    return `<button type="button" class="ui-design-layer${node.nodeId === selectedId ? " is-active" : ""}" style="--depth:${depth}" data-ui-layer-node="${esc(node.nodeId)}">${node.kind === "TEXT" ? "T" : "◇"} ${esc(node.name)}</button>${children}`;
  }

  function renderCanvas() {
    const canvas = q(root, "[data-ui-design-canvas]");
    const frame = selectedFrame(design, frameId);
    if (!canvas || !frame) {
      if (canvas) canvas.innerHTML = `<p class="ui-design-empty">Create Desktop or Mobile Frame.</p>`;
      return;
    }
    canvas.innerHTML = `<div class="ui-design-canvas-meta">${esc(frame.name)} · ${frame.width} × ${frame.height}</div><div class="ui-design-frame" style="width:${frame.width}px;height:${frame.height}px;background:${esc(frame.background || "#101820")}">${rootNodes(design, frame.frameId).map(node => renderNode(design, node, selectedId)).join("")}</div>`;
    canvas.querySelectorAll("[data-ui-node]").forEach(button => button.addEventListener("pointerdown", event => {
      event.stopPropagation();
      selectedId = button.dataset.uiNode;
      const node = selectedNode(design, selectedId);
      drag = { mode: "move", nodeId: selectedId, startX: event.clientX, startY: event.clientY, x: node.geometry.x, y: node.geometry.y };
      button.setPointerCapture?.(event.pointerId);
      renderLayers();
      renderInspector();
    }));
    canvas.querySelectorAll("[data-ui-resize]").forEach(handle => handle.addEventListener("pointerdown", event => {
      event.stopPropagation();
      const node = selectedNode(design, handle.dataset.uiResize);
      drag = { mode: "resize", nodeId: node.nodeId, startX: event.clientX, startY: event.clientY, width: node.geometry.width, height: node.geometry.height };
      handle.setPointerCapture?.(event.pointerId);
    }));
    canvas.onpointermove = event => {
      if (!drag) return;
      const node = selectedNode(design, drag.nodeId);
      if (!node) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      const geometry = drag.mode === "move"
        ? { ...node.geometry, x: drag.x + dx, y: drag.y + dy }
        : { ...node.geometry, width: Math.max(24, drag.width + dx), height: Math.max(24, drag.height + dy) };
      design = updateNode(design, node.nodeId, { geometry });
      persist();
      renderCanvas();
      renderInspector();
    };
    canvas.onpointerup = () => { drag = null; };
    canvas.onpointerleave = () => { drag = null; };
  }

  function renderInspector() {
    const target = q(root, "[data-ui-design-inspector]");
    const node = selectedNode(design, selectedId);
    if (!target) return;
    if (!node) {
      target.innerHTML = `<p class="ui-design-empty">Select a node to inspect.</p>`;
      return;
    }
    target.innerHTML = `
      <label>Name<input data-ui-field="name" value="${esc(node.name)}"></label>
      <label>X<input type="number" data-ui-field="x" value="${node.geometry.x}"></label>
      <label>Y<input type="number" data-ui-field="y" value="${node.geometry.y}"></label>
      <label>Width<input type="number" min="24" data-ui-field="width" value="${node.geometry.width}"></label>
      <label>Height<input type="number" min="24" data-ui-field="height" value="${node.geometry.height}"></label>
      <label>Layout mode<select data-ui-field="layoutMode"><option value="NONE"${node.layout.mode === "NONE" ? " selected" : ""}>None</option><option value="STACK"${node.layout.mode === "STACK" ? " selected" : ""}>Stack</option></select></label>
      <label>Direction<select data-ui-field="direction"><option value="COLUMN"${node.layout.direction === "COLUMN" ? " selected" : ""}>Column</option><option value="ROW"${node.layout.direction === "ROW" ? " selected" : ""}>Row</option></select></label>
      <label>Gap<input type="number" min="0" data-ui-field="gap" value="${node.layout.gap}"></label>
      <label>Padding<input type="number" min="0" data-ui-field="padding" value="${node.layout.padding[0]}"></label>
      <p class="ui-design-provenance">${esc(node.provenance.workId || design.workId || "WORK_ID_MISSING")} · ${esc(node.provenance.sourceRef || "SOURCE_UNKNOWN")}</p>`;
    target.querySelectorAll("[data-ui-field]").forEach(field => field.addEventListener("change", () => {
      const key = field.dataset.uiField;
      const geometry = { ...node.geometry };
      const layout = { ...node.layout };
      if (["x", "y", "width", "height"].includes(key)) geometry[key] = number(field.value, geometry[key]);
      else if (key === "name") node.name = text(field.value) || node.name;
      else if (key === "layoutMode") layout.mode = field.value;
      else if (key === "direction") layout.direction = field.value;
      else if (key === "gap") layout.gap = number(field.value, layout.gap);
      else if (key === "padding") layout.padding = [number(field.value, 0), number(field.value, 0), number(field.value, 0), number(field.value, 0)];
      commit(updateNode(design, node.nodeId, { name: node.name, geometry, layout }));
      status("Inspector change saved to scene model");
    }));
  }

  function renderPreview() {
    const state = q(root, "[data-ui-design-preview-state]");
    const previewTarget = q(root, "[data-ui-design-preview]");
    const reportTarget = q(root, "[data-ui-design-readback-report]");
    const preview = design.previews?.at(-1) || null;
    const readback = design.readbacks?.at(-1) || null;
    if (state) state.textContent = preview ? `${preview.status} · ${preview.approvedVersionId}` : "NO PREVIEW";
    if (previewTarget) {
      if (!preview) previewTarget.innerHTML = `<p class="ui-design-empty">Approve a version, then generate a PIXIE preview.</p>`;
      else {
        const frame = selectedFrame(preview.observedScene, frameId);
        const svg = frame ? svgForFrame(preview.observedScene, frame) : "";
        previewTarget.innerHTML = frame ? `<img class="ui-design-preview-image" alt="PIXIE rendered preview" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">` : `<p class="ui-design-empty">Preview has no selected frame.</p>`;
      }
    }
    if (reportTarget) {
      if (!readback) reportTarget.textContent = "Readback not run.";
      else {
        const lines = [`${readback.status} · approvedVersionId=${readback.approvedVersionId}`, `evidence=${readback.evidenceRef}`];
        for (const check of readback.checks || []) {
          const detail = check.mismatches?.length ? ` · ${check.mismatches.join(", ")}` : "";
          lines.push(`${check.status} · ${check.nodeId || check.checkId}${detail}`);
        }
        reportTarget.textContent = lines.join("\n");
      }
    }
  }

  function renderVersions() {
    const target = q(root, "[data-ui-design-versions]");
    if (!target) return;
    target.innerHTML = design.versions.map(version => `<option value="${esc(version.versionId)}">${esc(version.label)} · ${esc(version.changeSummary || "snapshot")}</option>`).join("") || `<option value="">No snapshots</option>`;
    const compare = q(root, "[data-ui-design-compare]");
    if (compare) compare.innerHTML = design.versions.map(version => `<option value="${esc(version.versionId)}">${esc(version.label)}</option>`).join("") || `<option value="">No snapshots</option>`;
  }

  function render() {
    renderLayers();
    renderCanvas();
    renderInspector();
    renderVersions();
    renderPreview();
    const state = q(root, "[data-ui-design-state]");
    if (state) state.textContent = `${design.status} · ${design.frames.length} frames · ${design.nodes.length} nodes`;
  }

  q(root, "[data-ui-design-seed]")?.addEventListener("click", () => { design = sampleDesign(); frameId = "FRAME-DESKTOP"; selectedId = null; persist(); render(); status("YGG METRO Hero + Product Card created"); });
  q(root, "[data-ui-design-create-desktop]")?.addEventListener("click", () => { commit(addFrame(design, { name: "Desktop", device: "desktop", width: 1440, height: 900, background: "#101820" })); status("Desktop frame created"); });
  q(root, "[data-ui-design-create-mobile]")?.addEventListener("click", () => { commit(addFrame(design, { name: "Mobile", device: "mobile", width: 390, height: 844, background: "#101820" })); status("Mobile frame created"); });
  q(root, "[data-ui-design-add-node]")?.addEventListener("click", () => {
    const type = q(root, "[data-ui-design-node-kind]")?.value || "RECTANGLE";
    const parentId = selectedParent(design, frameId, selectedId);
    if (!parentId) return status("Create a frame first");
    const names = { RECTANGLE: "Rectangle", TEXT: "Text", IMAGE: "Image" };
    const node = { kind: type, name: names[type] || type, parentId, text: type === "TEXT" ? "Text" : null, geometry: { x: 32, y: 32, width: type === "TEXT" ? 220 : 180, height: type === "TEXT" ? 40 : 100 }, style: { fill: type === "TEXT" ? "transparent" : "#38586c", color: "#f4f8f8", radius: 12 }, provenance: { workId: design.workId } };
    const nextDesign = addNode(design, node);
    selectedId = nextDesign.nodes.at(-1).nodeId;
    commit(nextDesign);
    status(`${type} added to ${parentId}`);
  });
  q(root, "[data-ui-design-preview-action]")?.addEventListener("click", async () => {
    try {
      const request = createPixiePreviewRequest(design, { target: "PIXIE" });
      status(`PIXIE dispatch queued · ${request.approvedVersionId}`);
      const preview = await dispatchRuntimePreview(request);
      commit(recordPreviewResult(design, preview));
      status(`PIXIE ${preview.status.toLowerCase()} · ${preview.approvedVersionId}`);
    } catch (error) { status(error.message); }
  });
  q(root, "[data-ui-design-readback-action]")?.addEventListener("click", () => {
    try {
      const preview = design.previews?.at(-1);
      if (!preview) return status("Generate a PIXIE preview first");
      const request = createPixiePreviewRequest(design, { target: "PIXIE" });
      const readback = createReadbackReport(request, preview);
      commit(recordReadback(design, readback));
      status(readback.status === "PASS" ? `Readback PASS · ${readback.evidenceRef}` : `Readback ${readback.status} · inspect node report`);
    } catch (error) { status(error.message); }
  });
  q(root, "[data-ui-design-snapshot]")?.addEventListener("click", () => { commit(createDesignVersion(design, { changeSummary: text(q(root, "[data-ui-design-version-label]")?.value) || "Canvas snapshot" })); status("Snapshot created"); });
  q(root, "[data-ui-design-compare-action]")?.addEventListener("click", () => {
    const values = [...(q(root, "[data-ui-design-compare]")?.selectedOptions || [])].map(option => option.value);
    if (values.length < 2) return status("Create at least two snapshots to compare");
    const result = compareDesignVersions(design, values[0], values[1]);
    status(result.changed ? `Compare: ${result.changedNodeIds.length} node changes` : "Compare: no changes");
  });
  q(root, "[data-ui-design-restore]")?.addEventListener("click", () => { const versionId = q(root, "[data-ui-design-versions]")?.value; if (versionId) { commit(restoreDesignVersion(design, versionId)); status(`Restored ${versionId} as a new draft`); } });
  q(root, "[data-ui-design-approve]")?.addEventListener("click", () => { const versionId = q(root, "[data-ui-design-versions]")?.value || design.versions.at(-1)?.versionId; if (!versionId) return status("Create a snapshot before approval"); commit(approveDesignVersion(design, versionId, { decisionRef: "DEC-UI-DESIGN-V1" })); status(`Approved ${versionId}`); });
  q(root, "[data-ui-design-export-json]")?.addEventListener("click", () => {
    try {
      const packet = design.approvedVersionId
        ? {
            handoff: createDesignHandoffPacket(design, { target: "PIXIE" }),
            preview: design.previews?.at(-1) || null,
            readback: design.readbacks?.at(-1) || null,
            evidence: design.evidence || [],
          }
        : design;
      download("go-ui-design-scene.json", JSON.stringify(packet, null, 2), "application/json");
      status("Scene packet exported");
    } catch (error) { status(error.message); }
  });
  q(root, "[data-ui-design-export-svg]")?.addEventListener("click", () => { const frame = selectedFrame(design, frameId); if (!frame) return status("Create a frame first"); download(`${frame.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`, svgForFrame(design, frame), "image/svg+xml"); status("SVG exported"); });

  render();
}

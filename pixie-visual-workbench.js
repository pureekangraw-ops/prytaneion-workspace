import {
  createVisualWorkbenchState,
  addReference,
  removeReference,
  promoteReferenceToSource,
  updateBrief,
  appendReferenceTextToBrief,
  addVersion,
  activateVersion,
  activeVisual,
  createRenderPacket,
  verifyLocalDraft,
  storagePayload,
  setViewport,
  resetViewport,
  attachPixieDraft,
  createPixieHandshake,
} from "./go-hub-visual-workbench-model.js";

const STORAGE_KEY = "go-hub:pixie-visual-workbench:v1";
const MAX_IMPORT_BYTES = 18 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

const q = selector => document.querySelector(selector);
const referenceList = q("[data-reference-list]");
const referenceEmpty = q("[data-reference-empty]");
const referenceCount = q("[data-reference-count]");
const noteForm = q("[data-reference-note-form]");
const noteInput = q("[data-reference-note]");
const referenceFiles = q("[data-reference-files]");
const selectionToBrief = q("[data-selection-to-brief]");
const briefForm = q("[data-brief-form]");
const packetState = q("[data-packet-state]");
const packetStatus = q("[data-packet-status]");
const copyPacketButton = q("[data-copy-packet]");
const renderFile = q("[data-render-file]");
const verifyButton = q("[data-verify]");
const verifyState = q("[data-verify-state]");
const dropzone = q("[data-main-dropzone]");
const mainImage = q("[data-main-image]");
const canvasPlaceholder = q("[data-canvas-placeholder]");
const canvasCaption = q("[data-canvas-caption]");
const sourceChip = q("[data-source-chip]");
const historyTrack = q("[data-history-track]");
const historyEmpty = q("[data-history-empty]");
const storageStatus = q("[data-storage-status]");
const zoomOutButton = q("[data-zoom-out]");
const zoomInButton = q("[data-zoom-in]");
const zoomLevel = q("[data-zoom-level]");
const resetViewButton = q("[data-reset-view]");
const selectionState = q("[data-visual-selection]");
const pixieDraftInput = q("[data-pixie-draft-id]");
const copyPixieHandshakeButton = q("[data-copy-pixie-handshake]");
const pixieStatus = q("[data-pixie-status]");

let state = loadState();
let saveTimer = null;
let panGesture = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return createVisualWorkbenchState(raw ? JSON.parse(raw) : {});
  } catch {
    return createVisualWorkbenchState({});
  }
}

function persistSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, storagePayload(state));
      storageStatus.textContent = " · saved locally";
    } catch (error) {
      storageStatus.textContent = ` · session only (${error?.message || "storage unavailable"})`;
    }
  }, 120);
}

function setState(nextState) {
  state = createVisualWorkbenchState(nextState);
  persistSoon();
  render();
}

function escapeLabel(value) {
  return String(value || "").replace(/[<>]/g, "");
}

function refCard(reference) {
  const card = document.createElement("article");
  card.className = "visual-reference-card";
  if (reference.id === state.sourceReferenceId) card.classList.add("is-source");
  card.dataset.referenceId = reference.id;
  card.draggable = reference.kind === "IMAGE";

  if (reference.kind === "IMAGE") {
    const image = document.createElement("img");
    image.src = reference.content;
    image.alt = reference.label || "Visual reference";
    card.append(image);
    card.addEventListener("dragstart", event => {
      event.dataTransfer?.setData("application/x-go-reference", reference.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
  } else {
    const note = document.createElement("div");
    note.className = "visual-reference-note";
    note.textContent = reference.content;
    card.append(note);
  }

  const meta = document.createElement("div");
  meta.className = "visual-reference-meta";
  const label = document.createElement("span");
  label.textContent = reference.id === state.sourceReferenceId
    ? `SOURCE · ${escapeLabel(reference.label)}`
    : escapeLabel(reference.label);

  const actions = document.createElement("div");
  actions.className = "visual-reference-actions";
  if (reference.kind === "IMAGE") {
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "Source";
    use.title = "Use as source";
    use.addEventListener("click", () => setState(promoteReferenceToSource(state, reference.id)));
    actions.append(use);
  }
  if (reference.kind === "TEXT") {
    const toBrief = document.createElement("button");
    toBrief.type = "button";
    toBrief.textContent = "→ Brief";
    toBrief.addEventListener("click", () => setState(appendReferenceTextToBrief(state, reference.content)));
    actions.append(toBrief);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Remove reference";
  remove.addEventListener("click", () => setState(removeReference(state, reference.id)));
  actions.append(remove);

  meta.append(label, actions);
  card.append(meta);
  return card;
}

function renderReferences() {
  referenceList.querySelectorAll(".visual-reference-card").forEach(node => node.remove());
  state.references.forEach(reference => referenceList.append(refCard(reference)));
  referenceEmpty.hidden = state.references.length > 0;
  referenceCount.textContent = String(state.references.length);
}

function renderBrief() {
  ["intent", "prompt", "mustKeep", "mustRemove", "constraints"].forEach(name => {
    const field = q(`[data-brief-field="${name}"]`);
    if (field && field.value !== state.brief[name]) field.value = state.brief[name];
  });
  const packet = createRenderPacket(state);
  const ready = packet.unknowns.length === 0;
  packetState.textContent = ready ? "READY" : "NOT READY";
  packetState.dataset.state = ready ? "PASS" : "UNKNOWN";
  packetStatus.textContent = ready
    ? "Render packet พร้อมส่งให้ GO image tool"
    : packet.unknowns.join(" · ");

  if (pixieDraftInput && pixieDraftInput.value !== (state.pixie?.visualDraftId || "")) {
    pixieDraftInput.value = state.pixie?.visualDraftId || "";
  }
  const handshake = createPixieHandshake(state);
  if (pixieStatus) {
    pixieStatus.textContent = `${handshake.mode} · ${handshake.command} · ${handshake.unknowns.length ? handshake.unknowns.join(" · ") : "READY"}`;
  }
}

function renderCanvas() {
  const visual = activeVisual(state);
  if (!visual) {
    mainImage.hidden = true;
    mainImage.removeAttribute("src");
    canvasPlaceholder.hidden = false;
    sourceChip.hidden = true;
    mainImage.style.transform = "";
    if (zoomLevel) zoomLevel.value = "100%";
    if (selectionState) {
      selectionState.textContent = "NO SELECTION";
      selectionState.dataset.state = "UNKNOWN";
    }
    canvasCaption.textContent = "ยังไม่มีภาพบนโต๊ะ";
    return;
  }

  mainImage.src = visual.content;
  mainImage.alt = visual.kind === "SOURCE"
    ? `Source: ${visual.label}`
    : `Rendered version: ${visual.label}`;
  mainImage.hidden = false;
  canvasPlaceholder.hidden = true;
  sourceChip.hidden = visual.kind !== "SOURCE";
  mainImage.style.transform = `translate3d(${state.viewport.panX}px, ${state.viewport.panY}px, 0) scale(${state.viewport.zoom})`;
  if (zoomLevel) zoomLevel.value = `${Math.round(state.viewport.zoom * 100)}%`;
  if (selectionState) {
    selectionState.textContent = `${visual.kind} · ${visual.label}`;
    selectionState.dataset.state = "PASS";
  }
  canvasCaption.textContent = visual.kind === "SOURCE"
    ? `SOURCE · ${visual.label}`
    : `${visual.label} · render result`;
}

function renderHistory() {
  historyTrack.querySelectorAll(".visual-history-button").forEach(node => node.remove());
  state.versions.forEach(version => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "visual-history-button";
    button.setAttribute("aria-current", version.id === state.activeVersionId ? "true" : "false");
    button.title = `Open ${version.label}`;

    const image = document.createElement("img");
    image.src = version.content;
    image.alt = "";
    const label = document.createElement("span");
    label.textContent = version.label;
    button.append(image, label);
    button.addEventListener("click", () => setState(activateVersion(state, version.id)));
    historyTrack.append(button);
  });
  historyEmpty.hidden = state.versions.length > 0;
}

function renderVerify() {
  const status = state.verification.status || "IDLE";
  verifyState.textContent = status;
  verifyState.dataset.state = status;
  if (state.verification.checks?.length) {
    verifyState.title = state.verification.checks
      .map(item => `${item.checkId}: ${item.status} — ${item.detail}`)
      .join("\n");
  } else {
    verifyState.removeAttribute("title");
  }
}

function render() {
  renderReferences();
  renderBrief();
  renderCanvas();
  renderHistory();
  renderVerify();
}

async function imageFileToDataUrl(file) {
  if (!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("IMAGE_FILE_REQUIRED");
  if (file.size > MAX_IMPORT_BYTES) throw new Error("IMAGE_TOO_LARGE");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
      node.src = sourceUrl;
    });

    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNAVAILABLE");
    context.drawImage(image, 0, 0, width, height);

    const preferredType = file.type === "image/png" ? "image/png" : "image/webp";
    return canvas.toDataURL(preferredType, preferredType === "image/png" ? undefined : .86);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function addReferenceFiles(files) {
  for (const file of [...files]) {
    try {
      const content = await imageFileToDataUrl(file);
      state = addReference(state, { kind:"IMAGE", label:file.name || "Image reference", content });
    } catch (error) {
      storageStatus.textContent = ` · ${error?.message || "image import failed"}`;
    }
  }
  setState(state);
}

async function importRender(file) {
  try {
    const content = await imageFileToDataUrl(file);
    setState(addVersion(state, { content, origin:"RENDER" }));
  } catch (error) {
    storageStatus.textContent = ` · ${error?.message || "render import failed"}`;
  }
}

noteForm?.addEventListener("submit", event => {
  event.preventDefault();
  if (!noteInput.value.trim()) return;
  setState(addReference(state, { kind:"TEXT", label:"Pinned note", content:noteInput.value }));
  noteInput.value = "";
});

referenceFiles?.addEventListener("change", async () => {
  if (referenceFiles.files?.length) await addReferenceFiles(referenceFiles.files);
  referenceFiles.value = "";
});

renderFile?.addEventListener("change", async () => {
  const file = renderFile.files?.[0];
  if (file) await importRender(file);
  renderFile.value = "";
});

briefForm?.addEventListener("input", event => {
  const name = event.target?.dataset?.briefField;
  if (!name) return;
  state = updateBrief(state, { [name]:event.target.value });
  persistSoon();
  renderBrief();
  renderVerify();
});

selectionToBrief?.addEventListener("click", () => {
  const selection = window.getSelection?.();
  const selectedText = selection?.toString?.().trim() || "";
  const anchorNode = selection?.anchorNode;
  const insideReference = anchorNode && referenceList.contains(anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement);
  if (!insideReference || !selectedText) {
    packetStatus.textContent = "เลือกข้อความจากโน้ต Reference ก่อน";
    return;
  }
  setState(appendReferenceTextToBrief(state, selectedText));
  selection.removeAllRanges?.();
});

copyPacketButton?.addEventListener("click", async () => {
  const packet = createRenderPacket(state);
  const body = JSON.stringify(packet, null, 2);
  try {
    await navigator.clipboard.writeText(body);
    packetStatus.textContent = packet.unknowns.length
      ? `Copied with UNKNOWN: ${packet.unknowns.join(" · ")}`
      : "Render packet copied";
  } catch {
    packetStatus.textContent = "Clipboard unavailable — packet not copied";
  }
});

pixieDraftInput?.addEventListener("change", () => {
  setState(attachPixieDraft(state, pixieDraftInput.value));
});

copyPixieHandshakeButton?.addEventListener("click", async () => {
  const handshake = createPixieHandshake(state);
  try {
    await navigator.clipboard.writeText(JSON.stringify(handshake, null, 2));
    if (pixieStatus) {
      pixieStatus.textContent = handshake.unknowns.length
        ? `Copied with UNKNOWN: ${handshake.unknowns.join(" · ")}`
        : `Copied · ${handshake.command}`;
    }
  } catch {
    if (pixieStatus) pixieStatus.textContent = "Clipboard unavailable — handshake not copied";
  }
});

verifyButton?.addEventListener("click", () => {
  setState(verifyLocalDraft(state));
});

dropzone?.addEventListener("dragover", event => {
  event.preventDefault();
  dropzone.classList.add("is-dragover");
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});

dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-dragover"));

dropzone?.addEventListener("drop", async event => {
  event.preventDefault();
  dropzone.classList.remove("is-dragover");
  const referenceId = event.dataTransfer?.getData("application/x-go-reference");
  if (referenceId) {
    try {
      setState(promoteReferenceToSource(state, referenceId));
    } catch (error) {
      packetStatus.textContent = error?.message || "Unable to use reference";
    }
    return;
  }
  const image = [...(event.dataTransfer?.files || [])].find(file => file.type.startsWith("image/"));
  if (!image) return;
  try {
    const content = await imageFileToDataUrl(image);
    state = addReference(state, { kind:"IMAGE", label:image.name || "Dropped source", content });
    const reference = state.references.at(-1);
    setState(promoteReferenceToSource(state, reference.id));
  } catch (error) {
    packetStatus.textContent = error?.message || "Unable to import source";
  }
});

function nudgeViewport({ zoomDelta = 0, panX = 0, panY = 0, reset = false } = {}) {
  const nextState = reset
    ? resetViewport(state)
    : setViewport(state, {
        zoom:state.viewport.zoom + zoomDelta,
        panX:state.viewport.panX + panX,
        panY:state.viewport.panY + panY,
      });
  state = nextState;
  persistSoon();
  renderCanvas();
}

zoomOutButton?.addEventListener("click", () => nudgeViewport({ zoomDelta:-.15 }));
zoomInButton?.addEventListener("click", () => nudgeViewport({ zoomDelta:.15 }));
resetViewButton?.addEventListener("click", () => nudgeViewport({ reset:true }));

dropzone?.addEventListener("wheel", event => {
  if (!activeVisual(state)) return;
  event.preventDefault();
  nudgeViewport({ zoomDelta:event.deltaY < 0 ? .1 : -.1 });
}, { passive:false });

dropzone?.addEventListener("pointerdown", event => {
  if (!activeVisual(state) || event.button !== 0) return;
  panGesture = {
    pointerId:event.pointerId,
    startX:event.clientX,
    startY:event.clientY,
    panX:state.viewport.panX,
    panY:state.viewport.panY,
  };
  dropzone.setPointerCapture?.(event.pointerId);
  dropzone.classList.add("is-panning");
});

dropzone?.addEventListener("pointermove", event => {
  if (!panGesture || panGesture.pointerId !== event.pointerId) return;
  state = setViewport(state, {
    panX:panGesture.panX + (event.clientX - panGesture.startX),
    panY:panGesture.panY + (event.clientY - panGesture.startY),
  });
  renderCanvas();
});

function endPan(event) {
  if (!panGesture || (event && panGesture.pointerId !== event.pointerId)) return;
  panGesture = null;
  dropzone?.classList.remove("is-panning");
  persistSoon();
}

dropzone?.addEventListener("pointerup", endPan);
dropzone?.addEventListener("pointercancel", endPan);

dropzone?.addEventListener("keydown", event => {
  const visual = activeVisual(state);
  if ((event.key === "Enter" || event.key === " ") && !visual) {
    event.preventDefault();
    renderFile?.click();
    return;
  }
  if (!visual) return;
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    nudgeViewport({ zoomDelta:.15 });
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    nudgeViewport({ zoomDelta:-.15 });
  } else if (event.key === "0") {
    event.preventDefault();
    nudgeViewport({ reset:true });
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    nudgeViewport({ panX:-24 });
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    nudgeViewport({ panX:24 });
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    nudgeViewport({ panY:-24 });
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    nudgeViewport({ panY:24 });
  }
});

render();

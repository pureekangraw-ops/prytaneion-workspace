const MAX_REFERENCES = 12;
const MAX_VERSIONS = 12;
const MAX_TEXT_CHARS = 6000;
const MAX_STORAGE_CHARS = 4_500_000;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const text = value => String(value ?? "").trim();
const lines = value => [...new Set(String(value ?? "").split(/\n|,/).map(item => item.trim()).filter(Boolean))];

function trimText(value, max = MAX_TEXT_CHARS) {
  return String(value ?? "").slice(0, max);
}

function imageData(value) {
  const out = String(value ?? "");
  return /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(out) ? out : null;
}

function id(prefix = "ITEM") {
  const cryptoId = globalThis.crypto?.randomUUID?.();
  return cryptoId ? `${prefix}-${cryptoId}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeReference(item = {}) {
  const kind = String(item.kind || "").toUpperCase() === "TEXT" ? "TEXT" : "IMAGE";
  const content = kind === "IMAGE" ? imageData(item.content) : trimText(item.content);
  if (!content) return null;
  return {
    id: text(item.id) || id("REF"),
    kind,
    label: trimText(item.label || (kind === "IMAGE" ? "Image reference" : "Note"), 140),
    content,
    createdAt: text(item.createdAt) || new Date().toISOString(),
  };
}

function normalizeVersion(item = {}, index = 0) {
  const content = imageData(item.content);
  if (!content) return null;
  return {
    id: text(item.id) || id("VER"),
    label: trimText(item.label || `V${index + 1}`, 48),
    content,
    origin: text(item.origin || "RENDER").toUpperCase(),
    createdAt: text(item.createdAt) || new Date().toISOString(),
  };
}

export function createVisualWorkbenchState(seed = {}) {
  const references = (Array.isArray(seed.references) ? seed.references : [])
    .map(normalizeReference).filter(Boolean).slice(-MAX_REFERENCES);
  const versions = (Array.isArray(seed.versions) ? seed.versions : [])
    .map(normalizeVersion).filter(Boolean).slice(-MAX_VERSIONS);
  const sourceReferenceId = references.some(item => item.id === seed.sourceReferenceId)
    ? seed.sourceReferenceId
    : null;
  const activeVersionId = versions.some(item => item.id === seed.activeVersionId)
    ? seed.activeVersionId
    : (versions.at(-1)?.id || null);
  const requestedSelectionKind = String(seed.selection?.kind || "").toUpperCase();
  const requestedSelectionId = text(seed.selection?.id);
  const selection = requestedSelectionKind === "SOURCE" && references.some(item => item.id === requestedSelectionId && item.kind === "IMAGE")
    ? { kind:"SOURCE", id:requestedSelectionId }
    : requestedSelectionKind === "VERSION" && versions.some(item => item.id === requestedSelectionId)
      ? { kind:"VERSION", id:requestedSelectionId }
      : activeVersionId
        ? { kind:"VERSION", id:activeVersionId }
        : sourceReferenceId
          ? { kind:"SOURCE", id:sourceReferenceId }
          : null;
  const rawZoom = Number(seed.viewport?.zoom);
  const rawPanX = Number(seed.viewport?.panX);
  const rawPanY = Number(seed.viewport?.panY);
  const viewport = {
    zoom:Number.isFinite(rawZoom) ? Math.min(4, Math.max(.5, rawZoom)) : 1,
    panX:Number.isFinite(rawPanX) ? Math.min(4000, Math.max(-4000, rawPanX)) : 0,
    panY:Number.isFinite(rawPanY) ? Math.min(4000, Math.max(-4000, rawPanY)) : 0,
  };

  return {
    schemaVersion: 1,
    draftId: text(seed.draftId) || id("VISUAL-DRAFT"),
    references,
    sourceReferenceId,
    selection,
    viewport,
    pixie:{
      visualDraftId:text(seed.pixie?.visualDraftId) || null,
    },
    brief: {
      intent: trimText(seed.brief?.intent, 1200),
      prompt: trimText(seed.brief?.prompt),
      mustKeep: trimText(seed.brief?.mustKeep, 2400),
      mustRemove: trimText(seed.brief?.mustRemove, 2400),
      constraints: trimText(seed.brief?.constraints, 2400),
    },
    versions,
    activeVersionId,
    verification: {
      status: ["PASS", "FAIL", "UNKNOWN", "IDLE"].includes(String(seed.verification?.status || "").toUpperCase())
        ? String(seed.verification.status).toUpperCase()
        : "IDLE",
      checks: Array.isArray(seed.verification?.checks) ? clone(seed.verification.checks).slice(0, 12) : [],
    },
    updatedAt: text(seed.updatedAt) || new Date().toISOString(),
  };
}

function next(state, patch = {}) {
  return createVisualWorkbenchState({
    ...clone(state),
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function addReference(state, input = {}) {
  const current = createVisualWorkbenchState(state);
  const reference = normalizeReference(input);
  if (!reference) throw new Error("VISUAL_REFERENCE_INVALID");
  const references = [...current.references.filter(item => item.id !== reference.id), reference].slice(-MAX_REFERENCES);
  return next(current, { references });
}

export function removeReference(state, referenceId) {
  const current = createVisualWorkbenchState(state);
  const target = text(referenceId);
  const references = current.references.filter(item => item.id !== target);
  const sourceReferenceId = current.sourceReferenceId === target ? null : current.sourceReferenceId;
  return next(current, { references, sourceReferenceId });
}

export function promoteReferenceToSource(state, referenceId) {
  const current = createVisualWorkbenchState(state);
  const target = current.references.find(item => item.id === text(referenceId));
  if (!target) throw new Error("VISUAL_REFERENCE_NOT_FOUND");
  if (target.kind !== "IMAGE") throw new Error("VISUAL_SOURCE_IMAGE_REQUIRED");
  return next(current, {
    sourceReferenceId: target.id,
    selection:{ kind:"SOURCE", id:target.id },
    verification:{ status:"IDLE", checks:[] },
  });
}

export function updateBrief(state, patch = {}) {
  const current = createVisualWorkbenchState(state);
  return next(current, {
    brief: {
      ...current.brief,
      ...(Object.hasOwn(patch, "intent") ? { intent:trimText(patch.intent, 1200) } : {}),
      ...(Object.hasOwn(patch, "prompt") ? { prompt:trimText(patch.prompt) } : {}),
      ...(Object.hasOwn(patch, "mustKeep") ? { mustKeep:trimText(patch.mustKeep, 2400) } : {}),
      ...(Object.hasOwn(patch, "mustRemove") ? { mustRemove:trimText(patch.mustRemove, 2400) } : {}),
      ...(Object.hasOwn(patch, "constraints") ? { constraints:trimText(patch.constraints, 2400) } : {}),
    },
    verification:{ status:"IDLE", checks:[] },
  });
}

export function appendReferenceTextToBrief(state, value) {
  const current = createVisualWorkbenchState(state);
  const addition = trimText(value);
  if (!text(addition)) return current;
  const prompt = [current.brief.prompt, addition].filter(item => text(item)).join("\n\n");
  return updateBrief(current, { prompt });
}

export function addVersion(state, input = {}) {
  const current = createVisualWorkbenchState(state);
  const version = normalizeVersion({
    ...input,
    label: input.label || `V${current.versions.length + 1}`,
  }, current.versions.length);
  if (!version) throw new Error("VISUAL_VERSION_IMAGE_REQUIRED");
  const versions = [...current.versions.filter(item => item.id !== version.id), version].slice(-MAX_VERSIONS);
  return next(current, {
    versions,
    activeVersionId:version.id,
    selection:{ kind:"VERSION", id:version.id },
    verification:{ status:"IDLE", checks:[] },
  });
}

export function activateVersion(state, versionId) {
  const current = createVisualWorkbenchState(state);
  const target = current.versions.find(item => item.id === text(versionId));
  if (!target) throw new Error("VISUAL_VERSION_NOT_FOUND");
  return next(current, { activeVersionId:target.id, selection:{ kind:"VERSION", id:target.id } });
}

export function setViewport(state, patch = {}) {
  const current = createVisualWorkbenchState(state);
  return next(current, {
    viewport:{
      zoom:Object.hasOwn(patch, "zoom") ? patch.zoom : current.viewport.zoom,
      panX:Object.hasOwn(patch, "panX") ? patch.panX : current.viewport.panX,
      panY:Object.hasOwn(patch, "panY") ? patch.panY : current.viewport.panY,
    },
  });
}

export function resetViewport(state) {
  return setViewport(state, { zoom:1, panX:0, panY:0 });
}

export function attachPixieDraft(state, visualDraftId) {
  const current = createVisualWorkbenchState(state);
  return next(current, { pixie:{ visualDraftId:text(visualDraftId) || null } });
}

export function activeVisual(state) {
  const current = createVisualWorkbenchState(state);
  if (current.selection?.kind === "SOURCE") {
    const source = current.references.find(item => item.id === current.selection.id && item.kind === "IMAGE") || null;
    if (source) return { kind:"SOURCE", id:source.id, label:source.label, content:source.content };
  }
  if (current.selection?.kind === "VERSION") {
    const version = current.versions.find(item => item.id === current.selection.id) || null;
    if (version) return { kind:"VERSION", id:version.id, label:version.label, content:version.content };
  }
  const version = current.versions.find(item => item.id === current.activeVersionId) || null;
  if (version) return { kind:"VERSION", id:version.id, label:version.label, content:version.content };
  const source = current.references.find(item => item.id === current.sourceReferenceId && item.kind === "IMAGE") || null;
  if (source) return { kind:"SOURCE", id:source.id, label:source.label, content:source.content };
  return null;
}

export function createRenderPacket(state, { packetId = null } = {}) {
  const current = createVisualWorkbenchState(state);
  const source = current.references.find(item => item.id === current.sourceReferenceId && item.kind === "IMAGE") || null;
  const unknowns = [];
  if (!source) unknowns.push("SOURCE_IMAGE_NOT_SELECTED");
  if (!text(current.brief.intent)) unknowns.push("INTENT_MISSING");
  if (!text(current.brief.prompt)) unknowns.push("PROMPT_MISSING");

  return {
    packetId:text(packetId) || id("RENDER-PACKET"),
    visualDraftId:current.draftId,
    sourceRef:source ? `local-reference://${source.id}` : null,
    sourceLabel:source?.label || null,
    workingSpec:{
      layout:"TWO_CLIPBOARDS_ONE_MAIN_WORKSPACE",
      sourceLocked:Boolean(source),
      versionCount:current.versions.length,
    },
    intent:current.brief.intent,
    requestedResult:current.brief.prompt,
    mustKeep:lines(current.brief.mustKeep),
    mustRemove:lines(current.brief.mustRemove),
    copy:[],
    constraints:lines(current.brief.constraints),
    evidenceRefs:[],
    unknowns,
    targetTool:"GO_IMAGE_TOOL",
    externalExecutionRequired:true,
    imageGenerationAuthority:false,
    productionAuthority:false,
    approval:"NOT_AN_APPROVAL",
  };
}

export function createPixieHandshake(state) {
  const current = createVisualWorkbenchState(state);
  const source = current.references.find(item => item.id === current.sourceReferenceId && item.kind === "IMAGE") || null;
  const linkedDraftId = text(current.pixie?.visualDraftId) || null;
  const unknowns = [];
  if (!source) unknowns.push("SOURCE_IMAGE_NOT_SELECTED");
  if (!linkedDraftId) {
    unknowns.push("PIXIE_DRAFT_NOT_LINKED");
    unknowns.push("SOURCE_VERSION_UNKNOWN");
    unknowns.push("SOURCE_HASH_UNKNOWN");
  }
  return {
    protocol:"PIXIE_VISUAL_HANDSHAKE_V1",
    mode:linkedDraftId ? "COMPARE_EXISTING" : "PREPARE_CREATE",
    command:linkedDraftId ? "visual_compare" : "visual_create",
    args:linkedDraftId
      ? { visualDraftId:linkedDraftId }
      : {
          visualDraftId:current.draftId,
          sourceRef:source ? `local-reference://${source.id}` : null,
          sourceVersion:"unknown",
          sourceHash:null,
          spec:{
            brief:clone(current.brief),
            sourceReferenceId:current.sourceReferenceId,
            selectedVisual:clone(current.selection),
            versionCount:current.versions.length,
          },
        },
    unknowns,
    externalDispatchRequired:true,
    browserMutationAuthority:false,
    imageGenerationAuthority:false,
    approval:"NOT_AN_APPROVAL",
  };
}

export function verifyLocalDraft(state) {
  const current = createVisualWorkbenchState(state);
  const source = current.references.find(item => item.id === current.sourceReferenceId && item.kind === "IMAGE") || null;
  const active = current.versions.find(item => item.id === current.activeVersionId) || null;
  const checks = [
    { checkId:"SOURCE", status:source ? "PASS" : "UNKNOWN", detail:source ? source.label : "No source image selected" },
    { checkId:"INTENT", status:text(current.brief.intent) ? "PASS" : "UNKNOWN", detail:text(current.brief.intent) ? "Intent present" : "Intent missing" },
    { checkId:"PROMPT", status:text(current.brief.prompt) ? "PASS" : "UNKNOWN", detail:text(current.brief.prompt) ? "Prompt present" : "Prompt missing" },
    { checkId:"RENDER", status:active ? "PASS" : "UNKNOWN", detail:active ? active.label : "No rendered version imported" },
  ];
  const status = checks.some(item => item.status === "FAIL")
    ? "FAIL"
    : checks.some(item => item.status === "UNKNOWN")
      ? "UNKNOWN"
      : "PASS";
  return next(current, { verification:{ status, checks } });
}

export function storagePayload(state) {
  const current = createVisualWorkbenchState(state);
  const encoded = JSON.stringify(current);
  if (encoded.length > MAX_STORAGE_CHARS) throw new Error("VISUAL_WORKBENCH_STORAGE_BUDGET_EXCEEDED");
  return encoded;
}

export const VISUAL_WORKBENCH_LIMITS = Object.freeze({
  maxReferences:MAX_REFERENCES,
  maxVersions:MAX_VERSIONS,
  maxTextChars:MAX_TEXT_CHARS,
  maxStorageChars:MAX_STORAGE_CHARS,
});

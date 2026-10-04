const SCHEMA_VERSION = 1;
const MAX_NODES = 2_000;
const MAX_FRAMES = 64;
const MAX_VERSIONS = 100;
const MAX_INTERACTIONS = 1_000;
const STATUS_VALUES = new Set(["DRAFT", "REVIEW", "APPROVED", "HANDED_OFF", "RENDERED", "VERIFIED"]);
const NODE_KINDS = new Set(["RECTANGLE", "ELLIPSE", "LINE", "PATH", "IMAGE", "TEXT", "GROUP", "COMPONENT_INSTANCE"]);
const LAYOUT_MODES = new Set(["NONE", "STACK"]);
const SIZING_MODES = new Set(["FIXED", "HUG", "FILL"]);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 1) => Math.max(1, finite(value, fallback));
const nowIso = () => new Date().toISOString();
const required = (value, code) => {
  const output = text(value);
  if (!output) throw new Error(code);
  return output;
};
const unique = values => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];

function normalizeProvenance(value = {}) {
  return {
    workId: text(value.workId) || null,
    decisionRef: text(value.decisionRef) || null,
    promptRef: text(value.promptRef) || null,
    sourceRef: text(value.sourceRef) || null,
    approvedVersionId: text(value.approvedVersionId) || null,
    evidenceRefs: unique(value.evidenceRefs),
  };
}

function normalizeLayout(value = {}) {
  const direction = upper(value.direction) === "ROW" ? "ROW" : "COLUMN";
  const mode = LAYOUT_MODES.has(upper(value.mode)) ? upper(value.mode) : "NONE";
  const sizing = key => SIZING_MODES.has(upper(value[key])) ? upper(value[key]) : "FIXED";
  const padding = Array.isArray(value.padding) ? value.padding.slice(0, 4).map(item => Math.max(0, finite(item))) : [0, 0, 0, 0];
  while (padding.length < 4) padding.push(padding.at(-1) || 0);
  return {
    mode,
    direction,
    gap: Math.max(0, finite(value.gap)),
    padding,
    align: upper(value.align) || "START",
    justify: upper(value.justify) || "START",
    width: sizing("width"),
    height: sizing("height"),
  };
}

function normalizeNode(value = {}, index = 0) {
  const kind = upper(value.kind || "RECTANGLE");
  if (!NODE_KINDS.has(kind)) throw new Error("UI_DESIGN_NODE_KIND_INVALID");
  const nodeId = text(value.nodeId) || id(`NODE-${kind}`);
  return {
    nodeId,
    kind,
    name: text(value.name) || `${kind} ${index + 1}`,
    parentId: text(value.parentId) || null,
    children: unique(value.children),
    geometry: {
      x: finite(value.geometry?.x),
      y: finite(value.geometry?.y),
      width: positive(value.geometry?.width, 120),
      height: positive(value.geometry?.height, 48),
      rotation: finite(value.geometry?.rotation),
    },
    layout: normalizeLayout(value.layout),
    style: clone(value.style || {}),
    text: kind === "TEXT" ? text(value.text) : null,
    componentId: text(value.componentId) || null,
    variant: text(value.variant) || null,
    state: text(value.state) || null,
    provenance: normalizeProvenance(value.provenance),
  };
}

function normalizeFrame(value = {}, index = 0) {
  return {
    frameId: text(value.frameId) || id("FRAME"),
    name: text(value.name) || `Frame ${index + 1}`,
    width: positive(value.width, 390),
    height: positive(value.height, 844),
    device: text(value.device) || null,
    children: unique(value.children),
    background: clone(value.background || null),
  };
}

function normalizeInteraction(value = {}, index = 0) {
  const event = upper(value.event || "CLICK");
  const action = upper(value.action || "NAVIGATE");
  if (!event || !action) throw new Error("UI_DESIGN_INTERACTION_INVALID");
  return {
    interactionId: text(value.interactionId) || id(`INTERACTION-${index + 1}`),
    fromNodeId: required(value.fromNodeId, "UI_DESIGN_INTERACTION_SOURCE_REQUIRED"),
    event,
    action,
    targetId: text(value.targetId) || null,
    transition: text(value.transition) || "INSTANT",
  };
}

function validateUnique(items, key, code, errors) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) errors.push(`${code}:${item[key]}`);
    seen.add(item[key]);
  }
}

function normalizeDocument(seed = {}) {
  const frames = (Array.isArray(seed.frames) ? seed.frames : []).slice(0, MAX_FRAMES).map(normalizeFrame);
  const nodes = (Array.isArray(seed.nodes) ? seed.nodes : []).slice(0, MAX_NODES).map(normalizeNode);
  const interactions = (Array.isArray(seed.interactions) ? seed.interactions : []).slice(0, MAX_INTERACTIONS).map(normalizeInteraction);
  const versions = (Array.isArray(seed.versions) ? seed.versions : []).slice(-MAX_VERSIONS).map(item => ({
    versionId: required(item.versionId, "UI_DESIGN_VERSION_ID_REQUIRED"),
    label: text(item.label) || "Snapshot",
    parentVersionId: text(item.parentVersionId) || null,
    changeSummary: text(item.changeSummary) || null,
    createdAt: text(item.createdAt) || nowIso(),
    createdBy: text(item.createdBy) || "GO",
    snapshot: clone(item.snapshot),
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    designId: text(seed.designId) || id("DESIGN"),
    workId: text(seed.workId) || null,
    status: STATUS_VALUES.has(upper(seed.status)) ? upper(seed.status) : "DRAFT",
    approvedVersionId: text(seed.approvedVersionId) || null,
    frames,
    nodes,
    interactions,
    tokens: clone(seed.tokens || {}),
    versions,
    provenance: normalizeProvenance(seed.provenance),
    createdAt: text(seed.createdAt) || nowIso(),
    updatedAt: text(seed.updatedAt) || nowIso(),
  };
}

export function createUiDesignDocument(seed = {}) {
  const document = normalizeDocument(seed);
  const result = validateUiDesignDocument(document);
  if (!result.ok) throw new Error(`UI_DESIGN_INVALID:${result.errors.join(",")}`);
  return document;
}

function next(document, patch = {}) {
  return createUiDesignDocument({ ...clone(document), ...patch, updatedAt: nowIso() });
}

function childrenOf(document, parentId) {
  return document.nodes.filter(node => node.parentId === parentId).map(node => node.nodeId);
}

function withChildren(document) {
  const frames = document.frames.map(frame => ({ ...frame, children: childrenOf(document, frame.frameId) }));
  const nodes = document.nodes.map(node => ({ ...node, children: childrenOf(document, node.nodeId) }));
  return { ...document, frames, nodes };
}

export function addFrame(document, input = {}) {
  const current = createUiDesignDocument(document);
  if (current.frames.length >= MAX_FRAMES) throw new Error("UI_DESIGN_FRAME_LIMIT");
  const frame = normalizeFrame(input, current.frames.length);
  if (current.frames.some(item => item.frameId === frame.frameId)) throw new Error("UI_DESIGN_FRAME_ID_DUPLICATE");
  return next(current, { frames: [...current.frames, frame] });
}

export function addNode(document, input = {}) {
  const current = createUiDesignDocument(document);
  if (current.nodes.length >= MAX_NODES) throw new Error("UI_DESIGN_NODE_LIMIT");
  const node = normalizeNode(input, current.nodes.length);
  const parentId = required(node.parentId, "UI_DESIGN_NODE_PARENT_REQUIRED");
  const parentExists = current.frames.some(frame => frame.frameId === parentId) || current.nodes.some(item => item.nodeId === parentId);
  if (!parentExists) throw new Error("UI_DESIGN_NODE_PARENT_NOT_FOUND");
  if (current.nodes.some(item => item.nodeId === node.nodeId)) throw new Error("UI_DESIGN_NODE_ID_DUPLICATE");
  return next(withChildren({ ...current, nodes: [...current.nodes, node] }));
}

export function updateNode(document, nodeId, patch = {}) {
  const current = createUiDesignDocument(document);
  const targetId = required(nodeId, "UI_DESIGN_NODE_ID_REQUIRED");
  if (!current.nodes.some(node => node.nodeId === targetId)) throw new Error("UI_DESIGN_NODE_NOT_FOUND");
  const nodes = current.nodes.map(node => {
    if (node.nodeId !== targetId) return node;
    const nextNode = normalizeNode({ ...node, ...clone(patch), nodeId: node.nodeId, parentId: node.parentId }, 0);
    return nextNode;
  });
  return next(withChildren({ ...current, nodes }));
}

export function moveNode(document, nodeId, parentId) {
  const current = createUiDesignDocument(document);
  const targetId = required(nodeId, "UI_DESIGN_NODE_ID_REQUIRED");
  const nextParentId = required(parentId, "UI_DESIGN_NODE_PARENT_REQUIRED");
  const node = current.nodes.find(item => item.nodeId === targetId);
  if (!node) throw new Error("UI_DESIGN_NODE_NOT_FOUND");
  if (targetId === nextParentId) throw new Error("UI_DESIGN_NODE_CYCLE");
  const parentExists = current.frames.some(frame => frame.frameId === nextParentId) || current.nodes.some(item => item.nodeId === nextParentId);
  if (!parentExists) throw new Error("UI_DESIGN_NODE_PARENT_NOT_FOUND");
  let cursor = nextParentId;
  while (cursor) {
    if (cursor === targetId) throw new Error("UI_DESIGN_NODE_CYCLE");
    cursor = current.nodes.find(item => item.nodeId === cursor)?.parentId || null;
  }
  const nodes = current.nodes.map(item => item.nodeId === targetId ? { ...item, parentId: nextParentId } : item);
  return next(withChildren({ ...current, nodes }));
}

export function removeNode(document, nodeId) {
  const current = createUiDesignDocument(document);
  const targetId = required(nodeId, "UI_DESIGN_NODE_ID_REQUIRED");
  if (!current.nodes.some(node => node.nodeId === targetId)) throw new Error("UI_DESIGN_NODE_NOT_FOUND");
  const removed = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of current.nodes) {
      if (node.parentId && removed.has(node.parentId) && !removed.has(node.nodeId)) {
        removed.add(node.nodeId);
        changed = true;
      }
    }
  }
  const nodes = current.nodes.filter(node => !removed.has(node.nodeId));
  const interactions = current.interactions.filter(item => !removed.has(item.fromNodeId) && !removed.has(item.targetId));
  return next(withChildren({ ...current, nodes, interactions }));
}

export function addInteraction(document, input = {}) {
  const current = createUiDesignDocument(document);
  const interaction = normalizeInteraction(input, current.interactions.length);
  const ids = new Set([...current.frames.map(frame => frame.frameId), ...current.nodes.map(node => node.nodeId)]);
  if (!ids.has(interaction.fromNodeId)) throw new Error("UI_DESIGN_INTERACTION_SOURCE_NOT_FOUND");
  if (interaction.targetId && !ids.has(interaction.targetId)) throw new Error("UI_DESIGN_INTERACTION_TARGET_NOT_FOUND");
  if (current.interactions.some(item => item.interactionId === interaction.interactionId)) throw new Error("UI_DESIGN_INTERACTION_ID_DUPLICATE");
  return next(current, { interactions: [...current.interactions, interaction] });
}

export function setTokens(document, tokens = {}) {
  const current = createUiDesignDocument(document);
  return next(current, { tokens: clone(tokens) });
}

export function validateUiDesignDocument(document) {
  const candidate = document || {};
  const errors = [];
  const warnings = [];
  const frames = Array.isArray(candidate.frames) ? candidate.frames : [];
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes : [];
  const interactions = Array.isArray(candidate.interactions) ? candidate.interactions : [];
  validateUnique(frames, "frameId", "FRAME_DUPLICATE", errors);
  validateUnique(nodes, "nodeId", "NODE_DUPLICATE", errors);
  validateUnique(interactions, "interactionId", "INTERACTION_DUPLICATE", errors);
  const ids = new Set([...frames.map(item => item.frameId), ...nodes.map(item => item.nodeId)]);
  for (const frame of frames) {
    if (!(positive(frame.width) > 0 && positive(frame.height) > 0)) errors.push(`FRAME_SIZE_INVALID:${frame.frameId}`);
  }
  for (const node of nodes) {
    if (!node.parentId || !ids.has(node.parentId)) errors.push(`NODE_PARENT_INVALID:${node.nodeId}`);
    if (!(positive(node.geometry?.width) > 0 && positive(node.geometry?.height) > 0)) errors.push(`NODE_SIZE_INVALID:${node.nodeId}`);
    if (node.parentId === node.nodeId) errors.push(`NODE_SELF_PARENT:${node.nodeId}`);
  }
  for (const interaction of interactions) {
    if (!ids.has(interaction.fromNodeId)) errors.push(`INTERACTION_SOURCE_INVALID:${interaction.interactionId}`);
    if (interaction.targetId && !ids.has(interaction.targetId)) errors.push(`INTERACTION_TARGET_INVALID:${interaction.interactionId}`);
  }
  if (upper(candidate.status) === "APPROVED" && !text(candidate.approvedVersionId)) errors.push("APPROVED_VERSION_REQUIRED");
  if (!text(candidate.workId)) warnings.push("WORK_ID_MISSING");
  if (!frames.length) warnings.push("NO_FRAME");
  return { ok: errors.length === 0, errors, warnings };
}

function snapshotOf(document) {
  const current = createUiDesignDocument(document);
  const { versions, ...snapshot } = clone(current);
  return { ...snapshot, versions: [] };
}

export function createDesignVersion(document, { versionId = null, label = null, changeSummary = null, createdBy = "GO" } = {}) {
  const current = createUiDesignDocument(document);
  const version = {
    versionId: text(versionId) || id("DESIGN-VERSION"),
    label: text(label) || `V${current.versions.length + 1}`,
    parentVersionId: current.versions.at(-1)?.versionId || null,
    changeSummary: text(changeSummary) || null,
    createdAt: nowIso(),
    createdBy: text(createdBy) || "GO",
    snapshot: snapshotOf(current),
  };
  if (current.versions.some(item => item.versionId === version.versionId)) throw new Error("UI_DESIGN_VERSION_ID_DUPLICATE");
  return next(current, { versions: [...current.versions, version].slice(-MAX_VERSIONS) });
}

export function compareDesignVersions(document, leftVersionId, rightVersionId) {
  const current = createUiDesignDocument(document);
  const left = current.versions.find(item => item.versionId === text(leftVersionId));
  const right = current.versions.find(item => item.versionId === text(rightVersionId));
  if (!left || !right) throw new Error("UI_DESIGN_VERSION_NOT_FOUND");
  const leftSnapshot = snapshotOf(left.snapshot);
  const rightSnapshot = snapshotOf(right.snapshot);
  const leftNodes = new Map(leftSnapshot.nodes.map(node => [node.nodeId, node]));
  const rightNodes = new Map(rightSnapshot.nodes.map(node => [node.nodeId, node]));
  const nodeIds = [...new Set([...leftNodes.keys(), ...rightNodes.keys()])];
  const changedNodeIds = nodeIds.filter(nodeId => JSON.stringify(leftNodes.get(nodeId) || null) !== JSON.stringify(rightNodes.get(nodeId) || null));
  const frameIds = [...new Set([...leftSnapshot.frames.map(frame => frame.frameId), ...rightSnapshot.frames.map(frame => frame.frameId)])];
  const leftFrames = new Map(leftSnapshot.frames.map(frame => [frame.frameId, frame]));
  const rightFrames = new Map(rightSnapshot.frames.map(frame => [frame.frameId, frame]));
  const changedFrameIds = frameIds.filter(frameId => JSON.stringify(leftFrames.get(frameId) || null) !== JSON.stringify(rightFrames.get(frameId) || null));
  return {
    leftVersionId: left.versionId,
    rightVersionId: right.versionId,
    changed: changedNodeIds.length > 0 || changedFrameIds.length > 0 || JSON.stringify(leftSnapshot.interactions) !== JSON.stringify(rightSnapshot.interactions) || JSON.stringify(leftSnapshot.tokens) !== JSON.stringify(rightSnapshot.tokens),
    changedNodeIds,
    changedFrameIds,
    interactionsChanged: JSON.stringify(leftSnapshot.interactions) !== JSON.stringify(rightSnapshot.interactions),
    tokensChanged: JSON.stringify(leftSnapshot.tokens) !== JSON.stringify(rightSnapshot.tokens),
  };
}

export function restoreDesignVersion(document, versionId) {
  const current = createUiDesignDocument(document);
  const version = current.versions.find(item => item.versionId === text(versionId));
  if (!version) throw new Error("UI_DESIGN_VERSION_NOT_FOUND");
  return next(current, {
    ...snapshotOf(version.snapshot),
    status: "DRAFT",
    approvedVersionId: null,
    versions: current.versions,
    provenance: { ...current.provenance, approvedVersionId: null },
  });
}

export function approveDesignVersion(document, versionId, { decisionRef = null, approvedBy = "GO" } = {}) {
  const current = createUiDesignDocument(document);
  const version = current.versions.find(item => item.versionId === text(versionId));
  if (!version) throw new Error("UI_DESIGN_VERSION_NOT_FOUND");
  const provenance = { ...current.provenance, decisionRef: text(decisionRef) || current.provenance.decisionRef, approvedVersionId: version.versionId };
  return next(current, { status: "APPROVED", approvedVersionId: version.versionId, provenance: { ...provenance, approvedBy: text(approvedBy) || "GO" } });
}

export function createDesignHandoffPacket(document, { packetId = null, target = "PIXIE" } = {}) {
  const current = createUiDesignDocument(document);
  if (current.status !== "APPROVED" || !current.approvedVersionId) throw new Error("UI_DESIGN_APPROVAL_REQUIRED");
  const version = current.versions.find(item => item.versionId === current.approvedVersionId);
  if (!version) throw new Error("UI_DESIGN_APPROVED_VERSION_NOT_FOUND");
  const validation = validateUiDesignDocument(current);
  if (!validation.ok) throw new Error(`UI_DESIGN_HANDOFF_INVALID:${validation.errors.join(",")}`);
  return {
    packetId: text(packetId) || id("UI-DESIGN-PACKET"),
    protocol: "GO_UI_DESIGN_HANDOFF_V1",
    designId: current.designId,
    workId: current.workId,
    target: text(target) || "PIXIE",
    approvedVersionId: current.approvedVersionId,
    scene: snapshotOf(version.snapshot),
    provenance: clone(current.provenance),
    evidenceRefs: unique(current.provenance.evidenceRefs),
    unknowns: validation.warnings,
    externalExecutionRequired: true,
    productionAuthority: false,
    approval: "APPROVED",
    createdAt: nowIso(),
  };
}

export function serializeUiDesignDocument(document) {
  return JSON.stringify(createUiDesignDocument(document));
}

export const UI_DESIGN_SCHEMA = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  maxNodes: MAX_NODES,
  maxFrames: MAX_FRAMES,
  statuses: [...STATUS_VALUES],
  nodeKinds: [...NODE_KINDS],
});

"use strict";

export const COMPARISON_STATUSES = Object.freeze([
  "MATCH",
  "DIFFERENT",
  "CONFLICT",
  "STALE?",
  "UNKNOWN",
  "NOT COMPARABLE",
]);

const STATUS_SET = new Set(COMPARISON_STATUSES);
const NON_LIVE = new Set(["UNKNOWN", "STALE", "STALE?", "CONFLICT"]);

function text(value) {
  return String(value ?? "").trim();
}

function required(value, label) {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function iso(clock) {
  return new Date((typeof clock === "function" ? clock() : Date.now())).toISOString();
}

function references(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("Mission Card references must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Mission Card reference ${index} must be an object`);
    }
    return freeze({
      label: text(item.label) || null,
      ref: text(item.ref || item.url) || null,
    });
  });
}

export function createMissionCard(input = {}, { now = () => Date.now() } = {}) {
  const card = {
    kind: "MISSION_CARD_POINTER",
    version: 1,
    workId: required(input.workId, "Mission Card Work ID"),
    checkpointId: required(input.checkpointId, "Mission Card Checkpoint ID"),
    jobCode: text(input.jobCode) || null,
    references: references(input.references),
    issuedAt: iso(now),
  };
  // Deliberately do not copy status, owner, phase, result, or any other truth.
  return freeze(card);
}

export function assertMissionCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new Error("MISSION_CARD_INVALID");
  }
  required(card.workId, "Mission Card Work ID");
  required(card.checkpointId, "Mission Card Checkpoint ID");
  if (card.kind !== "MISSION_CARD_POINTER") throw new Error("MISSION_CARD_KIND_INVALID");
  return card;
}

export async function resolveMissionCard(card, { readWork } = {}) {
  assertMissionCard(card);
  if (typeof readWork !== "function") throw new Error("MISSION_CARD_OWNER_SOURCE_READER_REQUIRED");
  const work = await readWork({
    workId: card.workId,
    checkpointId: card.checkpointId,
    fresh: true,
  });
  return freeze({
    card: clone(card),
    work: clone(work),
    readMode: "FRESH_OWNER_SOURCE",
    resolvedAt: new Date().toISOString(),
  });
}

function normalizeObservation(source, value, observedAt) {
  const item = value && typeof value === "object" && !Array.isArray(value) ? value : { data: value };
  const status = text(item.status).toUpperCase() || (value == null ? "UNKNOWN" : "LIVE");
  return freeze({
    source,
    ownerSource: text(item.ownerSource || item.owner || source),
    status,
    data: clone(item.data === undefined ? value : item.data),
    sourceRef: text(item.sourceRef || item.evidenceRef || item.ref) || null,
    observedAt: text(item.observedAt) || observedAt,
  });
}

export function createCardCounter({ resolveWork, projections = [], now = () => Date.now() } = {}) {
  if (typeof resolveWork !== "function") throw new TypeError("Card Counter resolveWork is required");
  const readers = projections.map((projection, index) => {
    if (!projection || typeof projection !== "object") throw new TypeError(`Projection ${index} is invalid`);
    return Object.freeze({
      source: required(projection.source, `Projection ${index} source`),
      read: typeof projection.read === "function" ? projection.read : async () => null,
    });
  });

  return Object.freeze({
    async tap(card, { lens = "default" } = {}) {
      const pointer = assertMissionCard(card);
      const observedAt = iso(now);
      let resolved;
      try {
        resolved = await resolveMissionCard(pointer, { readWork: resolveWork });
      } catch (error) {
        return freeze({
          kind: "CARD_COUNTER_PROJECTION",
          mode: "READ_ONLY",
          mutates: false,
          lens: text(lens) || "default",
          card: clone(pointer),
          workId: pointer.workId,
          checkpointId: pointer.checkpointId,
          work: null,
          observations: [],
          error: error instanceof Error ? error.message : String(error),
          observedAt,
        });
      }

      const observations = await Promise.all(readers.map(async ({ source, read }) => {
        try {
          const value = await read({
            card: pointer,
            resolved,
            work: resolved.work,
            lens: text(lens) || "default",
            fresh: true,
          });
          return normalizeObservation(source, value, observedAt);
        } catch (error) {
          return normalizeObservation(source, {
            status: "UNKNOWN",
            ownerSource: source,
            data: null,
            sourceRef: null,
            error: error instanceof Error ? error.message : String(error),
          }, observedAt);
        }
      }));

      return freeze({
        kind: "CARD_COUNTER_PROJECTION",
        mode: "READ_ONLY",
        mutates: false,
        lens: text(lens) || "default",
        card: clone(pointer),
        workId: pointer.workId,
        checkpointId: pointer.checkpointId,
        work: clone(resolved.work),
        observations,
        observedAt,
      });
    },
  });
}

function observationMap(observations = []) {
  return new Map((Array.isArray(observations) ? observations : []).map(item => [item.source, item]));
}

export function compareOneToOne({ topic, left, right } = {}) {
  const label = text(topic);
  if (!label || !left || !right) {
    return freeze({ status: "NOT COMPARABLE", topic: label || null, reason: "MISSING_PAIR" });
  }
  const leftStatus = text(left.status).toUpperCase();
  const rightStatus = text(right.status).toUpperCase();
  if (leftStatus === "CONFLICT" || rightStatus === "CONFLICT") {
    return freeze({ status: "CONFLICT", topic: label, left, right, reason: "SOURCE_DECLARED_CONFLICT" });
  }
  if (leftStatus === "STALE" || leftStatus === "STALE?" || rightStatus === "STALE" || rightStatus === "STALE?") {
    return freeze({ status: "STALE?", topic: label, left, right, reason: "SOURCE_FRESHNESS_REQUIRES_CHECK" });
  }
  if (leftStatus === "UNKNOWN" || rightStatus === "UNKNOWN") {
    return freeze({ status: "UNKNOWN", topic: label, left, right, reason: "SOURCE_UNKNOWN" });
  }
  if (left.data === undefined || right.data === undefined) {
    return freeze({ status: "NOT COMPARABLE", topic: label, left, right, reason: "VALUE_UNAVAILABLE" });
  }
  const same = JSON.stringify(left.data) === JSON.stringify(right.data);
  return freeze({
    status: same ? "MATCH" : "DIFFERENT",
    topic: label,
    left,
    right,
    reason: same ? "OBSERVATIONS_MATCH" : "OBSERVATIONS_DIFFER",
  });
}

export function createDoubtEngine(comparisons = []) {
  return (Array.isArray(comparisons) ? comparisons : [])
    .filter(item => item && item.status && item.status !== "MATCH")
    .map(item => freeze({
      label: "WORTH CHECKING",
      topic: item.topic || null,
      status: STATUS_SET.has(item.status) ? item.status : "UNKNOWN",
      question: item.question || `ตรวจ ${item.topic || "observation"} จาก owner source อีกครั้ง`,
    }));
}

export function compareBriefs(previousBrief, currentBrief) {
  if (!previousBrief || !currentBrief) return [];
  const before = observationMap(previousBrief.observations);
  const after = observationMap(currentBrief.observations);
  const sources = new Set([...before.keys(), ...after.keys()]);
  return [...sources].map(source => {
    const previous = before.get(source) || null;
    const current = after.get(source) || null;
    const changed = JSON.stringify(previous) !== JSON.stringify(current);
    return freeze({
      label: "SINCE LAST BRIEF",
      source,
      changed,
      before: previous,
      after: current,
      status: changed ? "CHANGED" : "UNCHANGED",
    });
  }).filter(item => item.changed);
}

export function composeDressingBrief({ counterProjection, lightIntel = null, comparisons = [], previousBrief = null, now = () => Date.now() } = {}) {
  if (!counterProjection || counterProjection.kind !== "CARD_COUNTER_PROJECTION") {
    throw new Error("DRESSING_BRIEF_COUNTER_PROJECTION_REQUIRED");
  }
  const requiredSources = ["CENTRE", "HEIMDALL", "BOARD", "FACTORY", "GITHUB", "CLOUDFLARE", "CONTROL ROOM"];
  const sourceMap = observationMap(counterProjection.observations);
  const observations = requiredSources.map(source => sourceMap.get(source) || normalizeObservation(source, { status: "UNKNOWN", data: null }, iso(now)));
  if (lightIntel) observations.push(normalizeObservation("LIGHT", lightIntel, iso(now)));
  const brief = {
    kind: "DRESSING_ROOM_REALITY_BRIEF",
    mode: "READ_ONLY_BRIEFING",
    mutates: false,
    workId: counterProjection.workId,
    checkpointId: counterProjection.checkpointId,
    lens: counterProjection.lens,
    observations,
    sourceReferences: observations.map(item => ({ source: item.source, ownerSource: item.ownerSource, ref: item.sourceRef })),
    comparisons: clone(comparisons),
    doubts: createDoubtEngine(comparisons),
    light: lightIntel ? { status: text(lightIntel.status).toUpperCase() || "LIVE", optional: true } : { status: "UNAVAILABLE", optional: true },
    observedAt: iso(now),
  };
  brief.sinceLastBrief = compareBriefs(previousBrief, brief);
  return freeze(brief);
}

export async function rebrief(card, { counter, lightIntel, comparisons = [], previousBrief = null, lens = "default" } = {}) {
  if (!counter || typeof counter.tap !== "function") throw new Error("REBRIEF_COUNTER_REQUIRED");
  const projection = await counter.tap(card, { lens });
  const intel = typeof lightIntel === "function" ? await lightIntel({ card, projection, fresh: true }) : lightIntel;
  return composeDressingBrief({ counterProjection: projection, lightIntel: intel, comparisons, previousBrief });
}

function cardUnique(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(text).filter(Boolean))];
}

function bangkokDateStamp(value = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date(value));
  const pick = type => parts.find(part => part.type === type)?.value || "";
  return pick("year") + pick("month") + pick("day");
}
function randomToken(randomId = () => crypto.randomUUID()) {
  return String(randomId()).replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6).padEnd(6, "0");
}
export function createSnapshotKey({ at = Date.now(), randomId } = {}) {
  return "SNAP-" + bangkokDateStamp(at) + "-" + randomToken(randomId);
}
function cardSearchCode(workId) {
  let hash = 2166136261;
  for (const char of String(workId || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return "W" + hash.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

export function prepareStandardMissionTicket({ work, checkpointId, destinations, context = [], data = {}, intent = null, lastReturn = null, reason = "MISSION_ENTRY", accessScope, toolAccess = [], snapshotKey = null } = {}, { now = () => Date.now(), randomId } = {}) {
  if (!work || typeof work !== "object") throw new Error("MISSION_TICKET_WORK_REQUIRED");
  const workId = required(work.workId, "Mission Ticket Work ID");
  const cp = required(checkpointId || work.checkpointId, "Mission Ticket Checkpoint ID");
  const routes = cardUnique(destinations?.length ? destinations : work.requestedDestinations);
  const scope = text(accessScope || work.accessScope || (String(work.workType || "").toUpperCase() === "MAINTENANCE" ? "MAINTENANCE" : "WORK")).toUpperCase();
  if (!["WORK","MAINTENANCE"].includes(scope)) throw new Error("MISSION_TICKET_ACCESS_SCOPE_INVALID");
  const tools = cardUnique(toolAccess?.length ? toolAccess : work.toolAccess);
  const tabletData = data && typeof data === "object" && !Array.isArray(data) ? clone(data) : {};
  const snapshot = scope === "WORK" ? (text(snapshotKey || work.snapshotKey) || createSnapshotKey({ at:now(), randomId })) : null;
  const missionIntent = intent && typeof intent === "object" && !Array.isArray(intent)
    ? {
        mission:text(intent.mission || work.command || work.name) || null,
        requestedResult:text(intent.requestedResult || work.expectedResult) || null,
      }
    : {
        mission:text(work.command || work.name) || null,
        requestedResult:text(work.expectedResult) || null,
      };
  return freeze({
    kind:"HERMES_STANDARD_TICKET",
    version:1,
    state:"DRAFT",
    cardId:text(work.cardId) || (text(work.jobCode) ? "CARD:" + text(work.jobCode) : null),
    tabletId:text(work.tabletId) || (text(work.jobCode) ? "TABLET:" + text(work.jobCode) : null),
    workId,
    checkpointId:cp,
    jobCode:text(work.jobCode) || null,
    destinations:routes,
    access_scope:scope,
    tool_access:tools,
    snapshot_key:snapshot,
    intent:clone(missionIntent),
    data:tabletData,
    context:clone(Array.isArray(context) ? context : []),
    last_return:lastReturn && typeof lastReturn === "object" && !Array.isArray(lastReturn) ? clone(lastReturn) : null,
    reason:text(reason) || "MISSION_ENTRY",
    preparedAt:iso(now),
    issuedAt:null,
    acceptedBy:null,
  });
}

export function issueStandardMissionTicket(draft, { now = () => Date.now(), acceptedBy = "HERMES" } = {}) {
  if (!draft || draft.kind !== "HERMES_STANDARD_TICKET" || draft.state !== "DRAFT") {
    throw new Error("MISSION_TICKET_DRAFT_REQUIRED");
  }
  return freeze({
    ...clone(draft),
    state:"CURRENT",
    issuedAt:iso(now),
    acceptedBy:text(acceptedBy) || "HERMES",
  });
}

export function replaceStandardMissionTicket(current, draft, { confirmation, now = () => Date.now() } = {}) {
  if (!current || current.kind !== "HERMES_STANDARD_TICKET" || current.state !== "CURRENT") throw new Error("MISSION_TICKET_CURRENT_REQUIRED");
  if (!draft || draft.kind !== "HERMES_STANDARD_TICKET" || draft.state !== "DRAFT") throw new Error("MISSION_TICKET_DRAFT_REQUIRED");
  if (current.workId !== draft.workId || current.checkpointId !== draft.checkpointId) throw new Error("MISSION_TICKET_IDENTITY_MISMATCH");
  if (text(confirmation).toUpperCase() !== "GO_CONFIRMED") throw new Error("HERMES_GO_FINAL_CONFIRMATION_REQUIRED");
  const at=iso(now);
  return freeze({
    current:{...clone(draft),state:"CURRENT",issuedAt:at,acceptedBy:"GO"},
    audit:{event:"CARD_REPLACED",reason:text(draft.reason)||"ROUTE_CHANGE",timestamp:at},
  });
}

export function missionTicketSearchCode(workId) {
  return cardSearchCode(required(workId, "Mission Ticket Work ID"));
}

export const __private = Object.freeze({ NON_LIVE });

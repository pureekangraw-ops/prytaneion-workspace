import { createMissionCard, missionTicketSearchCode } from "./go-hub-mission-card.mjs";
import { workCardView } from "./go-hub-work-card.js";

const text = value => String(value ?? "").trim();
const clone = value => value == null ? value : structuredClone(value);
const unique = values => [...new Set((values || []).map(text).filter(Boolean))];
const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers:{ "content-type":"application/json; charset=utf-8" },
});

async function payload(response) {
  if (response instanceof Response) return response.clone().json().catch(() => ({}));
  return clone(response || {});
}

function okResponse(value) {
  return value instanceof Response ? value.ok : value?.ok !== false;
}

function thaiText(value) {
  return text(value).toLocaleLowerCase("th-TH");
}

function compact(value) {
  return thaiText(value).replace(/[\s\p{P}\p{S}]+/gu, "");
}

function grams(value, size = 2) {
  const source = compact(value);
  if (!source) return [];
  if (source.length <= size) return [source];
  const out = [];
  for (let i = 0; i <= source.length - size; i += 1) out.push(source.slice(i, i + size));
  return [...new Set(out)];
}

function tokens(value) {
  return [...new Set(thaiText(value).split(/[^\p{L}\p{N}]+/u).map(x => x.trim()).filter(Boolean))];
}

function jaccard(a = [], b = []) {
  const left = new Set(a), right = new Set(b);
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let same = 0;
  for (const item of left) if (right.has(item)) same += 1;
  return same / (left.size + right.size - same);
}

function candidateText(pin = {}) {
  const card = pin.card || {};
  return [
    pin.title,
    pin.detail,
    pin.workId,
    pin.jobCode,
    card.title,
    card.detail,
  ].filter(Boolean).join(" ");
}

function statusBoost(pin = {}) {
  const status = text(pin.card?.sourceStatus || pin.status).toUpperCase();
  if (["ON PROCESS","DOING"].includes(status)) return 0.10;
  if (["OPEN","READY","ARRIVED"].includes(status)) return 0.06;
  if (["WAIT","WAIT CONFIRM","VERIFY"].includes(status)) return 0.05;
  if (["COMPLETE","RETURNED","ARCHIVED"].includes(status)) return -0.03;
  if (["CANCEL","CANCELLED"].includes(status)) return -0.10;
  return 0;
}

export function missionSimilarity(mission, pin) {
  const source = candidateText(pin);
  const score =
    jaccard(tokens(mission), tokens(source)) * 0.30 +
    jaccard(grams(mission, 2), grams(source, 2)) * 0.40 +
    jaccard(grams(mission, 3), grams(source, 3)) * 0.30 +
    statusBoost(pin);
  return Math.max(0, Math.min(1, score));
}

export function rankMissionCandidates(mission, pins = [], { limit = 6, threshold = 0.20 } = {}) {
  return (Array.isArray(pins) ? pins : [])
    .map(pin => ({ pin, score:missionSimilarity(mission, pin) }))
    .filter(item => item.score >= threshold)
    .sort((a,b) => b.score - a.score || String(b.pin.updatedAt || "").localeCompare(String(a.pin.updatedAt || "")))
    .slice(0, Math.max(1, Math.min(Number(limit) || 6, 20)))
    .map(({ pin, score }) => Object.freeze({
      workId:text(pin.workId),
      checkpointId:text(pin.card?.checkpointId) || (text(pin.workId) ? "CP-" + text(pin.workId) : null),
      cardId:text(pin.card?.cardId) || null,
      jobCode:text(pin.card?.jobCode || pin.jobCode) || null,
      title:text(pin.card?.title || pin.title) || null,
      detail:text(pin.card?.detail || pin.detail) || null,
      status:text(pin.card?.sourceStatus || pin.status) || null,
      snapshotKey:text(pin.card?.snapshot_key || pin.snapshotKey) || null,
      toolAccess:unique(pin.card?.tool_access || pin.toolAccess),
      score:Number(score.toFixed(4)),
      source:"HEIMDALL_PROJECT_INDEX",
    }));
}

function bangkokDateStamp(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit",
  }).formatToParts(date);
  const pick = type => parts.find(part => part.type === type)?.value || "";
  return `${pick("year")}${pick("month")}${pick("day")}`;
}

function canonicalWorkKey(value) {
  const normalized = text(value)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .toUpperCase();
  return normalized.slice(0, 56) || "MISSION";
}

function nextCanonicalWorkId({ mission, workKey, pins = [], at }) {
  const date = bangkokDateStamp(at);
  const key = canonicalWorkKey(workKey || mission);
  const prefix = `WORK-${key}-${date}-`;
  let max = 0;
  for (const pin of Array.isArray(pins) ? pins : []) {
    const id = text(pin?.workId);
    if (!id.startsWith(prefix)) continue;
    const suffix = id.slice(prefix.length);
    if (/^\d{3}$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

function requireWorkContext(input = {}) {
  const workId = text(input?.workContext?.workId || input.workId);
  const checkpointId = text(input?.workContext?.checkpointId || input.checkpointId);
  if (!workId || !checkpointId) throw Object.assign(new Error("HERMES_WORK_CONTEXT_REQUIRED"), { status:400 });
  return { workId, checkpointId };
}

function contextCandidate(value, index = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("HERMES_CONTEXT_CANDIDATE_INVALID"), { status:400 });
  }
  const contextId = text(value.contextId || value.id || `CTX-${index + 1}`);
  if (!contextId) throw Object.assign(new Error("HERMES_CONTEXT_ID_REQUIRED"), { status:400 });
  return {
    contextId,
    label:text(value.label || value.title) || null,
    summary:text(value.summary || value.detail) || null,
    ref:text(value.ref || value.url) || null,
    refs:unique(value.refs),
    source:text(value.source) || null,
    observedAt:text(value.observedAt) || null,
  };
}

function evidenceRefs(evidence = []) {
  return (Array.isArray(evidence) ? evidence : [])
    .map(item => typeof item === "string" ? { ref:item } : clone(item))
    .filter(item => item && text(item.ref || item.evidenceRef || item.reference));
}

function workDestinationAllowed(work, destination) {
  const allowed = [
    ...(Array.isArray(work?.pass?.allowedDestinations) ? work.pass.allowedDestinations : []),
    ...(Array.isArray(work?.pass?.scope) ? work.pass.scope : []),
  ].map(text);
  return allowed.includes(destination) ||
    allowed.includes(destination.replace(/^destination:\/\//, "")) ||
    allowed.includes("ALL_GO_HUB_OWNED_AREAS");
}

function lightCandidates(lightResult = {}) {
  const candidates = [];
  let n = 0;
  for (const ref of unique(lightResult.sources)) {
    candidates.push({ contextId:`LIGHT-SOURCE-${++n}`, ref, source:"LIGHT", summary:null });
  }
  for (const item of Array.isArray(lightResult.evidence) ? lightResult.evidence : []) {
    const ref = text(item?.ref || item?.reference || item?.evidenceRef);
    if (!ref) continue;
    candidates.push({
      contextId:`LIGHT-EVIDENCE-${++n}`,
      ref,
      source:"LIGHT",
      summary:text(item?.summary || item?.kind) || null,
    });
  }
  return candidates;
}

export function createAgentMissionService({
  centreLive,
  counterDispatch,
  boardRead,
  now = () => new Date().toISOString(),
  createId = prefix => `${prefix}-${crypto.randomUUID()}`,
} = {}) {
  if (!centreLive || typeof centreLive.action !== "function") throw new Error("HERMES_CENTRE_REQUIRED");
  if (!counterDispatch || typeof counterDispatch.create !== "function") throw new Error("HERMES_COUNTER_REQUIRED");
  if (typeof boardRead !== "function") throw new Error("HERMES_HEIMDALL_INDEX_REQUIRED");

  async function centre(input) {
    const response = await centreLive.action(input);
    const body = await payload(response);
    if (!okResponse(response)) {
      const error = Object.assign(new Error(body?.code || "HERMES_CENTRE_ACTION_FAILED"), { status:response?.status || 500, body });
      throw error;
    }
    return body;
  }

  async function readMission(workContext) {
    return centre({ action:"v4_mission_get", ...workContext });
  }

  async function inspectWork(workContext) {
    const view = await centre({ action:"v4_inspect", workId:workContext.workId, checkpointId:workContext.checkpointId });
    if (!view?.work || text(view.work.checkpointId) !== workContext.checkpointId) {
      throw Object.assign(new Error("HERMES_WORK_IDENTITY_MISMATCH"), { status:409 });
    }
    return view.work;
  }

  async function find(input = {}) {
    const mission = text(input.mission);
    if (!mission) return json({ code:"HERMES_MISSION_REQUIRED" }, 400);
    const raw = await boardRead();
    const board = await payload(raw);
    if (!okResponse(raw) || !Array.isArray(board?.pins)) {
      return json({ code:"HERMES_HEIMDALL_INDEX_UNAVAILABLE" }, 503);
    }
    const exactSnapshot = /^SNAP-\d{8}-[A-Z0-9]{6}$/i.test(mission)
      ? board.pins.filter(pin => text(pin.card?.snapshot_key || pin.snapshotKey).toUpperCase() === mission.toUpperCase())
      : [];
    const candidates = exactSnapshot.length
      ? exactSnapshot.map(pin => ({ workId:text(pin.workId), checkpointId:text(pin.card?.checkpointId) || "CP-" + text(pin.workId), cardId:text(pin.card?.cardId)||null, jobCode:text(pin.card?.jobCode||pin.jobCode)||null, title:text(pin.card?.title||pin.title)||null, detail:text(pin.card?.detail||pin.detail)||null, status:text(pin.card?.sourceStatus||pin.status)||null, snapshotKey:mission.toUpperCase(), toolAccess:unique(pin.card?.tool_access||pin.toolAccess), score:1, source:"SNAPSHOT_KEY" }))
      : rankMissionCandidates(mission, board.pins, { limit:input.limit, threshold:input.threshold });
    return json({
      ok:true,
      action:"find",
      mission,
      candidates,
      recommendedTools:unique(candidates.flatMap(item => item.toolAccess || [])),
      source:exactSnapshot.length ? "SNAPSHOT_KEY" : "HEIMDALL_PROJECT_INDEX",
      boardExposed:false,
    });
  }

  async function enter(input = {}) {
    const workContext = requireWorkContext(input);
    const work = await inspectWork(workContext);
    const response = await centre({
      action:"v4_mission_enter",
      ...workContext,
      sessionId:text(input.sessionId) || createId("HERMES-SESSION"),
      agentId:text(input.agentId) || "GO",
      mission:text(input.mission) || work.command || work.name,
      requestedResult:text(input.requestedResult) || work.expectedResult || null,
    });
    return json({
      ok:true,
      action:"enter",
      card:workCardView(work),
      workContext,
      mission:response.mission,
      noGate:true,
    });
  }

  async function create(input = {}) {
    const mission = text(input.mission);
    const requestedResult = text(input.requestedResult);
    if (!mission) return json({ code:"HERMES_MISSION_REQUIRED" }, 400);
    if (!requestedResult) return json({ code:"HERMES_REQUESTED_RESULT_REQUIRED" }, 400);
    const raw = await boardRead();
    const board = await payload(raw);
    if (!okResponse(raw) || !Array.isArray(board?.pins)) {
      return json({ code:"HERMES_HEIMDALL_INDEX_UNAVAILABLE" }, 503);
    }
    const similar = rankMissionCandidates(mission, board.pins, { limit:input.limit, threshold:input.threshold });
    if (text(input.createDecision).toUpperCase() !== "CREATE_NEW") {
      return json({
        code:"HERMES_SIMILAR_WORK_REVIEW_REQUIRED",
        action:"create",
        mission,
        candidates:similar,
        decisionRequired:"CREATE_NEW_OR_REUSE",
        hint:"Review candidates first. Enter an existing Work to reuse it, or call create again with createDecision=CREATE_NEW.",
        boardExposed:false,
      }, 409);
    }
    if (text(input.workId)) {
      return json({ code:"HERMES_WORK_ID_CALLER_OVERRIDE_FORBIDDEN" }, 400);
    }
    const workId = nextCanonicalWorkId({
      mission,
      workKey:input.workKey,
      pins:board.pins,
      at:now(),
    });
    const created = await centre({
      action:"v4_create",
      workId,
      work:{
        workId,
        name:mission,
        command:mission,
        expectedResult:requestedResult,
        requestedDestinations:unique(input.destinations),
        scope:unique(input.scope),
        workType:text(input.workType || "NORMAL").toUpperCase(),
      },
    });
    const work = created.work;
    const workContext = { workId:work.workId, checkpointId:work.checkpointId };
    const entered = await centre({
      action:"v4_mission_enter",
      ...workContext,
      sessionId:text(input.sessionId) || createId("HERMES-SESSION"),
      agentId:text(input.agentId) || "GO",
      mission,
      requestedResult,
    });
    return json({
      ok:true,
      action:"create",
      created:true,
      card:workCardView(work),
      workContext,
      mission:entered.mission,
    }, 201);
  }

  async function prepareCard(input = {}) {
    const workContext = requireWorkContext(input);
    const current = await readMission(workContext);
    const work = current.work || await inspectWork(workContext);
    const destinations = unique(input.destinations?.length ? input.destinations : work.requestedDestinations);
    const accessScope = text(input.accessScope).toUpperCase();
    const toolAccess = unique(input.toolAccess);
    if (!["WORK","MAINTENANCE"].includes(accessScope)) return json({ code:"HERMES_ACCESS_SCOPE_REQUIRED", prompt:"เลือกขนาดสิทธิ์ก่อนครับ: WORK หรือ MAINTENANCE" }, 409);
    if (accessScope === "WORK" && !toolAccess.length) return json({ code:"HERMES_TOOL_ACCESS_REQUIRED", prompt:"เลือกเครื่องมือที่จะเปิดสิทธิ์ให้การ์ดครับ" }, 409);
    const response = await centre({
      action:"v4_mission_card_prepare",
      ...workContext,
      destinations,
      accessScope,
      toolAccess,
      reason:text(input.reason) || "MISSION_ENTRY",
      context:clone(current.mission?.memory?.selectedContext || []),
    });
    return json({
      ok:true,
      action:"prepare_card",
      workContext,
      cardDraft:response.mission?.memory?.cardMachine?.draft || null,
      issued:false,
      prompt:"นี่ครับบัตรของคุณ ตรวจสอบ access_scope และ tool_access แล้วรบกวนยืนยันครับ",
    });
  }

  async function confirmCard(input = {}) {
    const workContext = requireWorkContext(input);
    if (text(input.confirmation).toUpperCase() !== "GO_CONFIRMED") {
      return json({ code:"HERMES_GO_FINAL_CONFIRMATION_REQUIRED", issued:false }, 409);
    }
    const response = await centre({ action:"v4_mission_card_issue", ...workContext, confirmation:"GO_CONFIRMED" });
    return json({
      ok:true,
      action:"confirm_card",
      workContext,
      card:response.mission?.memory?.cardMachine?.current || null,
      issued:true,
      prompt:"รับทราบครับ บัตรของคุณพร้อมใช้งานแล้วครับ",
    });
  }

  async function prepareRouteChange(input = {}) {
    const workContext = requireWorkContext(input);
    const current = await readMission(workContext);
    const machine = current.mission?.memory?.cardMachine || {};
    if (!machine.current) return json({ code:"HERMES_CURRENT_CARD_REQUIRED" }, 409);
    const requested = unique(input.destinations);
    const destinations = unique([...(machine.current.destinations || []), ...requested]);
    const accessScope = text(input.accessScope || machine.current.access_scope).toUpperCase();
    const toolAccess = input.toolAccess?.length ? unique(input.toolAccess) : unique(machine.current.tool_access);
    if (!["WORK","MAINTENANCE"].includes(accessScope)) return json({ code:"HERMES_ACCESS_SCOPE_REQUIRED" }, 409);
    if (accessScope === "WORK" && !toolAccess.length) return json({ code:"HERMES_TOOL_ACCESS_REQUIRED" }, 409);
    const response = await centre({
      action:"v4_mission_card_prepare",
      ...workContext,
      destinations,
      accessScope,
      toolAccess,
      reason:text(input.reason) || "PERMISSION_CHANGE",
      context:clone(current.mission?.memory?.selectedContext || []),
    });
    return json({
      ok:true,
      action:"prepare_route_change",
      workContext,
      currentCard:machine.current,
      replacementDraft:response.mission?.memory?.cardMachine?.draft || null,
      issued:false,
      routeChanged:false,
      prompt:"ตรวจสอบสิทธิ์ใหม่บนการ์ดแล้วครับ ก่อนออกบัตรใหม่ต้องได้รับการอนุมัติจาก BIG",
    });
  }

  async function confirmRouteChange(input = {}) {
    const workContext = requireWorkContext(input);
    if (text(input.confirmation).toUpperCase() !== "GO_CONFIRMED") {
      return json({ code:"HERMES_GO_FINAL_CONFIRMATION_REQUIRED", replaced:false }, 409);
    }
    const response = await centre({ action:"v4_mission_card_replace", ...workContext, confirmation:"GO_CONFIRMED" });
    return json({
      ok:true,
      action:"confirm_route_change",
      workContext,
      card:response.card || response.mission?.memory?.cardMachine?.current || null,
      replaced:true,
      routeOpened:false,
      audit:response.audit || null,
      prompt:"เรียบร้อยครับ Mission ออกการ์ดใบใหม่แทนใบเดิมแล้ว เครื่องมือจะอ่านสิทธิ์จากการ์ดใหม่นี้โดยตรง",
    });
  }

  async function selectContext(input = {}) {
    const workContext = requireWorkContext(input);
    const candidates = (Array.isArray(input.candidates) ? input.candidates : []).map(contextCandidate);
    const selectedIds = unique(input.selectedIds);
    const response = await centre({
      action:"v4_mission_context",
      ...workContext,
      candidates,
      selectedIds,
    });
    return json({ ok:true, action:"select_context", workContext, mission:response.mission });
  }

  async function note(input = {}) {
    const workContext = requireWorkContext(input);
    const noteText = text(input.note);
    if (!noteText) return json({ code:"HERMES_NOTE_REQUIRED" }, 400);
    const response = await centre({
      action:"v4_mission_note",
      ...workContext,
      note:noteText,
      source:text(input.source) || "GO",
    });
    return json({ ok:true, action:"note", workContext, mission:response.mission });
  }

  async function askLight(input = {}) {
    const workContext = requireWorkContext(input);
    const question = text(input.question);
    if (!question) return json({ code:"HERMES_LIGHT_QUESTION_REQUIRED" }, 400);
    const current = await readMission(workContext);
    const mission = current.mission;
    if (!mission?.session || mission.session.status === "EXITED") {
      return json({ code:"HERMES_ACTIVE_SESSION_REQUIRED" }, 409);
    }
    const counterId = text(input.counterId) || createId("HERMES-LIGHT");
    const response = await counterDispatch.create({
      counterId,
      mode:"SEARCH",
      request:question,
      requestedResult:text(input.requestedResult) || "Return relevant mission context with source references.",
      authority:"READ_CONTEXT_ONLY",
      target:"LIGHT",
      fromActor:"GO",
      toActor:"LIGHT",
      context:{
        hermes:true,
        mission:mission.memory?.mission || null,
        cardId:workCardView(current.work).cardId,
        selectedContext:clone(mission.memory?.selectedContext || []),
        contextRefs:clone(mission.memory?.contextRefs || []),
      },
      sourceHints:clone(mission.memory?.contextRefs || []),
      doNotChange:["Mission Card identity","selected context","Work truth"],
      workContext,
    });
    const body = await payload(response);
    const lightResult = body.lightResult || body.counter?.answer || null;
    const candidates = lightResult ? lightCandidates(lightResult) : [];
    const stored = await centre({
      action:"v4_mission_light",
      ...workContext,
      lightReply:{
        counterId,
        status:lightResult?.status || (body.lightAuthRequired ? "WAITING_AUTH" : "UNKNOWN"),
        answer:lightResult?.answer || null,
        sources:unique(lightResult?.sources),
        evidence:clone(lightResult?.evidence || []),
        candidates,
        authRequired:body.lightAuthRequired === true,
        receivedAt:now(),
      },
    });
    return json({
      ok:response?.ok !== false,
      action:"ask_light",
      workContext,
      counterId,
      lightResult,
      candidates,
      selectedAutomatically:false,
      lightAuthRequired:body.lightAuthRequired === true,
      lightAuthorizationUrl:body.lightAuthorizationUrl || null,
      mission:stored.mission,
    }, response?.status || 200);
  }

  async function ensureRuntimeAccess(workContext, destination, alreadyProvisioned) {
    let work = await inspectWork(workContext);
    const normalizedDestination = text(destination);
    if (!normalizedDestination) throw Object.assign(new Error("HERMES_DESTINATION_REQUIRED"), { status:400 });

    const requested = unique(work.requestedDestinations);
    if (!requested.includes(normalizedDestination) && work.status === "OPEN") {
      const updated = await centre({
        action:"v4_update_destinations",
        ...workContext,
        destinations:[...requested, normalizedDestination],
      });
      work = updated.work;
    }

    if (work.status === "WAIT CONFIRM") {
      const resumed = await centre({ action:"v4_resume", ...workContext, actor:"GO" });
      work = resumed.work;
    } else if (work.status === "OPEN") {
      const claimed = await centre({ action:"v4_claim", ...workContext, actor:"GO" });
      work = claimed.work;
    }

    if (work.status !== "ON PROCESS" || text(work.holder) !== "GO") {
      throw Object.assign(new Error("HERMES_GO_HOLDER_REQUIRED"), { status:409 });
    }

    if (work.pass?.state === "ACTIVE" && workDestinationAllowed(work, normalizedDestination)) {
      return { work, passOpened:false, alreadyProvisioned };
    }

    const opened = await centre({
      action:"v4_open_pass",
      ...workContext,
      actor:"GO",
      kind:"WORK",
      destinations:[normalizedDestination],
      scope:[normalizedDestination],
      closeCondition:"RETURN",
      returnAddress:workContext.checkpointId,
      reason:alreadyProvisioned
        ? "HERMES automatic session access for already-open mission space."
        : "HERMES first-open standardization for mission space.",
    });
    return { work:opened.work, passOpened:true, alreadyProvisioned };
  }

  function factoryField(value, source, confidence = "VERIFIED") {
    const normalized = typeof value === "string" ? text(value) : clone(value);
    const present = Array.isArray(normalized) ? normalized.length > 0 : normalized != null && normalized !== "";
    return { value:present ? normalized : null, source:text(source) || null, confidence:present ? confidence : "UNKNOWN" };
  }

  async function prepareFactoryCard(input = {}) {
    const workContext = requireWorkContext(input);
    const current = await readMission(workContext);
    const work = current.work || await inspectWork(workContext);
    const memory = current.mission?.memory || {};
    const supplied = input.factory || {};
    const fields = {
      goal:factoryField(supplied.goal || memory.mission || work.command || work.name, supplied.goal ? "GO" : "MISSION"),
      repository:factoryField(supplied.repository, supplied.repository ? "GO" : null),
      branch:factoryField(supplied.branch, supplied.branch ? "GO" : null),
      expectedOutput:factoryField(supplied.expectedOutput || memory.requestedResult || work.expectedResult, supplied.expectedOutput ? "GO" : "MISSION"),
      outputType:factoryField(supplied.outputType, supplied.outputType ? "GO" : null),
      inputReferences:factoryField(supplied.inputReferences || memory.contextRefs, supplied.inputReferences ? "GO" : "MISSION"),
      preProductionInspection:factoryField(supplied.preProductionInspection, supplied.preProductionInspection ? "GO" : null),
      criticalChecklist:factoryField(supplied.criticalChecklist, supplied.criticalChecklist ? "GO" : null),
    };
    const uncertainFields = Object.entries(fields)
      .filter(([, field]) => field.confidence !== "VERIFIED")
      .map(([name]) => name);
    const draft = Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.value]));
    const suppliedChoices = input.choices && typeof input.choices === "object" ? input.choices : {};
    const knowledgeCandidates = [
      ...(Array.isArray(memory.selectedContext) ? memory.selectedContext : []),
      ...(Array.isArray(memory.lightReplies) ? memory.lightReplies.flatMap(reply => Array.isArray(reply?.candidates) ? reply.candidates : []) : []),
    ];
    const assistance = uncertainFields.map(field => {
      const explicit = Array.isArray(suppliedChoices[field]) ? suppliedChoices[field] : [];
      const inferred = knowledgeCandidates
        .filter(item => text(item?.field || item?.kind).toLowerCase() === field.toLowerCase())
        .map(item => ({ value:item.value ?? item.ref ?? null, label:text(item.label || item.summary || item.ref), source:text(item.source || "MISSION_CONTEXT") }))
        .filter(item => item.value != null);
      const choices = [...explicit.map(value => typeof value === "object" ? clone(value) : ({ value, label:text(value), source:"PROVIDED_CHOICE" })), ...inferred];
      return {
        field,
        choices,
        mode:choices.length ? "GO_SELECT" : "ASK_LIGHT_OR_GO",
        instruction:choices.length
          ? "เสนอเฉพาะตัวเลือกที่มีหลักฐานให้ GO เลือก ห้าม HERMES เลือกแทน"
          : "ค้น Mission Context/LIGHT ก่อน ถ้ายังไม่มีหลักฐานจึงถาม GO แบบปลายเปิด ห้ามเดา",
      };
    });
    return json({
      ok:uncertainFields.length === 0,
      action:"prepare_factory_card",
      workContext,
      card:workCardView(work),
      factoryFormDraft:draft,
      fieldEvidence:fields,
      uncertainFields,
      assistance,
      status:uncertainFields.length ? "WAIT_GO_INPUT" : "WAIT_GO_CONFIRMATION",
      prompt:uncertainFields.length
        ? "ผมพบข้อมูลที่ยังยืนยันไม่ได้ จะค้นข้อมูลที่มีอยู่และเสนอทางเลือกให้ GO ก่อน หากยังไม่มีหลักฐานจึงขอให้ GO ระบุเองครับ"
        : "นี่ครับบัตรของคุณ รบกวนตรวจสอบข้อมูลอีกครั้ง รบกวนยืนยันครับ",
      issued:false,
      currentCardChanged:false,
    }, uncertainFields.length ? 409 : 200);
  }

  async function confirmFactoryCard(input = {}) {
    const workContext = requireWorkContext(input);
    if (text(input.confirmation).toUpperCase() !== "GO_CONFIRMED") {
      return json({ code:"HERMES_GO_FINAL_CONFIRMATION_REQUIRED", issued:false }, 409);
    }
    const prepared = await prepareFactoryCard({ ...input, action:"prepare_factory_card" });
    const preparedBody = await payload(prepared);
    if (!okResponse(prepared)) return prepared;
    return json({
      ok:true,
      action:"confirm_factory_card",
      workContext,
      card:preparedBody.card,
      factoryForm:preparedBody.factoryFormDraft,
      fieldEvidence:preparedBody.fieldEvidence,
      status:"ISSUED",
      issued:true,
      acceptedBy:"GO",
      prompt:"ยืนยันแล้ว — GO รับบัตรและสามารถนำ Factory Form นี้เข้าสู่ Inspection/Factory ได้",
    });
  }

  async function firstOpen(input = {}) {
    const workContext = requireWorkContext(input);
    const destination = text(input.destination);
    if (!destination) return json({ code:"HERMES_DESTINATION_REQUIRED" }, 400);
    const current = await readMission(workContext);
    const openedSpaces = current.mission?.memory?.openedSpaces || {};
    const alreadyProvisioned = Boolean(openedSpaces[destination]);
    const access = await ensureRuntimeAccess(workContext, destination, alreadyProvisioned);
    const recorded = await centre({
      action:"v4_mission_first_open",
      ...workContext,
      destination,
      workspace:text(input.workspace) || null,
      firstOpen:!alreadyProvisioned,
      access:{
        passKind:access.work?.pass?.kind || null,
        passState:access.work?.pass?.state || null,
        openedBy:access.work?.pass?.openedBy || "heimdall",
      },
    });
    return json({
      ok:true,
      action:"first_open",
      workContext,
      status:alreadyProvisioned ? "ALREADY_OPEN" : "OPENED",
      runtimePassOpened:access.passOpened,
      card:workCardView(access.work),
      mission:recorded.mission,
    });
  }

  async function touch(input = {}) {
    const workContext = requireWorkContext(input);
    const current = await readMission(workContext);
    const work = current.work || await inspectWork(workContext);
    const memory = current.mission?.memory || null;
    const refs = (memory?.selectedContext || [])
      .flatMap(item => [item?.ref, ...(Array.isArray(item?.refs) ? item.refs : [])])
      .filter(Boolean)
      .map(ref => ({ label:"mission-context", ref }));
    return json({
      ok:true,
      action:"touch",
      station:text(input.station) || "UNKNOWN",
      card:workCardView(work),
      pointer:createMissionCard({
        workId:work.workId,
        checkpointId:work.checkpointId,
        jobCode:work.jobCode,
        references:refs,
      }),
      memory:clone(memory),
      authorityCreated:false,
      boardExposed:false,
    });
  }

  async function returnCard(input = {}) {
    const workContext = requireWorkContext(input);
    const missionStatus = text(input.status || "ON PROCESS").toUpperCase();
    const allowed = new Set(["ON PROCESS","WAIT","WAIT VERIFY","COMPLETE","CANCEL"]);
    if (!allowed.has(missionStatus)) return json({ code:"HERMES_RETURN_STATUS_INVALID" }, 400);
    const centreStatus = missionStatus === "COMPLETE" ? "COMPLETE" : missionStatus === "CANCEL" ? "CANCEL" : "OPEN";
    const evidence = evidenceRefs(input.evidence);
    if (centreStatus === "COMPLETE" && !evidence.length) {
      return json({ code:"HERMES_COMPLETE_EVIDENCE_REQUIRED" }, 409);
    }

    const returned = await centre({
      action:"v4_return",
      ...workContext,
      actor:"GO",
      status:centreStatus,
      result:clone(input.result),
      evidence,
    });
    const work = returned.work;
    const recorded = await centre({
      action:"v4_mission_return",
      ...workContext,
      missionStatus,
      result:clone(input.result),
      nextAction:text(input.nextAction) || null,
      evidence,
      unknowns:unique(input.unknowns),
      lastLocation:text(input.lastLocation) || null,
      mode:text(input.mode || "NORMAL_RETURN").toUpperCase(),
      ownerReadback:{
        sourceStatus:work.status,
        holder:work.holder || null,
        passState:work.pass?.state || null,
        lastUpdated:work.lastUpdated || null,
      },
    });
    return json({
      ok:true,
      action:"return",
      workContext,
      card:workCardView(work),
      mission:recorded.mission,
      readbackVerified:true,
      exitAllowed:true,
      retrievalCode:recorded.mission?.memory?.cardMachine?.current?.snapshot_key || missionTicketSearchCode(work.workId),
      prompt:"กรุณาอัปเดตการ์ดก่อนออกครับ",
    });
  }

  async function updateCard(input = {}) {
    const workContext = requireWorkContext(input);
    const response = await centre({ action:"v4_mission_card_update", ...workContext });
    return json({ ok:true, action:"update_card", workContext, card:workCardView(response.work), mission:response.mission, updated:true, prompt:"อัปเดตการ์ดแล้วครับ พร้อมออกจาก Mission" });
  }

  async function exit(input = {}) {
    const workContext = requireWorkContext(input);
    const response = await centre({ action:"v4_mission_exit", ...workContext });
    return json({
      ok:true,
      action:"exit",
      workContext,
      mission:response.mission,
      exited:true,
    });
  }

  async function inspect(input = {}) {
    const workContext = requireWorkContext(input);
    const response = await readMission(workContext);
    return json({ ok:true, action:"inspect", workContext, work:response.work, card:workCardView(response.work), mission:response.mission });
  }

  return Object.freeze({
    async action(input = {}) {
      try {
        switch (text(input.action).toLowerCase()) {
          case "find": return await find(input);
          case "enter": return await enter(input);
          case "create": return await create(input);
          case "prepare_card": return await prepareCard(input);
          case "confirm_card": return await confirmCard(input);
          case "prepare_route_change": return await prepareRouteChange(input);
          case "confirm_route_change": return await confirmRouteChange(input);
          case "select_context": return await selectContext(input);
          case "note": return await note(input);
          case "ask_light": return await askLight(input);
          case "prepare_factory_card": return await prepareFactoryCard(input);
          case "confirm_factory_card": return await confirmFactoryCard(input);
          case "first_open": return await firstOpen(input);
          case "touch": return await touch(input);
          case "return": return await returnCard(input);
          case "update_card": return await updateCard(input);
          case "exit": return await exit(input);
          case "inspect": return await inspect(input);
          default: return json({ code:"HERMES_ACTION_INVALID" }, 400);
        }
      } catch (error) {
        return json({
          code:error?.message || "HERMES_ACTION_FAILED",
          ...(error?.body ? { cause:error.body } : {}),
        }, Number(error?.status || 500));
      }
    },
  });
}

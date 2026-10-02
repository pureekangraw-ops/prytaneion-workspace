import {
  CENTRE_RECONCILIATION_ALARM_MS,
  centreSessionIsActive,
  createCentreReconciliationService,
} from "./go-hub-centre-reconciliation.mjs";
import { cardCompleteness, workCardView } from "./go-hub-work-card.js";

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = DEFAULT_SESSION_TTL_MS;
const MAX_RECORDS = 200;
const MAX_STATE_CHARS = 750_000;
const HUB_BOARD_STORAGE_KEY = "hub-centre-board-v1";
const HUB_BOARD_ID = "BOARD-LIGHTHOUSE-CENTRE";
const HUB_BOARD_WORK_ID = "WORK-GO-HUB-CENTRE-BOARD";
const SECRET_KEY = /^(?:(?:device|owner|security)?pin(?:hash|code|value)?|.*password|.*passphrase|recovery(?:code|key|phrase|token|secret)|vault(?:key|password|secret|token)|.*secret|.*token)$/i;
const encoder = new TextEncoder();

function clean(value) { return String(value == null ? "" : value).trim(); }
function clone(value) { return value == null ? value : structuredClone(value); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function containsSecret(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(String(key).replace(/[^A-Za-z0-9]/g, ""))) return true;
    if (containsSecret(nested, seen)) return true;
  }
  return false;
}
function requestId(value) {
  const id = clean(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error("SCHEMA_REJECTED");
  return id;
}
function capabilityId(value) {
  const id = clean(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) throw new Error("SCHEMA_REJECTED");
  return id;
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value || "")));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length, 1);
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i % Math.max(a.length, 1)] || 0) ^ (b[i % Math.max(b.length, 1)] || 0);
  }
  return diff === 0;
}
function randomToken() {
  if (!globalThis.crypto?.getRandomValues) throw new Error("HUB_UNAVAILABLE");
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function publicSession(session) {
  if (!session) return null;
  const { tokenHash, ...safe } = session;
  return clone(safe);
}
function newState() {
  return {
    schema:1,
    session:null,
    commands:{},
    receipts:{},
    latest:null,
    reconciliation:{
      cursor:0,
      lastRunAt:null,
      lastError:null,
      lastProcessedWorkIds:[],
      lastSkippedWorkIds:[],
    },
  };
}
function trimRecords(record) {
  const entries = Object.entries(record || {});
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - MAX_RECORDS)));
}

function boardStatus(view = {}) {
  const phase = clean(view.phase).toUpperCase();
  const workStatus = clean(view.work?.status).toUpperCase();
  if (phase === "RECOVERY_REQUIRED" || clean(view.interruption?.state).toUpperCase() === "RECOVERY_REQUIRED") return "PENDING_RECOVERY";
  if (["RETURNED", "COMPLETE", "CANCEL"].includes(workStatus) || phase === "RETURNED") return "ARCHIVED";
  if (phase === "VALIDATED" || phase === "REALITY") return "VERIFY";
  if (workStatus === "ON PROCESS" || workStatus === "AWAY" || phase === "AWAY" || phase === "EXECUTION_RESUME") return "DOING";
  if (workStatus === "WAIT CONFIRM") return "WAIT_CONFIRM";
  return "OPEN";
}

function hubBoardPin(view = {}, previous = null, at = new Date().toISOString()) {
  const workId = requestId(view.routingWorkId || view.workId || view.work?.workId);
  const canonicalWorkId = clean(view.canonicalWorkId || view.work?.workId);
  const owner = clean(view.ownership?.ownerId) || clean(view.work?.role?.roleId) || "GO";
  const priorTouched = Array.isArray(previous?.touchedBy) ? previous.touchedBy.map(clean).filter(Boolean) : [];
  const touchedBy = [...new Set([...priorTouched, owner].filter(Boolean))];
  const reality = view.realityEvidence && typeof view.realityEvidence === "object" ? view.realityEvidence : null;
  const validation = view.validationEvidence && typeof view.validationEvidence === "object" ? view.validationEvidence : null;
  const evidence = [];
  if (reality?.reference) evidence.push({ kind:clean(reality.kind) || "reality", ref:clean(reality.reference) });
  if (validation?.reference) evidence.push({ kind:clean(validation.kind) || "validation", ref:clean(validation.reference) });
  const returned = view.work?.returnedPayload;
  const returnedResult = returned && typeof returned === "object" && !Array.isArray(returned)
    ? clean(returned.result || returned.status)
    : "";
  const resumeFrom = clean(view.executionCheckpoint?.latest?.resumeFrom);
  const status = boardStatus(view);
  const cardWork = {
    ...(view.work || {}),
    workId:canonicalWorkId || workId,
    createdAt:clean(view.work?.createdAt) || clean(previous?.createdAt) || at,
  };
  const card = workCardView(cardWork);
  const cardCheck = cardCompleteness(card);
  const workCard = Object.freeze({
    ...card,
    health:cardCheck.complete ? "NORMAL" : "CAUTION",
    caution:cardCheck.complete ? null : Object.freeze({ kind:"INCOMPLETE_CARD", missing:Object.freeze([...cardCheck.missing]) }),
  });
  return {
    pinId:("PIN:" + workId).slice(0, 128),
    workId,
    canonicalWorkId:canonicalWorkId && canonicalWorkId !== workId ? canonicalWorkId : null,
    checkpointId:clean(view.work?.checkpointId)||null,
    card:workCard,
    jobCode:workCard.jobCode,
    destinations:[...workCard.destinations],
    scope:[...workCard.scope],
    workType:workCard.type,
    title:clean(view.work?.task || view.work?.name || view.work?.command) || workId,
    detail:clean(view.work?.requestedResult),
    status,
    ownerEmployeeId:owner || null,
    touchedBy,
    result:returnedResult || (status === "ARCHIVED" ? "Centre returned" : null),
    nextAction:status === "ARCHIVED" ? null : (resumeFrom || clean(view.work?.requestedResult) || null),
    evidence,
    links:[],
    revision:Number.isSafeInteger(Number(previous?.revision)) ? Number(previous.revision) + 1 : 1,
    createdAt:clean(previous?.createdAt) || at,
    updatedAt:at,
  };
}

function projectionSignature(pin) {
  if (!pin) return "";
  const { revision, createdAt, updatedAt, ...stable } = pin;
  return canonical(stable);
}

export function createLighthouseControlPortSessionService({
  storage,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  randomSessionToken = randomToken,
  onEvent = async () => {},
  scheduleReconciliation = async () => {},
  ensureReconciliation = async () => {},
  cancelReconciliation = async () => {},
} = {}) {
  if (!storage || typeof storage.get !== "function" || typeof storage.put !== "function") {
    throw new TypeError("LIGHTHOUSE control-port storage required");
  }

  async function load() {
    const value = await storage.get("state");
    if (!value || value.schema !== 1) return newState();
    return {
      ...newState(),
      ...clone(value),
      reconciliation:{
        ...newState().reconciliation,
        ...(value.reconciliation || {}),
      },
    };
  }
  async function save(state) {
    const next = clone(state);
    next.commands = trimRecords(next.commands);
    next.receipts = trimRecords(next.receipts);
    await storage.put("state", next);
    return next;
  }
  async function activeSession() {
    const state = await load();
    const session = state.session;
    if (!session || session.active !== true) return { ok:false, code:"SESSION_INACTIVE", state };
    const current = Number(now());
    if (!Number.isFinite(current) || current >= Number(session.expiresAt)) {
      state.session = { ...session, active:false };
      await save(state);
      await cancelReconciliation();
      return { ok:false, code:"SESSION_EXPIRED", state };
    }
    await ensureReconciliation(current + CENTRE_RECONCILIATION_ALARM_MS);
    return { ok:true, session, state };
  }
  async function authorize({ sessionId, sessionToken } = {}) {
    const current = await activeSession();
    if (!current.ok) return current;
    if (clean(sessionId) !== clean(current.session.sessionId)) return { ok:false, code:"SESSION_INACTIVE", state:current.state };
    const supplied = await sha256(sessionToken);
    if (!constantTimeEqual(supplied, current.session.tokenHash)) return { ok:false, code:"SESSION_INACTIVE", state:current.state };
    return current;
  }

  async function emit(event) {
    try { await onEvent(clone(event)); } catch {}
  }

  async function loadHubBoard() {
    const stored = await storage.get(HUB_BOARD_STORAGE_KEY);
    if (stored && stored.schemaVersion === 1 && stored.boardId === HUB_BOARD_ID && Array.isArray(stored.pins)) return stored;
    return { schemaVersion:1, boardId:HUB_BOARD_ID, workId:HUB_BOARD_WORK_ID, revision:0, updatedAt:null, pins:[], audit:[] };
  }

  async function saveHubBoard(board) {
    const next = clone(board);
    next.audit = Array.isArray(next.audit) ? next.audit.slice(-MAX_RECORDS) : [];
    await storage.put(HUB_BOARD_STORAGE_KEY, next);
    const readback = await storage.get(HUB_BOARD_STORAGE_KEY);
    if (canonical(readback) !== canonical(next)) throw new Error("HUB_BOARD_READBACK_MISMATCH");
    return next;
  }

  async function projectCentre(view = {}) {
    if (!view || typeof view !== "object" || Array.isArray(view) || view.ok !== true) return { ok:false, code:"SCHEMA_REJECTED" };
    const at = new Date(Number(now())).toISOString();
    const board = await loadHubBoard();
    const workId = requestId(view.routingWorkId || view.workId || view.work?.workId);
    const canonicalWorkId = clean(view.canonicalWorkId || view.work?.workId);
    let index = board.pins.findIndex(pin => pin?.workId === workId);
    if (index < 0 && canonicalWorkId && canonicalWorkId !== workId) {
      index = board.pins.findIndex(pin => pin?.workId === canonicalWorkId);
    }
    const previous = index >= 0 ? board.pins[index] : null;
    const pin = hubBoardPin(view, previous, at);
    if (previous && projectionSignature(previous) === projectionSignature(pin)) {
      return { ok:true, changed:false, board:clone(board), pin:clone(previous) };
    }
    const next = clone(board);
    next.revision = Number(board.revision || 0) + 1;
    next.updatedAt = at;
    if (index >= 0) next.pins[index] = pin;
    else next.pins.push(pin);
    next.audit.push({ type:"CENTRE_PROJECT", workId, pinId:pin.pinId, status:pin.status, boardRevision:next.revision, at });
    const saved = await saveHubBoard(next);
    await emit({ type:"BOARD_UPDATED", workId, boardRevision:saved.revision, status:pin.status, at });
    return { ok:true, changed:true, board:clone(saved), pin:clone(pin) };
  }

  async function boardLatest() {
    return { ok:true, board:clone(await loadHubBoard()) };
  }

  return Object.freeze({
    async start({ deviceLabel = "LIGHTHOUSE Android", ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
      const ttl = Number(ttlMs);
      if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_SESSION_TTL_MS) return { ok:false, code:"SCHEMA_REJECTED" };
      const sessionId = clean(randomUUID());
      const token = clean(randomSessionToken());
      const startedAt = Number(now());
      if (!sessionId || !token || !Number.isFinite(startedAt)) return { ok:false, code:"HUB_UNAVAILABLE" };
      const state = newState();
      state.session = {
        sessionId,
        tokenHash:await sha256(token),
        active:true,
        deviceLabel:clean(deviceLabel).slice(0, 120) || "LIGHTHOUSE Android",
        startedAt,
        expiresAt:startedAt + ttl,
        lastSeenAt:null,
      };
      await save(state);
      await scheduleReconciliation(startedAt + CENTRE_RECONCILIATION_ALARM_MS);
      return {
        ok:true,
        session_id:sessionId,
        session_token:token,
        expires_at:state.session.expiresAt,
        device_label:state.session.deviceLabel,
      };
    },

    async enqueue({ requestId:requestIdValue, capabilityId:capabilityIdValue, payload = {} } = {}) {
      const session = await activeSession();
      if (!session.ok) return { ok:false, code:session.code };
      const id = requestId(requestIdValue);
      const capId = capabilityId(capabilityIdValue);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || containsSecret(payload)) {
        return { ok:false, code:"SCHEMA_REJECTED" };
      }
      const existing = session.state.commands[id];
      if (existing) {
        if (existing.capabilityId !== capId || canonical(existing.payload) !== canonical(payload)) {
          return { ok:false, code:"REQUEST_ID_CONFLICT" };
        }
        return { ok:true, command:clone(existing), duplicate:true };
      }
      const command = {
        requestId:id,
        capabilityId:capId,
        payload:clone(payload),
        status:"QUEUED",
        queuedAt:new Date(Number(now())).toISOString(),
        deliveredAt:null,
      };
      session.state.commands[id] = command;
      await save(session.state);
      await emit({
        type:"COMMAND_AVAILABLE",
        requestId:id,
        capabilityId:capId,
        at:new Date(Number(now())).toISOString(),
      });
      return { ok:true, command:clone(command), duplicate:false };
    },

    async pull(credentials = {}) {
      const auth = await authorize(credentials);
      if (!auth.ok) return { ok:false, code:auth.code };
      const pending = [];
      for (const command of Object.values(auth.state.commands)) {
        if (auth.state.receipts[command.requestId]) continue;
        command.status = "DELIVERED";
        command.deliveredAt = new Date(Number(now())).toISOString();
        pending.push(clone(command));
      }
      auth.state.session = { ...auth.session, lastSeenAt:Number(now()) };
      await save(auth.state);
      return { ok:true, commands:pending };
    },

    async pushReceipts({ sessionId, sessionToken, receipts } = {}) {
      const auth = await authorize({ sessionId, sessionToken });
      if (!auth.ok) return { ok:false, code:auth.code };
      if (!Array.isArray(receipts) || receipts.length > MAX_RECORDS) return { ok:false, code:"SCHEMA_REJECTED" };
      for (const receipt of receipts) {
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || containsSecret(receipt)) {
          return { ok:false, code:"SCHEMA_REJECTED" };
        }
        const id = requestId(receipt.requestId);
        if (!auth.state.commands[id]) return { ok:false, code:"COMMAND_NOT_FOUND" };
        auth.state.receipts[id] = clone(receipt);
        auth.state.commands[id] = { ...auth.state.commands[id], status:"RECEIPT", receiptAt:new Date(Number(now())).toISOString() };
      }
      auth.state.session = { ...auth.session, lastSeenAt:Number(now()) };
      await save(auth.state);
      await emit({
        type:"RECEIPTS_UPDATED",
        count:receipts.length,
        at:new Date(Number(now())).toISOString(),
      });
      return { ok:true, accepted:receipts.length };
    },

    async pushState({ sessionId, sessionToken, packet } = {}) {
      const auth = await authorize({ sessionId, sessionToken });
      if (!auth.ok) return { ok:false, code:auth.code };
      if (!packet || typeof packet !== "object" || Array.isArray(packet) || containsSecret(packet)) {
        return { ok:false, code:"SCHEMA_REJECTED" };
      }
      if (JSON.stringify(packet).length > MAX_STATE_CHARS) return { ok:false, code:"SCHEMA_REJECTED" };
      auth.state.latest = clone(packet);
      auth.state.session = { ...auth.session, lastSeenAt:Number(now()) };
      await save(auth.state);
      await emit({
        type:"STATE_UPDATED",
        at:new Date(Number(now())).toISOString(),
      });
      return { ok:true };
    },

    async authorizeLive({ sessionId, sessionToken } = {}) {
      const auth = await authorize({ sessionId, sessionToken });
      return auth.ok
        ? { ok:true, session:publicSession(auth.session) }
        : { ok:false, code:auth.code };
    },

    async latest() {
      const current = await activeSession();
      if (!current.ok) return { ok:false, code:current.code, session:publicSession(current.state?.session) };
      return {
        ok:true,
        session:publicSession(current.session),
        latest:clone(current.state.latest),
        commands:Object.values(current.state.commands).map(clone),
        receipts:Object.values(current.state.receipts).map(clone),
        board:(await boardLatest()).board,
        reconciliation:clone(current.state.reconciliation || newState().reconciliation),
      };
    },

    async board(credentials = {}) {
      const auth = await authorize(credentials);
      if (!auth.ok) return { ok:false, code:auth.code };
      auth.state.session = { ...auth.session, lastSeenAt:Number(now()) };
      await save(auth.state);
      return boardLatest();
    },

    projectCentre,
    boardLatest,

    async stop(credentials = {}) {
      const auth = await authorize(credentials);
      if (!auth.ok) return { ok:false, code:auth.code };
      auth.state.session = { ...auth.session, active:false, stoppedAt:Number(now()) };
      await save(auth.state);
      await cancelReconciliation();
      return { ok:true };
    },
  });
}

function internalJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8", "cache-control":"no-store" },
  });
}

export class LighthouseControlPortSessionRegistry {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.liveClients = new Map();
  }

  service() {
    return createLighthouseControlPortSessionService({
      storage:this.ctx.storage,
      onEvent:event => this.broadcast(event),
      scheduleReconciliation:timestamp => this.scheduleReconciliation(timestamp),
      ensureReconciliation:timestamp => this.ensureReconciliation(timestamp),
      cancelReconciliation:() => this.cancelReconciliation(),
    });
  }

  async scheduleReconciliation(timestamp = Date.now() + CENTRE_RECONCILIATION_ALARM_MS) {
    if (typeof this.ctx.storage?.setAlarm === "function") {
      await this.ctx.storage.setAlarm(Number(timestamp));
    }
  }

  async ensureReconciliation(timestamp = Date.now() + CENTRE_RECONCILIATION_ALARM_MS) {
    if (typeof this.ctx.storage?.getAlarm === "function") {
      const existing = await this.ctx.storage.getAlarm();
      if (existing != null) return Number(existing);
    }
    await this.scheduleReconciliation(timestamp);
    return Number(timestamp);
  }

  async cancelReconciliation() {
    if (typeof this.ctx.storage?.deleteAlarm === "function") {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async reconcileCentre({ requireActiveSession = true, seedWorkIds = [] } = {}) {
    const session = this.service();
    const auditNamespace = this.env?.GO_HUB_GLOBAL_AUDIT;
    return createCentreReconciliationService({
      storage:this.ctx.storage,
      audit:{
        async history(input) {
          if (!auditNamespace || typeof auditNamespace.getByName !== "function") {
            return new Response(JSON.stringify({ code:"GLOBAL_AUDIT_NOT_CONFIGURED" }), {
              status:503,
              headers:{ "content-type":"application/json" },
            });
          }
          const audit = auditNamespace.getByName("go-hub-global-audit-v1");
          if (!audit || typeof audit.fetch !== "function") {
            return new Response(JSON.stringify({ code:"GLOBAL_AUDIT_NOT_CONFIGURED" }), {
              status:503,
              headers:{ "content-type":"application/json" },
            });
          }
          return audit.fetch(new Request("https://global-audit.internal/history", {
            method:"POST",
            headers:{ "content-type":"application/json" },
            body:JSON.stringify({ action:"history", ...input }),
          }));
        },
      },
      centreNamespace:this.env?.GO_HUB_CENTRE_STATE,
      projectCentre:view => session.projectCentre(view),
      requireActiveSession,
      seedWorkIds,
    }).reconcile();
  }

  async alarm() {
    const result = await this.reconcileCentre({ requireActiveSession:true });
    const state = await this.ctx.storage.get("state");
    if (centreSessionIsActive(state, Date.now())) {
      await this.scheduleReconciliation();
    } else {
      await this.cancelReconciliation();
    }
    return result;
  }

  broadcast(event) {
    const payload = JSON.stringify(event);
    for (const [socket, state] of this.liveClients) {
      if (state?.authenticated !== true) continue;
      try { socket.send(payload); }
      catch { this.liveClients.delete(socket); }
    }
  }

  async openLive() {
    if (typeof WebSocketPair !== "function") return internalJson({ ok:false, code:"WEBSOCKET_UNAVAILABLE" }, 501);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const authTimer = setTimeout(() => {
      const state = this.liveClients.get(server);
      if (state?.authenticated === true) return;
      try { server.close(4401, "AUTH_TIMEOUT"); } catch {}
      this.liveClients.delete(server);
    }, 10_000);
    this.liveClients.set(server, { authenticated:false, authTimer });

    server.addEventListener("message", async event => {
      let message = null;
      try { message = JSON.parse(String(event.data || "")); } catch {}
      if (!message || message.type !== "AUTH") {
        try { server.send(JSON.stringify({ type:"ERROR", code:"AUTH_REQUIRED" })); } catch {}
        return;
      }
      const auth = await this.service().authorizeLive({
        sessionId:message.sessionId,
        sessionToken:message.sessionToken,
      });
      if (!auth.ok) {
        try { server.send(JSON.stringify({ type:"ERROR", code:auth.code || "SESSION_INACTIVE" })); } catch {}
        try { server.close(4403, "SESSION_INACTIVE"); } catch {}
        this.liveClients.delete(server);
        return;
      }
      clearTimeout(authTimer);
      this.liveClients.set(server, { authenticated:true, authTimer:null });
      try {
        server.send(JSON.stringify({
          type:"READY",
          sessionId:auth.session?.sessionId || null,
          at:new Date().toISOString(),
        }));
      } catch {}
    });
    const cleanup = () => {
      const state = this.liveClients.get(server);
      if (state?.authTimer) clearTimeout(state.authTimer);
      this.liveClients.delete(server);
    };
    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);
    return new Response(null, { status:101, webSocket:client });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/live") {
      const upgrade = clean(request.headers.get("upgrade")).toLowerCase();
      if (request.method !== "GET" || upgrade !== "websocket") {
        return internalJson({ ok:false, code:"WEBSOCKET_UPGRADE_REQUIRED" }, 426);
      }
      return this.openLive();
    }
    if (request.method !== "POST") return internalJson({ ok:false, code:"METHOD_NOT_ALLOWED" }, 405);
    const input = await request.json().catch(() => ({}));
    const service = this.service();
    if (url.pathname === "/start") return internalJson(await service.start(input));
    if (url.pathname === "/enqueue") return internalJson(await service.enqueue(input));
    if (url.pathname === "/pull") return internalJson(await service.pull(input));
    if (url.pathname === "/receipts") return internalJson(await service.pushReceipts(input));
    if (url.pathname === "/state") return internalJson(await service.pushState(input));
    if (url.pathname === "/latest") return internalJson(await service.latest());
    if (url.pathname === "/board") return internalJson(await service.board(input));
    if (url.pathname === "/board/latest") {
      const current = await service.boardLatest();
      const seedWorkIds = Array.isArray(current?.board?.pins)
        ? current.board.pins.map(pin => clean(pin?.workId)).filter(Boolean)
        : [];
      const reconciliation = await this.reconcileCentre({ requireActiveSession:false, seedWorkIds });
      if (!reconciliation?.ok) return internalJson({ ok:false, code:reconciliation?.code || "CENTRE_RECONCILIATION_FAILED" }, 503);
      return internalJson(await service.boardLatest());
    }
    if (url.pathname === "/board/project") return internalJson(await service.projectCentre(input.view));
    if (url.pathname === "/stop") return internalJson(await service.stop(input));
    return internalJson({ ok:false, code:"NOT_FOUND" }, 404);
  }
}

export { DEFAULT_SESSION_TTL_MS, MAX_SESSION_TTL_MS };

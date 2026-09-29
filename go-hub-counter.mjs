const COUNTER_MODES = Object.freeze(["SEARCH", "HANDOFF"]);
const COUNTER_MODE_SET = new Set(COUNTER_MODES);
const ANSWER_STATES = Object.freeze(["ANSWERED", "WAIT", "UNKNOWN", "NEEDS_INPUT", "FAILED", "EXPIRED"]);
const ANSWER_STATE_SET = new Set(ANSWER_STATES);
const CONTINUABLE_ANSWER_STATES = new Set(["SEEN", "WAIT", "NEEDS_INPUT"]);
const NON_TERMINAL_ANSWER_STATES = new Set(["WAIT", "NEEDS_INPUT"]);
const SECRET_FIELD = /(authorization|token|secret|passcode|master.?key)/i;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(label + " is required"), { status: 400 });
  return text;
}

function actor(value, fallback = null) {
  const text = String(value || fallback || "").trim().toUpperCase();
  if (!["GO", "LIGHT"].includes(text)) throw Object.assign(new Error("COUNTER_ACTOR_INVALID"), { status: 400 });
  return text;
}

function stringList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error(label + " must be an array"), { status: 400 });
  return value.map(item => required(item, label + " item"));
}

function objectValue(value, label, { optional = false } = {}) {
  if (value == null && optional) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(label + " must be an object"), { status: 400 });
  }
  return clone(value);
}

function objectList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error(label + " must be an array"), { status: 400 });
  return value.map((item, index) => objectValue(item, label + "[" + index + "]"));
}

function rejectSecrets(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      throw Object.assign(new Error("SECRET_FIELD_REJECTED:" + path + "." + key), { status: 400 });
    }
    rejectSecrets(nested, path + "." + key);
  }
}

function workIdentity(input = {}) {
  const workContext = objectValue(input.workContext, "workContext");
  return {
    workId: required(workContext.workId, "workContext.workId"),
    checkpointId: required(workContext.checkpointId, "workContext.checkpointId"),
  };
}

function assertIdentity(state, input) {
  const identity = workIdentity(input);
  if (identity.workId !== state.workId || identity.checkpointId !== state.checkpointId) {
    throw Object.assign(new Error("COUNTER_WORK_IDENTITY_MISMATCH"), { status: 409 });
  }
  const counterId = required(input.counterId, "Counter ID");
  if (counterId !== state.counterId) {
    throw Object.assign(new Error("COUNTER_ID_MISMATCH"), { status: 409 });
  }
}

function appendEvent(state, type, actor, at, detail = null) {
  const nextSequence = state.events.length + 1;
  state.events.push({
    sequence: nextSequence,
    type,
    actor,
    at,
    ...(detail == null ? {} : { detail: clone(detail) }),
  });
}

function publicState(state, extra = {}) {
  return {
    ok: true,
    counter: clone(state),
    ...extra,
  };
}

export function createCounterCore({ now = () => new Date().toISOString() } = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");

  function create(input = {}, current = null) {
    rejectSecrets(input);
    const identity = workIdentity(input);
    const counterId = required(input.counterId, "Counter ID");
    const mode = String(input.mode || "SEARCH").trim().toUpperCase();
    if (!COUNTER_MODE_SET.has(mode)) throw Object.assign(new Error("COUNTER_MODE_INVALID"), { status:400 });
    const fromActor = actor(input.fromActor, "GO");
    const toActor = actor(input.toActor, fromActor === "GO" ? "LIGHT" : "GO");
    if (fromActor === toActor) throw Object.assign(new Error("COUNTER_ACTOR_ROUTE_INVALID"), { status:400 });
    const request = required(input.request, "Request");
    const requestedResult = input.requestedResult == null ? null : required(input.requestedResult, "Requested result");
    const authority = input.authority == null ? null : required(input.authority, "Authority");
    const target = input.target == null ? null : required(input.target, "Target");
    const projectRef = input.projectRef == null ? null : required(input.projectRef, "Project reference");
    if (mode === "HANDOFF" && !requestedResult) throw Object.assign(new Error("HANDOFF_REQUESTED_RESULT_REQUIRED"), { status:400 });
    const context = objectValue(input.context, "Context", { optional: true });
    const sourceHints = stringList(input.sourceHints, "Source hints");
    const doNotChange = stringList(input.doNotChange, "Do not change");

    if (current) {
      if (current.counterId !== counterId ||
          current.workId !== identity.workId ||
          current.checkpointId !== identity.checkpointId) {
        throw Object.assign(new Error("COUNTER_ALREADY_EXISTS"), { status: 409 });
      }
      if (current.request !== request) {
        throw Object.assign(new Error("COUNTER_REQUEST_MISMATCH"), { status: 409 });
      }
      if ((current.mode || "SEARCH") !== mode) throw Object.assign(new Error("COUNTER_MODE_MISMATCH"), { status:409 });
      if ((current.from || "GO") !== fromActor || (current.to || "LIGHT") !== toActor) {
        throw Object.assign(new Error("COUNTER_ACTOR_ROUTE_MISMATCH"), { status:409 });
      }
      return publicState(current, { idempotent: true });
    }

    const at = now();
    const state = {
      counterId,
      revision: 1,
      workId: identity.workId,
      checkpointId: identity.checkpointId,
      workContext: clone(input.workContext),
      mode,
      requestedResult,
      authority,
      target,
      projectRef,
      from: fromActor,
      to: toActor,
      request,
      context,
      sourceHints,
      doNotChange,
      currentState: "OPEN",
      createdAt: at,
      seenAt: null,
      answeredAt: null,
      readBackAt: null,
      closedAt: null,
      answer: null,
      sources: [],
      evidence: [],
      confidence: null,
      nextRoute: null,
      events: [],
    };
    appendEvent(state, "OPEN", fromActor, at, { request, to:toActor });
    return publicState(state, { created: true });
  }

  function get(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("COUNTER_NOT_FOUND"), { status: 404 });
    assertIdentity(current, input);
    return publicState(current);
  }

  function seen(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("COUNTER_NOT_FOUND"), { status: 404 });
    rejectSecrets(input);
    assertIdentity(current, input);
    const seenActor = actor(input.actor, current.to || "LIGHT");
    if (seenActor !== (current.to || "LIGHT")) throw Object.assign(new Error("COUNTER_RECIPIENT_ACTOR_MISMATCH"), { status:403 });
    if (current.events.some(item => item.type === "SEEN")) {
      return publicState(current, { idempotent: true });
    }
    if (current.currentState !== "OPEN") {
      throw Object.assign(new Error("COUNTER_INVALID_TRANSITION:" + current.currentState + "->SEEN"), { status: 409 });
    }
    const state = clone(current);
    const at = now();
    state.revision += 1;
    state.currentState = "SEEN";
    state.seenAt = at;
    appendEvent(state, "SEEN", seenActor, at);
    return publicState(state);
  }

  function answer(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("COUNTER_NOT_FOUND"), { status: 404 });
    rejectSecrets(input);
    assertIdentity(current, input);
    const answerActor = actor(input.actor, current.to || "LIGHT");
    if (answerActor !== (current.to || "LIGHT")) throw Object.assign(new Error("COUNTER_RECIPIENT_ACTOR_MISMATCH"), { status:403 });
    const status = required(input.status, "Answer status").toUpperCase();
    if (!ANSWER_STATE_SET.has(status)) {
      throw Object.assign(new Error("COUNTER_INVALID_ANSWER_STATUS"), { status: 400 });
    }
    const answerText = required(input.answer, "Answer");
    const sources = stringList(input.sources, "Sources");
    const evidence = objectList(input.evidence, "Evidence");
    const confidence = input.confidence == null ? null : String(input.confidence);
    const nextRoute = input.nextRoute == null ? null : String(input.nextRoute).trim() || null;

    if (current.currentState === status &&
        current.answer === answerText &&
        JSON.stringify(current.sources) === JSON.stringify(sources) &&
        JSON.stringify(current.evidence) === JSON.stringify(evidence)) {
      return publicState(current, { idempotent: true });
    }
    if (!CONTINUABLE_ANSWER_STATES.has(current.currentState)) {
      throw Object.assign(new Error("COUNTER_INVALID_TRANSITION:" + current.currentState + "->" + status), { status: 409 });
    }
    // Counter validates the integrity of its own answer. Hub passage evidence acceptance belongs to Heimdall.
    if (status === "ANSWERED" && (sources.length === 0 || evidence.length === 0)) {
      throw Object.assign(new Error("COUNTER_ANSWER_REQUIRES_SOURCE_AND_EVIDENCE"), { status: 400 });
    }

    const state = clone(current);
    const at = now();
    state.revision += 1;
    state.currentState = status;
    state.answeredAt = at;
    state.answer = answerText;
    state.sources = sources;
    state.evidence = evidence;
    state.confidence = confidence;
    state.nextRoute = nextRoute;
    appendEvent(state, status, answerActor, at, {
      sources: sources.length,
      evidence: evidence.length,
      nextRoute,
    });
    return publicState(state);
  }

  function readback(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("COUNTER_NOT_FOUND"), { status: 404 });
    rejectSecrets(input);
    assertIdentity(current, input);
    const readbackActor = actor(input.actor, current.from || "GO");
    if (readbackActor !== (current.from || "GO")) throw Object.assign(new Error("COUNTER_ORIGIN_ACTOR_MISMATCH"), { status:403 });

    if (current.currentState === "CLOSED" && current.events.some(item => item.type === "READBACK")) {
      return publicState(current, { idempotent: true });
    }

    const legacyReadbackState = current.currentState === "READBACK";
    if (!ANSWER_STATE_SET.has(current.currentState) && !legacyReadbackState) {
      throw Object.assign(new Error("COUNTER_INVALID_TRANSITION:" + current.currentState + "->READBACK"), { status: 409 });
    }

    const evidence = objectValue(input.evidence, "Readback evidence");
    if (Object.keys(evidence).length === 0) {
      throw Object.assign(new Error("COUNTER_READBACK_EVIDENCE_REQUIRED"), { status: 400 });
    }

    const closeRequested =
      input.close === true ||
      (input.close !== false && !NON_TERMINAL_ANSWER_STATES.has(current.currentState));

    const latestReadback = [...current.events].reverse().find(item => item.type === "READBACK");
    if (!closeRequested &&
        latestReadback &&
        JSON.stringify(latestReadback.detail || {}) === JSON.stringify(evidence)) {
      return publicState(current, { idempotent: true });
    }

    const state = clone(current);
    const at = now();
    state.revision += 1;
    state.readBackAt = at;
    appendEvent(state, "READBACK", readbackActor, at, evidence);

    if (closeRequested) {
      state.currentState = "CLOSED";
      state.closedAt = at;
      appendEvent(state, "CLOSED", "HUB", at, { priorState: current.currentState });
    }
    return publicState(state);
  }

  return Object.freeze({ create, get, seen, answer, readback });
}

export class GoHubCounterState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.core = createCounterCore();
  }

  async load() {
    return (await this.ctx.storage.get("counter")) || null;
  }

  async save(state) {
    await this.ctx.storage.put("counter", clone(state));
    const readback = await this.ctx.storage.get("counter");
    if (JSON.stringify(readback) !== JSON.stringify(state)) {
      throw Object.assign(new Error("COUNTER_DURABLE_READBACK_MISMATCH"), { status: 500 });
    }
  }

  async act(input = {}) {
    const action = required(input.action, "Counter action").toLowerCase();
    const current = await this.load();
    if (action === "get") return this.core.get(input, current);

    const result = action === "create" ? this.core.create(input, current)
      : action === "seen" ? this.core.seen(input, current)
      : action === "answer" ? this.core.answer(input, current)
      : action === "readback" ? this.core.readback(input, current)
      : (() => { throw Object.assign(new Error("COUNTER_ACTION_UNSUPPORTED"), { status: 400 }); })();

    if (!result.idempotent) await this.save(result.counter);
    return result;
  }

  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
      const input = await request.json().catch(() => null);
      if (!input || typeof input !== "object" || Array.isArray(input)) return json({ code: "INVALID_JSON" }, 400);
      return json(await this.act(input));
    } catch (error) {
      return json({ code: error?.message || "COUNTER_ERROR" }, error?.status || 400);
    }
  }
}

function counterStub(namespace, counterId) {
  if (!namespace || typeof namespace.getByName !== "function") return null;
  return namespace.getByName(counterId);
}

function inboxStub(namespace, recipient = "LIGHT") {
  if (!namespace || typeof namespace.getByName !== "function") return null;
  return namespace.getByName(actor(recipient, "LIGHT").toLowerCase());
}

function inboxEnvelope(input = {}) {
  const mode = String(input.mode || "SEARCH").trim().toUpperCase();
  if (mode !== "HANDOFF") throw Object.assign(new Error("COUNTER_INBOX_HANDOFF_ONLY"), { status:400 });
  const workContext = objectValue(input.workContext, "workContext");
  const fromActor = actor(input.fromActor, "GO");
  const toActor = actor(input.toActor, fromActor === "GO" ? "LIGHT" : "GO");
  if (fromActor === toActor) throw Object.assign(new Error("COUNTER_ACTOR_ROUTE_INVALID"), { status:400 });
  return {
    counterId:required(input.counterId, "Counter ID"),
    workId:required(workContext.workId, "Work ID"),
    checkpointId:required(workContext.checkpointId, "Checkpoint ID"),
    mode,
    from:fromActor,
    to:toActor,
    request:required(input.request, "Request"),
    requestedResult:required(input.requestedResult, "Requested result"),
    authority:input.authority == null ? null : required(input.authority, "Authority"),
    target:input.target == null ? null : required(input.target, "Target"),
    projectRef:input.projectRef == null ? null : required(input.projectRef, "Project reference"),
    context:objectValue(input.context, "Context", { optional:true }),
    sourceHints:stringList(input.sourceHints, "Source hints"),
    doNotChange:stringList(input.doNotChange, "Do not change"),
    workContext:clone(workContext),
  };
}

export class GoHubCounterInboxState {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async load() { return (await this.ctx.storage.get("handoffs")) || []; }
  async save(records) {
    await this.ctx.storage.put("handoffs", clone(records));
    const readback = await this.ctx.storage.get("handoffs");
    if (JSON.stringify(readback) !== JSON.stringify(records)) throw Object.assign(new Error("COUNTER_INBOX_DURABLE_READBACK_MISMATCH"), { status:500 });
  }
  async act(input = {}) {
    const action = required(input.action, "Counter inbox action").toLowerCase();
    let records = await this.load();
    if (action === "enqueue") {
      rejectSecrets(input);
      const envelope = inboxEnvelope(input);
      const existing = records.find(item => item.counterId === envelope.counterId);
      if (existing) return { ok:true, inbox:clone(existing), idempotent:true };
      const record = { ...envelope, status:"WAITING_PICKUP", queuedAt:new Date().toISOString() };
      records = [...records, record];
      await this.save(records);
      return { ok:true, inbox:clone(record), created:true };
    }
    if (action === "list") {
      rejectSecrets(input);
      const workContext = objectValue(input.workContext, "workContext");
      const limit = Math.min(Math.max(Number(input.limit || 20), 1), 50);
      const workId = required(workContext.workId, "Work ID");
      const checkpointId = required(workContext.checkpointId, "Checkpoint ID");
      const recipient = actor(input.actor, "LIGHT");
      const pending = records.filter(item => item.status === "WAITING_PICKUP" && item.workId === workId && item.checkpointId === checkpointId && (item.to || "LIGHT") === recipient).slice(0, limit);
      return { ok:true, inbox:{ status:"WAITING_PICKUP", count:pending.length, tickets:clone(pending) } };
    }
    if (action === "mark") {
      rejectSecrets(input);
      const counterId = required(input.counterId, "Counter ID");
      const status = required(input.status, "Inbox status").toUpperCase();
      const workContext = objectValue(input.workContext, "workContext");
      assertIdentity({ counterId, workId:workContext.workId, checkpointId:workContext.checkpointId }, input);
      const index = records.findIndex(item => item.counterId === counterId);
      if (index < 0) return { ok:true, missing:true };
      const next = clone(records);
      next[index].status = status;
      next[index].updatedAt = new Date().toISOString();
      await this.save(next);
      return { ok:true, inbox:clone(next[index]) };
    }
    throw Object.assign(new Error("COUNTER_INBOX_ACTION_UNSUPPORTED"), { status:400 });
  }
  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
      const input = await request.json().catch(() => null);
      if (!input || typeof input !== "object" || Array.isArray(input)) return json({ code:"INVALID_JSON" }, 400);
      return json(await this.act(input));
    } catch (error) { return json({ code:error?.message || "COUNTER_INBOX_ERROR" }, error?.status || 400); }
  }
}

export function createCounterService({ namespace, inboxNamespace } = {}) {
  async function inboxCall(recipient, action, body) {
    const inbox = inboxStub(inboxNamespace, recipient);
    if (!inbox || typeof inbox.fetch !== "function") {
      return json({ code:"COUNTER_INBOX_NOT_CONFIGURED", actor:recipient }, 503);
    }
    return inbox.fetch(new Request("https://counter-inbox.internal/" + action, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ ...body, action }),
    }));
  }

  async function call(action, input = {}) {
    if (action === "inbox") {
      const recipient = actor(input.actor, "LIGHT");
      return inboxCall(recipient, "list", input);
    }

    const counterId = required(input.counterId, "Counter ID");
    const stub = counterStub(namespace, counterId);
    if (!stub || typeof stub.fetch !== "function") return json({ code:"COUNTER_STATE_NOT_CONFIGURED" }, 503);
    const response = await stub.fetch(new Request("https://counter-state.internal/action", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ ...input, action }),
    }));
    if (!response.ok || !["create", "seen", "answer", "readback"].includes(action)) return response;

    const payload = await response.clone().json().catch(() => ({}));
    const state = payload.counter || {};
    if (state.mode !== "HANDOFF") return response;

    const workContext = state.workContext || input.workContext;
    const recipient = actor(state.to, "LIGHT");

    if (["create", "seen", "answer"].includes(action)) {
      const inboxAction = action === "create" ? "enqueue" : "mark";
      const body = action === "create"
        ? {
            ...input,
            mode:"HANDOFF",
            counterId:state.counterId,
            fromActor:state.from,
            toActor:state.to,
            workContext,
          }
        : {
            counterId:state.counterId,
            workContext,
            status:state.currentState,
          };
      const inboxResponse = await inboxCall(recipient, inboxAction, body);
      if (!inboxResponse.ok) return inboxResponse;
    }

    if (action === "answer") {
      const origin = actor(state.from, "GO");
      const answer = {
        status:state.currentState,
        answer:state.answer,
        sources:clone(state.sources || []),
        evidence:clone(state.evidence || []),
        confidence:state.confidence,
        nextRoute:state.nextRoute,
      };
      const returnResponse = await inboxCall(origin, "enqueue", {
        counterId:state.counterId,
        mode:"HANDOFF",
        fromActor:recipient,
        toActor:origin,
        request:required(state.answer, "Answer"),
        requestedResult:"Origin actor reads back and closes this same Counter ticket.",
        authority:state.authority,
        target:state.target,
        projectRef:state.projectRef,
        context:{
          ...(state.context && typeof state.context === "object" ? clone(state.context) : {}),
          kind:"COUNTER_ANSWER_READY",
          answer,
        },
        sourceHints:clone(state.sources || []),
        doNotChange:[
          "Do not create a new Work or Checkpoint",
          "Read back this same Counter ticket",
        ],
        workContext,
      });
      if (!returnResponse.ok) return returnResponse;
    }

    if (action === "readback") {
      const origin = actor(state.from, "GO");
      const returnResponse = await inboxCall(origin, "mark", {
        counterId:state.counterId,
        workContext,
        status:state.currentState,
      });
      if (!returnResponse.ok) return returnResponse;
    }

    return response;
  }

  return Object.freeze({
    create: input => call("create", input),
    inbox: input => call("inbox", input),
    get: input => call("get", input),
    seen: input => call("seen", input),
    answer: input => call("answer", input),
    readback: input => call("readback", input),
  });
}

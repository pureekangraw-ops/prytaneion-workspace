const MAX_ATTEMPTS = 5;
const WAITING_TARGET_RETRY_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = Object.freeze([1_000, 5_000, 30_000, 120_000, 300_000]);
const COUNTER_HELPERS = Object.freeze(["PIXIE", "HERMES", "LIGHT", "SPECTRUM"]);
const COUNTER_ACTORS = Object.freeze(["GO", ...COUNTER_HELPERS]);
const COUNTER_ACTOR_SET = new Set(COUNTER_ACTORS);
const SECRET_FIELD = /(authorization|token|secret|passcode|master.?key|password|bearer)/i;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function clone(value) { return value == null ? value : structuredClone(value); }
function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw Object.assign(new Error(label + " is required"), { status:400 });
  return text;
}
function actor(value, fallback = null) {
  const text = String(value || fallback || "").trim().toUpperCase();
  if (!COUNTER_ACTOR_SET.has(text)) throw Object.assign(new Error("DISPATCH_ACTOR_INVALID"), { status:400 });
  return text;
}
function objectValue(value, label, optional = false) {
  if (value == null && optional) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(label + " must be an object"), { status:400 });
  }
  return clone(value);
}
function rejectSecrets(value, path = "root") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) {
      throw Object.assign(new Error("SECRET_FIELD_REJECTED:" + path + "." + key), { status:400 });
    }
    rejectSecrets(nested, path + "." + key);
  }
}
function leg() {
  return {
    status:"IDLE",
    attempts:0,
    lastAttemptAt:null,
    nextAttemptAt:null,
    deliveredAt:null,
    lastError:null,
    receipt:null,
  };
}
function bell() {
  return {
    status:"IDLE",
    target:null,
    attempts:0,
    lastAttemptAt:null,
    nextAttemptAt:null,
    deliveredAt:null,
    lastError:null,
    receipt:null,
  };
}
function append(state, type, target, at, detail = null) {
  state.events.push({
    sequence:state.events.length + 1,
    type,
    target,
    at,
    ...(detail == null ? {} : { detail:clone(detail) }),
  });
}
function assertIdentity(state, input) {
  if (required(input.counterId, "Counter ID") !== state.counterId ||
      required(input.workId, "Work ID") !== state.workId ||
      required(input.checkpointId, "Checkpoint ID") !== state.checkpointId) {
    throw Object.assign(new Error("DISPATCH_IDENTITY_MISMATCH"), { status:409 });
  }
}
function publicState(state, extra = {}) {
  return { ok:true, dispatch:clone(state), ...extra };
}

export function createCounterDispatchCore({
  now = () => Date.now(),
  maxAttempts = MAX_ATTEMPTS,
} = {}) {
  function stamp() { return new Date(Number(now())).toISOString(); }
  function enqueueOpen(input = {}, current = null) {
    rejectSecrets(input);
    const counterId = required(input.counterId, "Counter ID");
    const workId = required(input.workId, "Work ID");
    const checkpointId = required(input.checkpointId, "Checkpoint ID");
    const mode = String(input.mode || "SEARCH").trim().toUpperCase();
    if (!["SEARCH", "HANDOFF"].includes(mode)) throw Object.assign(new Error("DISPATCH_MODE_INVALID"), { status:400 });
    const fromActor = actor(input.fromActor, "GO");
    const toActor = actor(input.toActor, fromActor === "GO" ? "LIGHT" : "GO");
    if (fromActor === toActor) throw Object.assign(new Error("DISPATCH_ACTOR_ROUTE_INVALID"), { status:400 });
    const request = required(input.request, "Request");
    const workContext = objectValue(input.workContext, "Work context", true);
    const requestedResult = input.requestedResult == null ? null : required(input.requestedResult, "Requested result");
    const authority = input.authority == null ? null : required(input.authority, "Authority");
    const targetReference = input.target == null ? null : required(input.target, "Target");
    const projectRef = input.projectRef == null ? null : required(input.projectRef, "Project reference");
    if (mode === "HANDOFF" && !requestedResult) throw Object.assign(new Error("HANDOFF_REQUESTED_RESULT_REQUIRED"), { status:400 });
    const context = objectValue(input.context, "Context", true);
    const sourceHints = Array.isArray(input.sourceHints) ? input.sourceHints.map(String) : [];
    const doNotChange = Array.isArray(input.doNotChange) ? input.doNotChange.map(String) : [];
    if (current) {
      assertIdentity(current, { counterId, workId, checkpointId });
      if (current.request !== request) {
        throw Object.assign(new Error("DISPATCH_REQUEST_MISMATCH"), { status:409 });
      }
      if ((current.fromActor || "GO") !== fromActor || (current.toActor || "LIGHT") !== toActor) {
        throw Object.assign(new Error("DISPATCH_ACTOR_ROUTE_MISMATCH"), { status:409 });
      }
      return publicState(current, { idempotent:true });
    }
    const at = stamp();
    const state = {
      counterId, workId, checkpointId, revision:1,
      request, workContext, mode, requestedResult, authority, target:targetReference, projectRef, context, sourceHints, doNotChange,
      fromActor, toActor,
      answer:null,
      lightResult:null,
      legs:Object.fromEntries(COUNTER_ACTORS.map(name => [name, leg()])),
      bell:bell(),
      events:[],
      createdAt:at,
      updatedAt:at,
    };
    state.legs[toActor].status = "QUEUED";
    append(state, "QUEUED", toActor, at, { type:"NEW_COUNTER_TICKET", from:fromActor, to:toActor });
    return publicState(state, { created:true });
  }

  function enqueueAnswer(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    rejectSecrets(input);
    assertIdentity(current, input);
    const answer = {
      status:required(input.status, "Answer status"),
      answer:required(input.answer, "Answer"),
      sources:Array.isArray(input.sources) ? input.sources.map(String) : [],
      evidence:Array.isArray(input.evidence) ? clone(input.evidence) : [],
      confidence:input.confidence == null ? null : String(input.confidence),
      nextRoute:input.nextRoute == null ? null : String(input.nextRoute),
    };
    const fingerprint = JSON.stringify(answer);
    const targetActor = actor(current.fromActor, "GO");
    if (current.answer && JSON.stringify(current.answer) === fingerprint &&
        current.legs[targetActor].status !== "IDLE") {
      return publicState(current, { idempotent:true });
    }
    const state = clone(current);
    state.revision += 1;
    state.answer = answer;
    state.legs[targetActor] = leg();
    state.legs[targetActor].status = "QUEUED";
    state.updatedAt = stamp();
    append(state, "QUEUED", targetActor, state.updatedAt, { type:"COUNTER_ANSWER_READY", status:answer.status });
    return publicState(state);
  }

  function waitingTarget(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    if (!COUNTER_ACTOR_SET.has(target)) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    const state = clone(current);
    const targetLeg = state.legs[target];
    const alreadyWaiting = targetLeg.status === "WAITING_TARGET";
    const staleNextAttemptAt = targetLeg.nextAttemptAt;
    if (alreadyWaiting && staleNextAttemptAt == null) {
      return publicState(state, { idempotent:true });
    }
    state.revision += 1;
    targetLeg.status = "WAITING_TARGET";
    targetLeg.lastError = "CALLABLE_TARGET_NOT_CONFIGURED";
    targetLeg.nextAttemptAt = null;
    state.updatedAt = stamp();
    append(
      state,
      alreadyWaiting ? "WAITING_TARGET_RECONCILED" : "WAITING_TARGET",
      target,
      state.updatedAt,
      alreadyWaiting ? { clearedNextAttemptAt:staleNextAttemptAt } : null,
    );
    return publicState(state, { reconciled:alreadyWaiting });
  }

  function waitingPickup(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    if (!COUNTER_ACTOR_SET.has(target)) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    const state = clone(current);
    const targetLeg = state.legs[target];
    if (targetLeg.status === "WAITING_PICKUP" && targetLeg.nextAttemptAt == null) return publicState(state, { idempotent:true });
    state.revision += 1;
    targetLeg.status = "WAITING_PICKUP";
    targetLeg.lastError = null;
    targetLeg.nextAttemptAt = null;
    state.updatedAt = stamp();
    append(state, "WAITING_PICKUP", target, state.updatedAt, {
      mode:state.mode || "SEARCH",
      transport:"COUNTER_INBOX",
    });
    return publicState(state);
  }

  function rung(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    if (!COUNTER_ACTOR_SET.has(target)) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    const state = clone(current);
    const targetLeg = state.legs[target];
    state.revision += 1;
    targetLeg.status = "WAITING_PICKUP";
    targetLeg.lastError = null;
    targetLeg.nextAttemptAt = null;
    targetLeg.receipt = input.receipt && typeof input.receipt === "object" ? clone(input.receipt) : {};
    state.updatedAt = stamp();
    append(state, "RUNG", target, state.updatedAt, targetLeg.receipt);
    return publicState(state);
  }

  function waitingAuth(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const targetLeg = state.legs[target];
    if (!targetLeg) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    if (targetLeg.status === "WAITING_AUTH" && targetLeg.nextAttemptAt == null) {
      return publicState(state, { idempotent:true });
    }
    state.revision += 1;
    targetLeg.status = "WAITING_AUTH";
    targetLeg.lastError = "NOTION_LIGHT_AUTH_REQUIRED";
    targetLeg.nextAttemptAt = null;
    state.updatedAt = stamp();
    append(state, "WAITING_AUTH", target, state.updatedAt);
    return publicState(state);
  }

  function blocked(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const targetLeg = state.legs[target];
    if (!targetLeg) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    const code = String(input.error || "DISPATCH_BLOCKED").slice(0, 240);
    if (targetLeg.status === "BLOCKED" && targetLeg.lastError === code) {
      return publicState(state, { idempotent:true });
    }
    state.revision += 1;
    targetLeg.status = "BLOCKED";
    targetLeg.lastError = code;
    targetLeg.nextAttemptAt = null;
    state.updatedAt = stamp();
    append(state, "BLOCKED", target, state.updatedAt, { error:code });
    return publicState(state);
  }

  function beginAttempt(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const targetLeg = state.legs[target];
    if (!targetLeg) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    if (targetLeg.status === "DELIVERED" || targetLeg.status === "DEAD_LETTER") {
      return publicState(state, { idempotent:true });
    }
    state.revision += 1;
    targetLeg.status = "DISPATCHING";
    targetLeg.attempts += 1;
    targetLeg.lastAttemptAt = stamp();
    targetLeg.nextAttemptAt = null;
    targetLeg.lastError = null;
    state.updatedAt = targetLeg.lastAttemptAt;
    append(state, "ATTEMPT", target, state.updatedAt, { attempt:targetLeg.attempts });
    return publicState(state);
  }

  function delivered(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const targetLeg = state.legs[target];
    if (!targetLeg) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    if (targetLeg.status === "DELIVERED") return publicState(state, { idempotent:true });
    state.revision += 1;
    targetLeg.status = "DELIVERED";
    targetLeg.deliveredAt = stamp();
    targetLeg.nextAttemptAt = null;
    targetLeg.lastError = null;
    targetLeg.receipt = input.receipt && typeof input.receipt === "object" ? clone(input.receipt) : {};
    state.updatedAt = targetLeg.deliveredAt;
    append(state, "DELIVERED", target, state.updatedAt, targetLeg.receipt);
    return publicState(state);
  }

  function beginBellAttempt(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    if (!COUNTER_ACTOR_SET.has(target)) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    const state = clone(current);
    const currentBell = state.bell || bell();
    if (currentBell.status === "DELIVERED" || currentBell.status === "DEAD_LETTER") {
      state.bell = currentBell;
      return publicState(state, { idempotent:true });
    }
    state.revision += 1;
    currentBell.status = "DISPATCHING";
    currentBell.target = target;
    currentBell.attempts += 1;
    currentBell.lastAttemptAt = stamp();
    currentBell.nextAttemptAt = null;
    currentBell.lastError = null;
    state.bell = currentBell;
    state.updatedAt = currentBell.lastAttemptAt;
    append(state, "BELL_ATTEMPT", target, state.updatedAt, { attempt:currentBell.attempts });
    return publicState(state);
  }

  function bellDelivered(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const currentBell = state.bell || bell();
    state.revision += 1;
    currentBell.status = "DELIVERED";
    currentBell.target = target;
    currentBell.deliveredAt = stamp();
    currentBell.nextAttemptAt = null;
    currentBell.lastError = null;
    currentBell.receipt = input.receipt && typeof input.receipt === "object" ? clone(input.receipt) : {};
    state.bell = currentBell;
    state.updatedAt = currentBell.deliveredAt;
    append(state, "BELL_DELIVERED", target, state.updatedAt, currentBell.receipt);
    return publicState(state);
  }

  function bellFailed(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const currentBell = state.bell || bell();
    state.revision += 1;
    currentBell.target = target;
    currentBell.lastError = String(input.error || "BELL_FAILED").slice(0, 240);
    const exhausted = currentBell.attempts >= maxAttempts;
    currentBell.status = exhausted ? "DEAD_LETTER" : "RETRY_WAIT";
    currentBell.nextAttemptAt = exhausted ? null : new Date(
      Number(now()) + RETRY_DELAYS_MS[Math.min(Math.max(currentBell.attempts - 1, 0), RETRY_DELAYS_MS.length - 1)]
    ).toISOString();
    state.bell = currentBell;
    state.updatedAt = stamp();
    append(state, exhausted ? "BELL_DEAD_LETTER" : "BELL_RETRY_WAIT", target, state.updatedAt, {
      attempts:currentBell.attempts,
      error:currentBell.lastError,
      nextAttemptAt:currentBell.nextAttemptAt,
    });
    return publicState(state);
  }

  function failed(input = {}, current = null) {
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const target = required(input.target, "Target").toUpperCase();
    const state = clone(current);
    const targetLeg = state.legs[target];
    if (!targetLeg) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    state.revision += 1;
    targetLeg.lastError = String(input.error || "DISPATCH_FAILED").slice(0, 240);
    const exhausted = targetLeg.attempts >= maxAttempts;
    targetLeg.status = exhausted ? "DEAD_LETTER" : "RETRY_WAIT";
    targetLeg.nextAttemptAt = exhausted ? null : new Date(
      Number(now()) + RETRY_DELAYS_MS[Math.min(Math.max(targetLeg.attempts - 1, 0), RETRY_DELAYS_MS.length - 1)]
    ).toISOString();
    state.updatedAt = stamp();
    append(state, exhausted ? "DEAD_LETTER" : "RETRY_WAIT", target, state.updatedAt, {
      attempts:targetLeg.attempts,
      error:targetLeg.lastError,
      nextAttemptAt:targetLeg.nextAttemptAt,
    });
    return publicState(state);
  }

  return Object.freeze({ enqueueOpen, enqueueAnswer, waitingTarget, waitingPickup, rung, waitingAuth, blocked, beginAttempt, delivered, failed, beginBellAttempt, bellDelivered, bellFailed });
}

function endpoint(env, target) {
  if (target === "LIGHT") return { url:String(env?.LIGHT_WAKE_URL || "").trim(), bearer:String(env?.LIGHT_WAKE_BEARER || "").trim() };
  if (target === "GO") return { url:String(env?.GO_WAKE_URL || "").trim(), bearer:String(env?.GO_WAKE_BEARER || "").trim() };
  return { url:"", bearer:"" };
}
function wakePayload(state, target) {
  const destination = actor(state.toActor, "LIGHT");
  const origin = actor(state.fromActor, "GO");
  if (target === destination && !state.answer) {
    return {
      type:"NEW_COUNTER_TICKET",
      target:destination,
      from:origin,
      to:destination,
      counterId:state.counterId,
      workId:state.workId,
      checkpointId:state.checkpointId,
      mode:state.mode || "SEARCH",
      request:state.request,
      requestedResult:state.requestedResult || null,
      authority:state.authority || null,
      targetReference:state.target || null,
      projectRef:state.projectRef || null,
      workContext:clone(state.workContext || {}),
      context:clone(state.context),
      sourceHints:clone(state.sourceHints),
      doNotChange:clone(state.doNotChange),
    };
  }
  return {
    type:"COUNTER_ANSWER_READY",
    target:origin,
    from:destination,
    to:origin,
    counterId:state.counterId,
    workId:state.workId,
    checkpointId:state.checkpointId,
    ...clone(state.answer || {}),
  };
}
function publicReceipt(response, payload) {
  return {
    httpStatus:Number(response?.status || 0),
    receiptId:payload && typeof payload === "object" && payload.receiptId != null
      ? String(payload.receiptId).slice(0, 160)
      : null,
  };
}

export class GoHubCounterDispatchState {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.core = createCounterDispatchCore();
  }
  async load() { return (await this.ctx.storage.get("dispatch")) || null; }
  async save(state) { await this.ctx.storage.put("dispatch", clone(state)); }
  async schedule(iso) {
    if (!iso || typeof this.ctx.storage.setAlarm !== "function") return;
    const when = Date.parse(iso);
    if (Number.isFinite(when)) await this.ctx.storage.setAlarm(when);
  }
  async deliver(target, current, hubOrigin = null) {
    let state = current;

    const destinationActor = actor(state.toActor, "LIGHT");
    if (!state.answer && target === destinationActor) {
      const result = this.core.waitingPickup({ target }, state);
      if (!result.idempotent) await this.save(result.dispatch);
      return publicState(result.dispatch, {
        targetConfigured:true,
        mode:state.mode || "SEARCH",
        transport:"COUNTER_INBOX",
        pickupRequired:true,
        triggerRequired:target === "LIGHT",
      });
    }

    const config = endpoint(this.env, target);
    if (!config.url) {
      const result = this.core.waitingTarget({ target }, state);
      state = result.dispatch;
      if (!result.idempotent) await this.save(state);
      return publicState(state, { targetConfigured:false });
    }

    const attempt = this.core.beginAttempt({ target }, state);
    state = attempt.dispatch;
    if (attempt.idempotent) return publicState(state);
    await this.save(state);

    try {
      const response = await fetch(config.url, {
        method:"POST",
        headers:{
          "content-type":"application/json",
          ...(config.bearer ? { authorization:"Bearer " + config.bearer } : {}),
        },
        body:JSON.stringify(wakePayload(state, target)),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("WAKE_HTTP_" + response.status);
      const result = this.core.delivered({ target, receipt:publicReceipt(response, body) }, state);
      await this.save(result.dispatch);
      return result;
    } catch (error) {
      const result = this.core.failed({ target, error:error?.message || "WAKE_FAILED" }, state);
      await this.save(result.dispatch);
      await this.schedule(result.dispatch.legs[target].nextAttemptAt);
      return result;
    }
  }

  async recoverDeliveredLightResult(current) {
    const state = clone(current);
    if (state?.legs?.LIGHT?.status !== "DELIVERED") return publicState(state);
    if (state.lightResult) {
      return publicState(state, { idempotent:true, lightAnswer:clone(state.lightResult) });
    }
    if ((state.mode || "SEARCH") !== "SEARCH" || state.legs.LIGHT?.receipt?.tool !== "notion-ai-search") {
      return publicState(state, { idempotent:true });
    }

    const namespace = this.env?.GO_HUB_NOTION_LIGHT_STATE;
    const notion = namespace && typeof namespace.getByName === "function"
      ? namespace.getByName("notion-light-primary")
      : null;
    if (!notion || typeof notion.fetch !== "function") {
      return publicState(state, { idempotent:true, recoveryCode:"NOTION_LIGHT_STATE_NOT_CONFIGURED" });
    }

    const response = await notion.fetch(new Request("https://notion-light.internal/search", {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({
        action:"search",
        query:state.request,
        counterId:state.counterId,
        workId:state.workId,
        checkpointId:state.checkpointId,
        context:state.context,
      }),
    }));
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      return publicState(state, {
        idempotent:true,
        recoveryCode:body?.code || "NOTION_LIGHT_RESULT_RECOVERY_FAILED",
      });
    }

    const lightAnswer = {
      status:body.status,
      answer:body.answer,
      sources:Array.isArray(body.sources) ? body.sources : [],
      evidence:Array.isArray(body.evidence) ? body.evidence : [],
      confidence:body.confidence || null,
      nextRoute:body.nextRoute || "GO",
    };
    state.revision += 1;
    state.lightResult = clone(lightAnswer);
    state.updatedAt = new Date().toISOString();
    append(state, "RESULT_RECOVERED", "LIGHT", state.updatedAt, {
      tool:body.tool || "notion-ai-search",
      resultCount:Number(body.resultCount || 0),
    });
    await this.save(state);
    return publicState(state, {
      idempotent:true,
      recovered:true,
      lightAnswer:clone(lightAnswer),
    });
  }

  async enqueueOpen(input = {}) {
    const current = await this.load();
    const result = this.core.enqueueOpen(input, current);
    if (result.created) await this.save(result.dispatch);
    const targetActor = actor(result.dispatch?.toActor, "LIGHT");
    if (result.idempotent) {
      const status = result.dispatch?.legs?.[targetActor]?.status;
      if (["WAITING_TARGET","WAITING_PICKUP","WAITING_AUTH","BLOCKED","RETRY_WAIT"].includes(status)) {
        return this.deliver(targetActor, result.dispatch, input.hubOrigin);
      }
      if (status === "DELIVERED" && targetActor === "LIGHT" && (result.dispatch?.mode || "SEARCH") === "SEARCH") {
        return this.recoverDeliveredLightResult(result.dispatch);
      }
      return result;
    }
    return this.deliver(targetActor, result.dispatch, input.hubOrigin);
  }
  async enqueueAnswer(input = {}) {
    const current = await this.load();
    const result = this.core.enqueueAnswer(input, current);
    if (!result.idempotent) await this.save(result.dispatch);
    const targetActor = actor(result.dispatch?.fromActor, "GO");
    if (result.idempotent) {
      const status = result.dispatch?.legs?.[targetActor]?.status;
      return ["WAITING_TARGET","WAITING_PICKUP","RETRY_WAIT"].includes(status)
        ? this.deliver(targetActor, result.dispatch)
        : result;
    }
    return this.deliver(targetActor, result.dispatch);
  }
  async returnInline(input = {}) {
    const current = await this.load();
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    const transport = String(input.transport || "INLINE").trim().toUpperCase();
    if (!["INLINE","COUNTER_INBOX"].includes(transport)) {
      throw Object.assign(new Error("DISPATCH_RETURN_TRANSPORT_INVALID"), { status:400 });
    }
    const receiptId = String(input.receiptId || (transport === "COUNTER_INBOX"
      ? "go-counter-inbox"
      : "factory-mcp-inline-return")).trim();

    const queued = this.core.enqueueAnswer(input, current);
    let state = queued.dispatch;
    if (!queued.idempotent) await this.save(state);

    const targetActor = actor(state.fromActor, "GO");
    if (state.legs[targetActor].status === "DELIVERED") {
      return publicState(state, {
        idempotent:true,
        inlineReturn:transport === "INLINE",
        inboxReturn:transport === "COUNTER_INBOX",
        returnTransport:transport,
      });
    }

    const attempt = this.core.beginAttempt({ target:targetActor }, state);
    state = attempt.dispatch;
    if (!attempt.idempotent) await this.save(state);

    const delivered = this.core.delivered({
      target:targetActor,
      receipt:{
        httpStatus:200,
        receiptId,
        transport,
      },
    }, state);
    await this.save(delivered.dispatch);
    return publicState(delivered.dispatch, {
      inlineReturn:transport === "INLINE",
      inboxReturn:transport === "COUNTER_INBOX",
      returnTransport:transport,
    });
  }

  async get(input = {}) {
    const current = await this.load();
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    assertIdentity(current, input);
    return publicState(current);
  }
  async retry(input = {}) {
    const current = await this.load();
    if (!current) throw Object.assign(new Error("DISPATCH_NOT_FOUND"), { status:404 });
    assertIdentity(current, input);
    const target = required(input.target, "Target").toUpperCase();
    if (!COUNTER_ACTOR_SET.has(target)) throw Object.assign(new Error("DISPATCH_TARGET_INVALID"), { status:400 });
    return this.deliver(target, current);
  }
  async alarm() {
    const state = await this.load();
    if (!state) return;
    const nowMs = Date.now();
    if (state.bell?.status === "RETRY_WAIT" &&
        (!state.bell.nextAttemptAt || Date.parse(state.bell.nextAttemptAt) <= nowMs)) {
      const latest = await this.load();
      await this.deliver(state.bell.target || latest.toActor, latest);
    }
    for (const target of ["LIGHT","GO"]) {
      const targetLeg = state.legs[target];
      if (!targetLeg || targetLeg.status !== "RETRY_WAIT") continue;
      if (targetLeg.nextAttemptAt && Date.parse(targetLeg.nextAttemptAt) > nowMs) continue;
      const latest = await this.load();
      await this.deliver(target, latest);
    }
  }
  async fetch(request) {
    try {
      if (request.method !== "POST") return json({ code:"METHOD_NOT_ALLOWED" }, 405);
      const input = await request.json().catch(() => null);
      if (!input || typeof input !== "object" || Array.isArray(input)) return json({ code:"INVALID_JSON" }, 400);
      const action = required(input.action, "Action").toLowerCase();
      const result = action === "open" ? await this.enqueueOpen(input)
        : action === "answer" ? await this.enqueueAnswer(input)
        : action === "return_inline" ? await this.returnInline(input)
        : action === "get" ? await this.get(input)
        : action === "retry" ? await this.retry(input)
        : (() => { throw Object.assign(new Error("DISPATCH_ACTION_UNSUPPORTED"), { status:400 }); })();
      return json(result);
    } catch (error) {
      return json({ code:error?.message || "DISPATCH_ERROR" }, error?.status || 400);
    }
  }
}

function stubFor(namespace, counterId) {
  if (!namespace || typeof namespace.getByName !== "function") return null;
  return namespace.getByName(counterId);
}
export function createCounterDispatchService({ namespace, hubOrigin = null } = {}) {
  async function call(action, input = {}) {
    const counterId = required(input.counterId, "Counter ID");
    const stub = stubFor(namespace, counterId);
    if (!stub || typeof stub.fetch !== "function") return json({ code:"DISPATCH_STATE_NOT_CONFIGURED" }, 503);
    return stub.fetch(new Request("https://counter-dispatch.internal/" + action, {
      method:"POST",
      headers:{ "content-type":"application/json" },
      body:JSON.stringify({ ...input, ...(hubOrigin ? { hubOrigin } : {}), action }),
    }));
  }
  return Object.freeze({
    open:input => call("open", input),
    answer:input => call("answer", input),
    returnInline:input => call("return_inline", input),
    get:input => call("get", input),
    retry:input => call("retry", input),
  });
}

export { MAX_ATTEMPTS, WAITING_TARGET_RETRY_MS, RETRY_DELAYS_MS };

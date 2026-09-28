import { createFactoryController } from "./go-hub-factory-task-controller.mjs";
import { createFactoryAutoRunner } from "./go-hub-factory-auto-runner.mjs";
import {
  enterFactoryV4,
  recordFactoryReality,
  setFactoryPreProductionInspection,
  setFactoryPlan,
  advanceFactory,
  updateCriticalCheck,
  safeStopToPlan,
  finishFactory,
  factoryBoardView,
} from "./go-hub-factory-v4.js";

const OWNER = "pureekangraw-ops";
const TASK_ID = /^pureekangraw-ops:[A-Za-z0-9._-]+$/;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function assertTaskId(value) {
  const taskId = String(value || "").trim();
  if (!TASK_ID.test(taskId) || !taskId.startsWith(`${OWNER}:`)) {
    throw Object.assign(new Error("invalid Factory task ID"), { status: 400 });
  }
  return taskId;
}

function stateStub(binding, taskId) {
  if (!binding) return null;
  if (typeof binding.getByName === "function") return binding.getByName(taskId);
  if (typeof binding.idFromName === "function" && typeof binding.get === "function") {
    return binding.get(binding.idFromName(taskId));
  }
  return null;
}

async function readStateResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload?.code || "FACTORY_STATE_ERROR"), { status: response.status });
  }
  return payload;
}

function createStatePort(binding, taskId) {
  const stub = stateStub(binding, taskId);
  if (!stub) return null;

  if (typeof stub.fetch === "function") {
    return Object.freeze({
      async load() {
        return readStateResponse(await stub.fetch(new Request("https://factory-state.internal/load", {
          method: "GET",
        })));
      },
      async save(value) {
        return readStateResponse(await stub.fetch(new Request("https://factory-state.internal/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(value),
        })));
      },
    });
  }

  if (typeof stub.load === "function" && typeof stub.save === "function") {
    return Object.freeze({
      load: () => stub.load(),
      save: value => stub.save(value),
    });
  }

  return null;
}

export function createFactoryActionService({ lifecycle, binding, now, createId } = {}) {
  if (!lifecycle) throw new Error("Factory lifecycle is required");
  if (!binding || (typeof binding.getByName !== "function" &&
      !(typeof binding.idFromName === "function" && typeof binding.get === "function"))) {
    throw Object.assign(new Error("FACTORY_STATE_NOT_CONFIGURED"), { status: 503 });
  }

  return async function factoryAction(input = {}) {
    const taskId = assertTaskId(input.taskId);
    const state = createStatePort(binding, taskId);
    if (!state) {
      throw Object.assign(new Error("FACTORY_STATE_NOT_CONFIGURED"), { status: 503 });
    }
    const controller = createFactoryController({ lifecycle, state, ...(now ? { now } : {}), ...(createId ? { createId } : {}) });
    const result = await controller.execute({
      taskId,
      action: input.action,
      input: input.input || {},
      expectedRevision: input.expectedRevision,
    });
    return json(result);
  };
}


export function createFactoryAutoService({ lifecycle, binding, now, createId, acquireLock, releaseLock } = {}) {
  if (!lifecycle) throw new Error("Factory lifecycle is required");
  return async function factoryAuto(input = {}) {
    const taskId = assertTaskId(input.taskId);
    const state = createStatePort(binding, taskId);
    if (!state) throw Object.assign(new Error("FACTORY_STATE_NOT_CONFIGURED"), { status: 503 });
    const controller = createFactoryController({ lifecycle, state, ...(now ? { now } : {}), ...(createId ? { createId } : {}) });
    const runner = createFactoryAutoRunner({
      loadTask: async () => state.load(),
      executeAction: args => controller.execute(args),
      ...(acquireLock ? { acquireLock } : {}),
      ...(releaseLock ? { releaseLock } : {}),
    });
    const result = await runner.run({
      taskId,
      inputForAction: async action => input.inputs?.[action] || {},
    });
    return json(result, result.status === "DONE" ? 200 : result.status === "BUSY" ? 409 : 202);
  };
}


function factoryV4WorkId(value) {
  const workId = String(value || "").trim();
  if (!workId) throw Object.assign(new Error("FACTORY_V4_WORK_REQUIRED"), { status:400 });
  return workId;
}

function factoryV4StatePort(binding, workId) {
  return createStatePort(binding, `v4:${factoryV4WorkId(workId)}`);
}

function factoryV4Payload(saved) {
  const task = saved?.task || null;
  return {
    ok:true,
    revision:Number(saved?.revision || 0),
    workId:task?.workId || null,
    projectId:task?.projectId || task?.factoryProjectId || null,
    stage:task?.stage || null,
    task,
    board:task ? factoryBoardView(task) : null,
  };
}

export function createFactoryV4Service({ binding } = {}) {
  if (!binding || (typeof binding.getByName !== "function" &&
      !(typeof binding.idFromName === "function" && typeof binding.get === "function"))) {
    throw Object.assign(new Error("FACTORY_STATE_NOT_CONFIGURED"), { status:503 });
  }

  return async function factoryV4(input = {}) {
    const action = String(input.action || "").trim().toLowerCase();
    const workId = factoryV4WorkId(input.workId || input.work?.workId);
    const state = factoryV4StatePort(binding, workId);
    const loaded = await state.load();

    if (action === "inspect") {
      if (!loaded) return json({ code:"FACTORY_V4_NOT_FOUND", workId }, 404);
      return json(factoryV4Payload(loaded));
    }

    let task;
    let expectedRevision;
    if (action === "start") {
      if (loaded) return json({ code:"FACTORY_V4_ALREADY_EXISTS", workId }, 409);
      if (String(input.work?.workId || "") !== workId) return json({ code:"FACTORY_V4_WORK_ID_MISMATCH" }, 409);
      task = enterFactoryV4({ work:input.work, form:input.form || {} });
      expectedRevision = 0;
    } else {
      if (!loaded?.task) return json({ code:"FACTORY_V4_NOT_FOUND", workId }, 404);
      task = loaded.task;
      expectedRevision = loaded.revision;
      if (action === "record_reality") task = recordFactoryReality(task, input.reality || {});
      else if (action === "set_inspection") task = setFactoryPreProductionInspection(task, { inspection:input.inspection || {} });
      else if (action === "set_plan") task = setFactoryPlan(task, { plan:input.plan });
      else if (action === "advance") task = advanceFactory(task, { result:input.result ?? null, evidence:input.evidence ?? null });
      else if (action === "update_check") task = updateCriticalCheck(task, { id:input.checkId, status:input.status, evidence:input.evidence ?? null });
      else if (action === "safe_stop") task = safeStopToPlan(task, { reason:input.reason, reality:input.reality ?? null });
      else if (action === "finish") task = finishFactory(task, { file:input.file ?? null, ref:input.ref ?? null, summary:input.summary ?? null });
      else return json({ code:"FACTORY_V4_ACTION_UNAVAILABLE" }, 400);
    }

    try {
      const saved = await state.save({
        expectedRevision,
        task,
        receipt:{ type:"FACTORY_V4", action, workId, projectId:task.projectId || task.factoryProjectId, stage:task.stage },
        auditEvent:{ type:"FACTORY_V4_"+action.toUpperCase(), workId, projectId:task.projectId || task.factoryProjectId, stage:task.stage },
      });
      return json(factoryV4Payload(saved));
    } catch (error) {
      return json({ code:error?.message || "FACTORY_V4_STATE_ERROR" }, error?.message === "STALE_TASK_REVISION" ? 409 : 400);
    }
  };
}

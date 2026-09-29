import { verifyAccessToken } from "./go-hub-oauth.mjs";
import { createMcpRegistry } from "./go-hub-mcp-registry.mjs";
import { createMcpHandler } from "./go-hub-mcp.mjs";
import { createLinearService } from "./go-hub-linear-service.mjs";
import { createCloudflareService } from "./go-hub-cloudflare-service.mjs";
import { createGithubLifecycleService } from "./go-hub-worker.mjs";
import { createFactoryControllerService } from "./go-hub-factory-controller.mjs";
import { createFactoryActionService, createFactoryAutoService, createFactoryV4Service } from "./go-hub-factory-service.mjs";
import { createMaintenanceService } from "./go-hub-maintenance.js";
import { createMaintenanceRealityReader } from "./go-hub-maintenance-reader.mjs";
import { createMaintenanceDurableStorage } from "./go-hub-maintenance-state.mjs";
import { createBroadcastService } from "./go-hub-broadcast-state.mjs";
import { createCentreLiveService } from "./go-hub-centre-live.mjs";
import { routeReadOnlyFastLane } from "./go-hub-city-route.js";
import { createLighthouseControlPortMcpService } from "./go-hub-lighthouse-control-port-service.mjs";
import { createGoogleDriveService } from "./go-hub-google-drive-service.mjs";
import { createGoogleWorkspaceService } from "./go-hub-google-workspace-service.mjs";
import { createWorkflowArtifactService } from "./go-hub-workflow-artifact-service.mjs";
import { createProjectStatusReadService } from "./go-hub-project-status-service.mjs";
import { createPixieCommandService } from "./go-hub-pixie-service.mjs";
import { createBoardPinRouteReadService } from "./go-hub-board-pin-route.js";
import { createGlobalAuditService } from "./go-hub-global-audit.mjs";
import { createCounterService } from "./go-hub-counter.mjs";
import { createCounterDispatchService } from "./go-hub-counter-dispatcher.mjs";
import { createNotionLightService } from "./go-hub-notion-light.mjs";
import { createAgentMissionService } from "./go-hub-agent-mission.mjs";
import { createAgentPersonaRoom } from "./go-hub-agent-persona-room.mjs";
import { sealReadyGate } from "./go-hub-ready-gate.js";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function firstEnv(env, names) {
  for (const name of names) {
    const value = env?.[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function workText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function operationDestination(operation) {
  const current = workText(operation);
  if (current.startsWith("github.") || current.startsWith("factory.") || current.startsWith("pixie.")) return "destination://factory";
  if (current.startsWith("maintenance.")) return "destination://maintenance";
  if (current.startsWith("heimdall.")) return "destination://heimdall";
  if (current.startsWith("linear.")) return "destination://linear";
  if (current.startsWith("gmail.")) return "destination://gmail";
  if (current.startsWith("calendar.")) return "destination://calendar";
  if (current.startsWith("drive.") || current.startsWith("artifact.")) return "destination://drive";
  if (current.startsWith("counter.")) return "destination://counter";
  return "destination://hub";
}

function mutationEvent({ correlationId, stage, operation, workContext, result = null } = {}) {
  return {
    eventId: "MUTATION-" + correlationId + "-" + stage,
    type: "TOOL_MUTATION_" + stage,
    workId: workText(workContext?.workId),
    checkpointId: workText(workContext?.checkpointId),
    phase: "TOOL_MUTATION",
    at: new Date().toISOString(),
    details: {
      correlationId,
      operation,
      destination: workText(workContext?.destination) || null,
      ...(result ? {
        ok: result.ok === true,
        status: Number(result.status || 0),
        code: workText(result.code) || null,
      } : {}),
    },
  };
}

async function responsePayload(response) {
  return response.clone().json().catch(() => ({}));
}

const CENTRE_INSPECT_FALLBACK_CODES = new Set([
  "unsupported Centre live action",
  "unsupported Centre V4 action",
]);

async function inspectCentreCompat(centreLive, input = {}) {
  const base = {
    workId: input.workId,
    checkpointId: input.checkpointId,
    returnAddress: input.returnAddress || input.checkpointId,
  };
  const v4 = await centreLive.action({ action: "v4_inspect", ...base });
  if (v4.ok) {
    const payload = await responsePayload(v4);
    if (payload?.v4 === true && payload?.work) {
      return json({
        ...payload,
        workId: payload.work.workId,
        checkpointId: payload.work.checkpointId,
        returnAddress: payload.work.checkpointId,
      });
    }
    return v4;
  }
  const payload = await responsePayload(v4);
  if (!CENTRE_INSPECT_FALLBACK_CODES.has(workText(payload.code))) return v4;
  return centreLive.action({ action: "inspect", ...base });
}

const CENTRE_AUDIT_PAGE_SIZE = 200;

function sequenceOf(record) {
  const sequence = Number(record?.sequence);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function auditSequence(value, fallback = 0) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : fallback;
}

async function centreAuditHistory(globalAudit, input = {}) {
  const requestedLimit = input.limit == null ? 100 : Number(input.limit);
  const initialSequence = auditSequence(input.afterSequence);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 200) {
    return json({ code: "CENTRE_AUDIT_INVALID_QUERY" }, 400);
  }

  const events = [];
  let cursor = initialSequence;
  let lastSequence = initialSequence;
  while (events.length < requestedLimit) {
    const response = await globalAudit.history({
      ...input,
      afterSequence: cursor,
      limit: CENTRE_AUDIT_PAGE_SIZE,
    });
    const payload = await responsePayload(response);
    if (!response.ok) return response;

    lastSequence = Math.max(lastSequence, auditSequence(payload.lastSequence, cursor));
    const page = Array.isArray(payload.events) ? payload.events : [];
    const centreEvents = page.filter(record => String(record?.event?.type || "").startsWith("CENTRE_"));
    for (const record of centreEvents) {
      if (events.length >= requestedLimit) break;
      events.push(record);
    }

    const pageSequence = page.reduce((highest, record) => Math.max(highest, sequenceOf(record) ?? highest), cursor);
    if (events.length >= requestedLimit || page.length === 0 || pageSequence <= cursor) break;
    cursor = pageSequence;
    if (cursor >= lastSequence) break;
  }

  const nextSequence = events.length
    ? (sequenceOf(events[events.length - 1]) ?? initialSequence)
    : lastSequence;
  return json({
    ok: true,
    workId: input.workId || null,
    afterSequence: initialSequence,
    events,
    lastSequence,
    nextSequence,
    hasMore: nextSequence < lastSequence,
    source: "CENTRE_AUDIT",
  });
}

export function createCounterDispatchLifecycle({ counter, dispatch, notionLight = null, hubOrigin = null } = {}) {
  if (!counter || !dispatch) throw new Error("Counter and dispatch services are required");

  async function parsed(response) {
    return response.clone().json().catch(() => ({}));
  }

  return Object.freeze({
    async create(input = {}) {
      const response = await counter.create(input);
      const payload = await parsed(response);
      if (!response.ok) return response;
      const state = payload.counter || {};
      const dispatchResponse = await dispatch.open({
        counterId:state.counterId,
        workId:state.workId,
        checkpointId:state.checkpointId,
        workContext:state.workContext || input.workContext || {},
        mode:state.mode || input.mode || "SEARCH",
        request:state.request,
        requestedResult:state.requestedResult || input.requestedResult || null,
        authority:state.authority || input.authority || null,
        target:state.target || input.target || null,
        projectRef:state.projectRef || input.projectRef || null,
        fromActor:state.from || input.fromActor || "GO",
        toActor:state.to || input.toActor || "LIGHT",
        context:state.context || {},
        sourceHints:state.sourceHints || [],
        doNotChange:state.doNotChange || [],
      });
      let dispatchPayload = await parsed(dispatchResponse);
      let dispatchCode = dispatchResponse.ok ? null : (dispatchPayload.code || "DISPATCH_FAILED");

      const dispatchMode = String(state.mode || input.mode || "SEARCH").toUpperCase();
      const lightState = dispatchPayload.dispatch?.legs?.LIGHT?.status || null;
      const waitingForLightAuth =
        dispatchMode === "SEARCH" &&
        (dispatchPayload.authRequired === true || lightState === "WAITING_AUTH");
      if (waitingForLightAuth && !dispatchPayload.authorizationUrl && notionLight && typeof notionLight.prepare === "function" && hubOrigin) {
        const prepareResponse = await notionLight.prepare({ hubOrigin });
        const prepared = await parsed(prepareResponse);
        if (prepareResponse.ok && prepared?.authorizationUrl) {
          dispatchPayload = {
            ...dispatchPayload,
            authRequired:true,
            authorizationUrl:prepared.authorizationUrl,
          };
        } else {
          dispatchPayload = {
            ...dispatchPayload,
            authRequired:true,
            authPrepareCode:prepared?.code || "NOTION_LIGHT_OAUTH_PREPARE_FAILED",
            authPrepareStatus:prepareResponse.status,
          };
        }
      }

      let finalPayload = payload;
      const mode = dispatchMode;
      const lightAnswer = dispatchPayload.lightAnswer || dispatchPayload.dispatch?.lightResult || null;
      if (lightAnswer && mode === "SEARCH") {
        const identity = {
          counterId:state.counterId,
          workContext:{
            workId:state.workId,
            checkpointId:state.checkpointId,
          },
        };
        const seenResponse = await counter.seen(identity);
        if (!seenResponse.ok) return seenResponse;
        const answerResponse = await counter.answer({
          ...identity,
          ...lightAnswer,
        });
        if (!answerResponse.ok) return answerResponse;
        const answerPayload = await parsed(answerResponse);
        finalPayload = {
          ...payload,
          counter:answerPayload.counter,
          lightResult:lightAnswer,
        };

        if (typeof dispatch.returnInline === "function") {
          const inlineResponse = await dispatch.returnInline({
            counterId:state.counterId,
            workId:state.workId,
            checkpointId:state.checkpointId,
            status:answerPayload.counter?.currentState || lightAnswer.status,
            answer:answerPayload.counter?.answer || lightAnswer.answer,
            sources:answerPayload.counter?.sources || lightAnswer.sources || [],
            evidence:answerPayload.counter?.evidence || lightAnswer.evidence || [],
            confidence:answerPayload.counter?.confidence || lightAnswer.confidence,
            nextRoute:answerPayload.counter?.nextRoute || lightAnswer.nextRoute || "GO",
          });
          const inlinePayload = await parsed(inlineResponse);
          if (inlineResponse.ok) {
            dispatchPayload = inlinePayload;
            dispatchCode = null;
          } else {
            dispatchCode = inlinePayload.code || "DISPATCH_INLINE_RETURN_FAILED";
          }
        }
      }

      return json({
        ...finalPayload,
        dispatch:dispatchPayload.dispatch || null,
        dispatchCode,
        lightAuthorizationUrl:dispatchPayload.authorizationUrl || null,
        lightAuthRequired:dispatchPayload.authRequired === true,
        lightAuthPrepareCode:dispatchPayload.authPrepareCode || null,
        lightAuthPrepareStatus:Number.isInteger(dispatchPayload.authPrepareStatus) ? dispatchPayload.authPrepareStatus : null,
        lightNotionStatus:dispatchPayload.notionStatus || null,
        lightCapabilityBlocked:dispatchPayload.capabilityBlocked === true,
        lightCapabilityStatus:dispatchPayload.capabilityStatus || null,
        lightUpgradeUrl:dispatchPayload.upgradeUrl || null,
      }, response.status);
    },

    async inbox(input = {}) {
      return counter.inbox(input);
    },

    async get(input = {}) {
      const response = await counter.get(input);
      const payload = await parsed(response);
      if (!response.ok) return response;
      const state = payload.counter || {};
      const dispatchResponse = await dispatch.get({
        counterId:state.counterId,
        workId:state.workId,
        checkpointId:state.checkpointId,
      });
      const dispatchPayload = await parsed(dispatchResponse);
      return json({
        ...payload,
        dispatch:dispatchPayload.dispatch || null,
        dispatchCode:dispatchResponse.ok ? null : (dispatchPayload.code || "DISPATCH_UNAVAILABLE"),
      }, response.status);
    },

    async answer(input = {}) {
      const response = await counter.answer(input);
      const payload = await parsed(response);
      if (!response.ok) return response;
      const state = payload.counter || {};
      const dispatchInput = {
        counterId:state.counterId,
        workId:state.workId,
        checkpointId:state.checkpointId,
        status:state.currentState,
        answer:state.answer,
        sources:state.sources || [],
        evidence:state.evidence || [],
        confidence:state.confidence,
        nextRoute:state.nextRoute,
      };
      const handoff = String(state.mode || "").trim().toUpperCase() === "HANDOFF";
      const dispatchResponse = handoff && typeof dispatch.returnInline === "function"
        ? await dispatch.returnInline({
            ...dispatchInput,
            transport:"COUNTER_INBOX",
            receiptId:"go-counter-inbox",
          })
        : await dispatch.answer(dispatchInput);
      const dispatchPayload = await parsed(dispatchResponse);
      return json({
        ...payload,
        dispatch:dispatchPayload.dispatch || null,
        dispatchCode:dispatchResponse.ok ? null : (dispatchPayload.code || "DISPATCH_FAILED"),
      }, response.status);
    },
  });
}

export function createGovernedMutationRunner({ centreLive, globalAudit } = {}) {
  if (!centreLive || typeof centreLive.action !== "function") throw new Error("Centre live service is required");
  if (!globalAudit || typeof globalAudit.append !== "function") throw new Error("Global audit service is required");

  return async function runGovernedMutation(operation, input = {}, execute) {
    if (typeof execute !== "function") return json({ code: "MUTATION_EXECUTOR_REQUIRED" }, 500);
    const workContext = input?.workContext;
    if (!workContext || typeof workContext !== "object") return json({ code: "WORK_CONTEXT_REQUIRED" }, 400);
    if (!workText(workContext.workId) || !workText(workContext.checkpointId)) {
      return json({ code: "WORK_IDENTITY_REQUIRED" }, 400);
    }

    // Actor/tool authority is resolved by the actor-specific MCP registry before this
    // governed runner is reached. Centre Work enriches execution context; a missing
    // Work record must not revoke authority that the registry has already granted.
    const inspected = await inspectCentreCompat(centreLive, workContext);
    const centre = await responsePayload(inspected);
    const centreCode = workText(centre?.code);
    const workNotFound = !inspected.ok && centreCode === "CENTRE_WORK_NOT_FOUND";
    if (!inspected.ok && !workNotFound) {
      return json({ code: centre.code || "CENTRE_WORK_UNAVAILABLE" }, inspected.status || 502);
    }
    if (!workNotFound && String(centre.checkpointId || "") !== String(workContext.checkpointId || "")) {
      return json({ code: "CENTRE_CHECKPOINT_MISMATCH" }, 409);
    }

    const ownership = workNotFound ? {} : (centre.ownership || {});
    if (ownership.enforced === true && ownership.active !== true) {
      return json({ code: "CENTRE_WORK_LEASE_INACTIVE" }, 409);
    }

    const centreWork = !workNotFound && centre.work && typeof centre.work === "object" ? centre.work : {};
    const maintenanceMutation = workText(centreWork.workType).toUpperCase() === "MAINTENANCE" && !String(operation || "").startsWith("heimdall.pass.");
    if (maintenanceMutation) {
      const pass = centreWork.pass && typeof centreWork.pass === "object" ? centreWork.pass : {};
      const repairScope = Array.isArray(pass.audit?.repairScope) ? pass.audit.repairScope.map(workText).filter(Boolean) : [workText(pass.audit?.repairScope)].filter(Boolean);
      if (workText(pass.state).toUpperCase() !== "ACTIVE" || workText(pass.kind).toUpperCase() !== "MAINTENANCE") {
        return json({ code:"MAINTENANCE_REPAIR_PASS_REQUIRED" }, 409);
      }
      if (workText(pass.audit?.ownerApproval || pass.audit?.approval).toUpperCase() !== "BIG_APPROVED" || !repairScope.length) {
        return json({ code:"MAINTENANCE_REPAIR_APPROVAL_REQUIRED", requires:["BIG_APPROVED","repairScope"] }, 409);
      }
    }
    const resolvedWorkContext = {
      workId:workText(centre.workId) || workText(centreWork.workId) || workText(workContext.workId),
      checkpointId:workText(centre.checkpointId) || workText(centreWork.checkpointId) || workText(workContext.checkpointId),
      returnAddress:workText(centre.returnAddress) || workText(centre.checkpointId) || workText(workContext.checkpointId),
      destination:operationDestination(operation),
      task:workText(centreWork.task) || workText(workContext.task) || operation,
      requestedResult:workText(centreWork.requestedResult) || workText(workContext.requestedResult) || operation,
      lensReference:workText(workContext.lensReference) || "GO_HUB_RESOLVED",
      ...(ownership.enforced === true ? {
        ownerId:workText(ownership.ownerId),
        leaseId:workText(ownership.leaseId),
        ownershipRevision:Number(ownership.revision),
      } : {}),
    };
    input.workContext = resolvedWorkContext;

    const correlationId = crypto.randomUUID();
    const intent = await globalAudit.append(mutationEvent({
      correlationId, stage: "INTENT", operation, workContext:resolvedWorkContext,
    }));
    const intentPayload = await responsePayload(intent);
    if (!intent.ok) {
      return json({
        code: "GLOBAL_AUDIT_INTENT_REQUIRED",
        auditCode: intentPayload.code || null,
      }, 502);
    }

    let result;
    try {
      result = await execute(input);
    } catch {
      result = json({ code: "MUTATION_EXECUTION_ERROR" }, 502);
    }
    const payload = await responsePayload(result);
    const outcome = { ok:result.ok, status:result.status, code:payload?.code || null };
    const recorded = await globalAudit.append(mutationEvent({
      correlationId, stage: "RESULT", operation, workContext:resolvedWorkContext, result:outcome,
    }));
    const auditPayload = await responsePayload(recorded);
    if (!recorded.ok) {
      return json({
        code:"GLOBAL_AUDIT_RECONCILIATION_REQUIRED",
        operation,
        mutationObserved:true,
        upstreamStatus:result.status,
        upstreamCode:payload?.code || null,
        auditCode:auditPayload.code || null,
        correlationId,
      }, 502);
    }
    return result;
  };
}

function observerStatus(code) {
  if (code === "SCHEMA_REJECTED") return 400;
  if (code === "SESSION_EXPIRED") return 410;
  if (code === "STALE_PAGE") return 409;
  if (code === "HUB_UNAVAILABLE") return 503;
  return 403;
}

export function createObserverEvidenceService({ namespace } = {}) {
  function stub() {
    if (!namespace || typeof namespace.getByName !== "function") return null;
    return namespace.getByName("go-browser-observer-v1");
  }
  async function call(method, input = {}) {
    const current = stub();
    if (!current) return { ok:false, code:"HUB_UNAVAILABLE" };
    try {
      if (typeof current.fetch === "function") {
        const path = method === "latest" ? "latest" : "screenshot";
        const response = await current.fetch(new Request("https://observer-session.internal/" + path, {
          method:"POST",
          headers:{ "content-type":"application/json" },
          body:JSON.stringify(input),
        }));
        const body = await response.json().catch(() => ({ code:"HUB_UNAVAILABLE" }));
        return response.ok ? body : { ok:false, code:body?.code || "HUB_UNAVAILABLE" };
      }
      if (typeof current[method] === "function") return await current[method](input);
      return { ok:false, code:"HUB_UNAVAILABLE" };
    } catch {
      return { ok:false, code:"HUB_UNAVAILABLE" };
    }
  }
  return Object.freeze({
    async latest() {
      const result = await call("latest");
      if (!result?.ok) return json({ code: result?.code || "HUB_UNAVAILABLE" }, observerStatus(result?.code));
      return json(result, 200);
    },
    async screenshot({ screenshotRef } = {}) {
      const ref = String(screenshotRef || "").trim();
      if (!ref) return json({ code: "SCHEMA_REJECTED" }, 400);
      const result = await call("screenshot", { screenshotRef: ref });
      if (!result?.ok) return json({ code: result?.code || "HUB_UNAVAILABLE" }, observerStatus(result?.code));
      return json(result, 200);
    },
  });
}

export function createFactoryGuardedLifecycle({ lifecycle, factory } = {}) {
  if (!lifecycle) throw new Error("GitHub lifecycle service is required");
  if (!factory) throw new Error("Factory controller service is required");

  return Object.freeze({
    ...lifecycle,
    factoryForeman(input = {}) {
      return factory.foreman(input);
    },
    factoryReadyGate(input = {}) {
      try {
        const readyGate = sealReadyGate(input);
        return json({ ok: true, readyGate });
      } catch (error) {
        return json({ code: "READY_GATE_REJECTED", message: error?.message || "Ready Gate rejected" }, 409);
      }
    },
    async cancelStaleFactoryWork(input = {}) {
      const observed = await lifecycle.getPullRequest({
        repository: input.repository,
        number: input.number,
      });
      if (!observed.ok) return observed;
      const proof = await observed.clone().json().catch(() => null);
      if (!proof || String(proof.state || "").toLowerCase() !== "closed" || proof.merged !== false ||
          Number(proof.number) !== Number(input.number) || !String(proof.headSha || "").trim()) {
        return json({ code: "FACTORY_STALE_WORK_CANCELLATION_REFUSED" }, 409);
      }
      return factory.foreman({
        action: "cancel",
        repository: input.repository,
        slot: "merge",
        goId: input.goId,
        jobId: input.jobId,
        cancellation: {
          reason: "PULL_REQUEST_CLOSED_UNMERGED",
          observedAt: new Date().toISOString(),
          pullRequest: {
            number: Number(proof.number),
            state: String(proof.state),
            merged: false,
            headSha: String(proof.headSha),
          },
        },
        workContext: input.workContext,
      });
    },
    async mergePullRequest(input = {}) {
      const ownership = await factory.assertActiveMerge(input);
      if (!ownership.ok) return ownership;
      const proof = await ownership.json().catch(() => ({ active: false }));
      if (proof.active !== true) return json({ code: "FACTORY_MERGE_SLOT_REQUIRED" }, 409);

      const merged = await lifecycle.mergePullRequest(input);
      if (!merged.ok) return merged;
      const mergeProof = await merged.clone().json().catch(() => null);
      const mergedHeadSha = String(mergeProof?.headSha || input.expectedHeadSha || "").trim();
      if (mergeProof?.merged !== true || !String(mergeProof.mergeSha || "").trim() || !mergedHeadSha) {
        return json({ code: "MERGE_RESULT_MISSING_EVIDENCE" }, 500);
      }
      if (typeof factory.recordMergeResult !== "function") {
        return json({ code: "FACTORY_MERGE_RESULT_NOT_RECORDED" }, 502);
      }
      const recorded = await factory.recordMergeResult({
        repository: input.repository,
        goId: input.goId,
        jobId: input.jobId,
        workContext: input.workContext,
        pullRequestNumber: Number(input.number),
        headSha: mergedHeadSha,
        mergeSha: String(mergeProof.mergeSha),
      });
      if (!recorded.ok) {
        const detail = await recorded.json().catch(() => ({}));
        return json({
          code: "FACTORY_MERGE_RESULT_NOT_RECORDED",
          merged: true,
          mergeSha: mergeProof.mergeSha,
          headSha: mergedHeadSha,
          factoryCode: detail.code || "FACTORY_RECORD_MERGE_FAILED",
        }, 502);
      }

      const parked = await factory.foreman({
        action: "park",
        repository: input.repository,
        goId: input.goId,
        jobId: input.jobId,
        mainSha: mergeProof.mergeSha,
        mergedAt: new Date().toISOString(),
        workContext: input.workContext,
      });
      const parkProof = await parked.clone().json().catch(() => null);
      if (!parked.ok || parkProof?.outcome?.status !== "PARKED_FOR_VERIFICATION") {
        return json({
          code: "MERGED_BUT_WAITING_ROOM_FAILED",
          merged: true,
          mergeSha: mergeProof.mergeSha,
          waitingRoom: parkProof || null,
        }, 500);
      }
      return merged;
    },
  });
}

export function createFactoryMcpWorker({ fetchImpl = fetch } = {}) {
  return Object.freeze({
    async fetch(request, env) {
      const url = new URL(request.url);
      const legacyLightAlias = url.pathname === "/mcp/light";
      if (url.pathname !== "/mcp" && !legacyLightAlias) return json({ code: "NOT_FOUND" }, 404);
      if (!env?.GITHUB_TOKEN) return json({ code: "GITHUB_NOT_CONFIGURED" }, 503);

      // GO's existing /mcp is the single canonical entry/resource.
      // /mcp/light is transport-only legacy compatibility and never defines actor identity.
      const resource = url.origin + "/mcp";
      const accessConfig = {
        issuer: url.origin,
        signingKey: env?.GOHUB_MASTER_KEY,
        clientId: "go-hub-go",
        acceptedClientIds: ["go-hub-go", "go-hub-light", "go-hub-chatgpt", "go-hub-notion"],
        resource,
        requireClientId: true,
        allowLegacyClientId: true,
        acceptedIdentities: [
          { subject: "GO", scope: "go-hub" },
          { subject: "big", scope: "go-hub" },
          { subject: "LIGHT", scope: "go-hub-light" },
          { subject: "light", scope: "go-hub-light" },
          { subject: "notion", scope: "go-hub" },
        ],
        subject: "GO",
        scope: "go-hub",
      };
      let authenticatedActor = null;
      const github = createGithubLifecycleService({ fetchImpl, token: env.GITHUB_TOKEN });
      const lifecycle = github;
      const factoryV4 = env?.GO_HUB_FACTORY_STATE
        ? createFactoryV4Service({ binding: env.GO_HUB_FACTORY_STATE })
        : async () => json({ code: "FACTORY_STATE_NOT_CONFIGURED" }, 503);
      const heimdallPass = async (input = {}) => centreLive.action({
        action: input.action === "open" ? "v4_open_pass" : "v4_return",
        workId: input.workId, checkpointId: input.checkpointId, actor: input.actor || input.holder,
        holder: input.holder, kind: input.kind, scope: input.scope, destinations: input.destinations,
        expiresAt: input.expiresAt, closeCondition: input.closeCondition, returnAddress: input.returnAddress,
        reason: input.reason, audit: input.audit, status: input.status, result: input.result, evidence: input.evidence,
      });
      const v4ProjectBoard = input => centreLive.action({
        action: "v4_board", workId: input.workId, checkpointId: input.checkpointId, returnAddress: input.checkpointId,
      });
      const linear = createLinearService({
        fetchImpl,
        token: env?.LINEAR_API_KEY || env?.["linear-API"],
        teamId: env?.LINEAR_TEAM_ID,
        teamKey: env?.LINEAR_TEAM_KEY,
      });
      const cloudflare = createCloudflareService({
        fetchImpl,
        token: env?.CLOUDFLARE_RUNTIME_API_TOKEN,
        accountId: env?.CLOUDFLARE_ACCOUNT_ID,
      });
      const observer = createObserverEvidenceService({ namespace: env?.OBSERVER_SESSIONS });
      const centreLive = createCentreLiveService({ namespace: env?.GO_HUB_CENTRE_STATE });
      const broadcast = createBroadcastService({ namespace: env?.GO_HUB_BROADCAST_STATE });
      const globalAudit = createGlobalAuditService({ namespace: env?.GO_HUB_GLOBAL_AUDIT });
      const counter = createCounterService({ namespace: env?.GO_HUB_COUNTER_STATE, inboxNamespace: env?.GO_HUB_COUNTER_INBOX });
      const dispatch = createCounterDispatchService({
        namespace: env?.GO_HUB_COUNTER_DISPATCH_STATE,
        hubOrigin: url.origin,
      });
      const notionLight = createNotionLightService({ namespace:env?.GO_HUB_NOTION_LIGHT_STATE });
      const counterDispatch = createCounterDispatchLifecycle({ counter, dispatch, notionLight, hubOrigin:url.origin });
      const lighthouseControlPort = createLighthouseControlPortMcpService({ namespace:env?.LIGHTHOUSE_CONTROL_PORT_SESSIONS });
      const agentMission = createAgentMissionService({ centreLive, counterDispatch, boardRead:() => lighthouseControlPort.boardRead() });
      const projectStatus = createProjectStatusReadService({ lifecycle, factoryBinding:env?.GO_HUB_FACTORY_STATE });
      const boardPinRoute = createBoardPinRouteReadService();
      const pixie = createPixieCommandService({ fetchImpl, token:env.GITHUB_TOKEN });
      const pixieCommand = async input => {
        const response = await runMutation("pixie.command", input, () => pixie.command(input));
        if (response.ok && env?.GO_HUB_PIXIE_MONITOR_STATE?.getByName) {
          const body = await response.clone().json().catch(() => null);
          if (body?.status === "QUEUED" && body?.requestId) {
            const stub = env.GO_HUB_PIXIE_MONITOR_STATE.getByName("go-hub-pixie-monitor");
            await stub.fetch(new Request("https://pixie-monitor.internal/watch", { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ requestId:body.requestId, workContext:input.workContext || null }) }));
          }
        }
        return response;
      };
      const pixieResult = async input => {
        const response = await pixie.result(input);
        return response;
      };
      const drive = createGoogleDriveService({
        fetchImpl,
        accessToken: firstEnv(env, ["GOOGLE_DRIVE_ACCESS_TOKEN", "DRIVE_ACCESS_TOKEN", "GDRIVE_ACCESS_TOKEN", "GOOGLE_ACCESS_TOKEN", "GOOGLE_OAUTH_ACCESS_TOKEN", "GDRIVE_OAUTH_ACCESS_TOKEN"]),
        refreshToken: firstEnv(env, ["GOOGLE_DRIVE_REFRESH_TOKEN", "DRIVE_REFRESH_TOKEN", "GDRIVE_REFRESH_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN", "GDRIVE_OAUTH_REFRESH_TOKEN"]),
        clientId: firstEnv(env, ["GOOGLE_DRIVE_CLIENT_ID", "DRIVE_CLIENT_ID", "GDRIVE_CLIENT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GDRIVE_OAUTH_CLIENT_ID"]),
        clientSecret: firstEnv(env, ["GOOGLE_DRIVE_CLIENT_SECRET", "DRIVE_CLIENT_SECRET", "GDRIVE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GDRIVE_OAUTH_CLIENT_SECRET"]),
        rootFolderId: firstEnv(env, ["GOOGLE_DRIVE_ROOT_FOLDER_ID", "DRIVE_ROOT_FOLDER_ID", "GDRIVE_ROOT_FOLDER_ID", "GOOGLE_DRIVE_FOLDER_ID", "DRIVE_FOLDER_ID", "GDRIVE_FOLDER_ID", "GOOGLE_ROOT_FOLDER_ID"]),
      });
      const googleWorkspace = createGoogleWorkspaceService({
        fetchImpl,
        accessToken: firstEnv(env, ["GOOGLE_WORKSPACE_ACCESS_TOKEN", "GOOGLE_ACCESS_TOKEN", "GOOGLE_OAUTH_ACCESS_TOKEN"]),
        refreshToken: firstEnv(env, ["GOOGLE_WORKSPACE_REFRESH_TOKEN", "GOOGLE_REFRESH_TOKEN", "GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN"]),
        clientId: firstEnv(env, ["GOOGLE_WORKSPACE_CLIENT_ID", "GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_ID"]),
        clientSecret: firstEnv(env, ["GOOGLE_WORKSPACE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_DRIVE_CLIENT_SECRET"]),
        driveService: drive,
      });
      let registry = null;
      const maintenance = createMaintenanceService({
        storage:createMaintenanceDurableStorage({ namespace:env?.GO_HUB_MAINTENANCE_STATE }),
        readValue:createMaintenanceRealityReader({
          env,
          lifecycle,
          registryRef:() => registry,
          googleWorkspace,
          drive,
          linear,
          observer,
          lighthouseControlPort,
          projectStatus,
          boardRead:() => lighthouseControlPort.boardRead(),
          globalAudit,
          broadcast,
        }),
      });
      const artifactDelivery = createWorkflowArtifactService({ fetchImpl, token: env.GITHUB_TOKEN, drive });
      const runMutation = (env?.GO_HUB_CENTRE_STATE && env?.GO_HUB_GLOBAL_AUDIT)
        ? createGovernedMutationRunner({ centreLive, globalAudit })
        : async (_operation, _input, execute) => execute();
      const runOperationalMutation = runMutation;

      const pixieGoWorksAction = async input => {
        const workId = workText(input?.workContext?.workId);
        const checkpointId = workText(input?.workContext?.checkpointId);
        if (!workId || !checkpointId) return json({ code:"WORK_IDENTITY_REQUIRED" }, 400);

        const action = workText(input?.action).toLowerCase();
        const allowedActions = ["start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish"];
        if (!allowedActions.includes(action)) return json({ code:"PIXIE_GO_WORKS_ACTION_NOT_ALLOWED" }, 400);

        const inspected = await centreLive.action({ action:"v4_inspect", workId });
        if (!inspected.ok) return inspected;
        const centre = await responsePayload(inspected);
        const work = centre?.work;
        if (!work || work.workId !== workId || work.checkpointId !== checkpointId) {
          return json({ code:"PIXIE_GO_WORKS_CENTRE_IDENTITY_MISMATCH" }, 409);
        }
        if (action !== "inspect" && work.status !== "ON PROCESS") {
          return json({ code:"PIXIE_GO_WORKS_ACTIVE_WORK_REQUIRED" }, 409);
        }

        const factoryInput = input?.factoryInput && typeof input.factoryInput === "object" && !Array.isArray(input.factoryInput)
          ? input.factoryInput
          : {};
        const baseHandoff = factoryInput?.form?.pixieHandoff && typeof factoryInput.form.pixieHandoff === "object"
          ? factoryInput.form.pixieHandoff
          : (input?.pixieHandoff && typeof input.pixieHandoff === "object" ? input.pixieHandoff : {});
        const routed = {
          ...factoryInput,
          action,
          workId,
          workContext:{ workId, checkpointId },
          pixieLab:{ direct:true, source:"PIXIE_LAB" },
        };
        if (action === "start") {
          routed.work = work;
          routed.form = {
            ...(factoryInput.form || {}),
            pixieHandoff:{
              ...baseHandoff,
              source:"PIXIE_LAB",
              station:workText(baseHandoff.station || input?.station) || "LAB_EXIT",
              workId,
              checkpointId,
            },
          };
        }

        return runMutation("pixie.go_works." + action, routed, async resolvedInput => {
          const rechecked = await centreLive.action({ action:"v4_inspect", workId });
          if (!rechecked.ok) return rechecked;
          const latest = await responsePayload(rechecked);
          const latestWork = latest?.work;
          if (!latestWork || latestWork.workId !== workId || latestWork.checkpointId !== checkpointId) {
            return json({ code:"PIXIE_GO_WORKS_CENTRE_IDENTITY_MISMATCH" }, 409);
          }
          if (action !== "inspect" && latestWork.status !== "ON PROCESS") {
            return json({ code:"PIXIE_GO_WORKS_ACTIVE_WORK_REQUIRED" }, 409);
          }
          const effectiveInput = resolvedInput && typeof resolvedInput === "object" ? resolvedInput : routed;
          if (action === "start") effectiveInput.work = latestWork;
          return factoryV4(effectiveInput);
        });
      };
      const registryLifecycle = Object.freeze({
          ...lifecycle,
          broadcastRead: () => broadcast.current(),
          broadcastActivate: input => broadcast.activate(input),
          createBranch: input => runMutation("github.create_branch", input, () => lifecycle.createBranch(input)),
          putFile: input => runMutation("github.put_file", input, () => lifecycle.putFile(input)),
          deleteFile: input => runMutation("github.delete_file", input, () => lifecycle.deleteFile(input)),
          openPullRequest: input => runMutation("github.open_pull_request", input, () => lifecycle.openPullRequest(input)),
          rerunFailed: input => runMutation("github.rerun_failed", input, () => lifecycle.rerunFailed(input)),
          mergePullRequest: input => runMutation("github.merge_pull_request", input, () => lifecycle.mergePullRequest(input)),
          factoryV4: async input => {
            const routed = { ...input, workId:input?.workContext?.workId };
            if (input.action === "inspect") return factoryV4(routed);
            return runMutation("factory.v4." + String(input.action || "unknown"), routed, async resolvedInput => {
              if (String(resolvedInput?.action || "").trim().toLowerCase() === "start") {
                const inspected = await inspectCentreCompat(centreLive, resolvedInput.workContext);
                const centre = await responsePayload(inspected);
                if (!inspected.ok) return inspected;
                if (!centre?.work || String(centre.work.workId || "") !== String(resolvedInput.workId || "") ||
                    String(centre.work.checkpointId || "") !== String(resolvedInput.workContext?.checkpointId || "")) {
                  return json({ code:"FACTORY_V4_CENTRE_IDENTITY_MISMATCH" }, 409);
                }
                resolvedInput.work = centre.work;
              }
              return factoryV4(resolvedInput);
            });
          },
          maintenance: async input => {
            const workId = String(input?.workContext?.workId || "").trim();
            const checkpointId = String(input?.workContext?.checkpointId || "").trim();
            if (!workId || !checkpointId) return json({ code:"MAINTENANCE_V4_WORK_REQUIRED" }, 409);
            const inspected = await centreLive.action({ action:"v4_inspect", workId });
            if (!inspected.ok) return inspected;
            const reality = await responsePayload(inspected);
            if (reality?.v4 !== true || reality?.work?.workId !== workId || reality.work.checkpointId !== checkpointId) {
              return json({ code:"MAINTENANCE_CENTRE_IDENTITY_MISMATCH" }, 409);
            }
            return maintenance.maintenance({ ...input, checkpointId:input.mapCheckpointId || null, work:reality.work });
          },
          heimdallPass: input => {
            const routed = {
              ...input,
              workId:input?.workContext?.workId,
              checkpointId:input?.workContext?.checkpointId,
              returnAddress:input?.workContext?.checkpointId,
              actor:authenticatedActor,
              holder:authenticatedActor,
            };
            return runMutation("heimdall.pass." + String(input.action || "unknown"), routed, () => heimdallPass(routed));
          },
          v4ProjectBoard: input => v4ProjectBoard(input),
          agentPersonaRoom: input => createAgentPersonaRoom().action(input),
          agentMission: input => agentMission.action(input),
          lightCentreV4Action: async input => {
            if (authenticatedActor !== "LIGHT" || !["v4_inspect", "v4_claim", "v4_wait", "v4_resume", "v4_open_pass"].includes(input?.action)) {
              return json({ code:"LIGHT_CENTRE_ACTION_NOT_ALLOWED" }, 403);
            }
            const routed = {
              action:input.action,
              workId:input.workId,
              checkpointId:input.checkpointId,
              returnAddress:input.checkpointId,
              actor:authenticatedActor,
              ...(input.reason ? { reason:input.reason } : {}),
              ...(input.resumeFrom ? { resumeFrom:input.resumeFrom } : {}),
            };
            if (input.action === "v4_wait" || input.action === "v4_open_pass") {
              const inspected = await centreLive.action({ action:"v4_inspect", workId:input.workId });
              if (!inspected.ok) return inspected;
              const view = await responsePayload(inspected);
              if (view?.work?.checkpointId !== input.checkpointId || view?.work?.holder !== "LIGHT") {
                return json({ code:"LIGHT_CENTRE_HOLDER_REQUIRED" }, 403);
              }
              if (input.action === "v4_open_pass") {
                if (view?.work?.status !== "ON PROCESS") return json({ code:"LIGHT_CENTRE_ACTIVE_WORK_REQUIRED" }, 409);
                routed.kind = "WORK";
                routed.destinations = ["factory"];
                routed.scope = ["factory"];
                routed.closeCondition = "RETURN";
              }
            }
            return centreLive.action(routed);
          },
          lightFactoryV4Action: async input => {
            if (authenticatedActor !== "LIGHT") return json({ code:"LIGHT_FACTORY_ACTION_NOT_ALLOWED" }, 403);
            const action = String(input?.action || "").trim().toLowerCase();
            if (!["start", "inspect", "record_reality", "set_inspection", "set_plan", "advance", "update_check", "safe_stop", "finish"].includes(action)) {
              return json({ code:"LIGHT_FACTORY_ACTION_NOT_ALLOWED" }, 403);
            }
            const workId = String(input?.workContext?.workId || "").trim();
            const checkpointId = String(input?.workContext?.checkpointId || "").trim();
            if (!workId || !checkpointId) return json({ code:"WORK_IDENTITY_REQUIRED" }, 400);
            const inspected = await centreLive.action({ action:"v4_inspect", workId });
            if (!inspected.ok) return inspected;
            const centre = await responsePayload(inspected);
            const work = centre?.work;
            if (!work || work.checkpointId !== checkpointId || work.holder !== "LIGHT") {
              return json({ code:"LIGHT_FACTORY_HOLDER_REQUIRED" }, 403);
            }
            if (action !== "inspect") {
              const allowed = Array.isArray(work?.pass?.allowedDestinations) ? work.pass.allowedDestinations : [];
              if (work.status !== "ON PROCESS" || work.pass?.state !== "ACTIVE" ||
                  (!allowed.includes("factory") && !allowed.includes("destination://factory"))) {
                return json({ code:"LIGHT_FACTORY_PASS_REQUIRED" }, 403);
              }
            }
            const routed = { ...input, action, workId };
            if (action === "inspect") return factoryV4(routed);
            return runMutation("factory.v4.light." + action, routed, async resolvedInput => {
              if (action === "start") resolvedInput.work = work;
              return factoryV4(resolvedInput);
            });
          },
          observerLatest: () => observer.latest(),
          observerScreenshot: input => observer.screenshot(input),
          auditHistory: input => globalAudit.history(input),
          centreInspect: input => inspectCentreCompat(centreLive, input),
          centreAuditHistory: input => centreAuditHistory(globalAudit, input),
          centreLiveAction: async input => {
            const response = await centreLive.action(input);
            if (response.ok) {
              const view = await response.clone().json().catch(() => null);
              if (view?.ok) {
                const projectionView = view?.v4 === true && view?.work?.workId
                  ? {
                      ...view,
                      routingWorkId:String(input?.workId || "").trim() || null,
                      canonicalWorkId:String(view.work.workId || "").trim() || null,
                    }
                  : view;
                try { await lighthouseControlPort.projectCentre(projectionView); } catch {}
              }
            }
            return response;
          },
          centreReadOnlyFastLane: input => json(routeReadOnlyFastLane(input)),
          lighthouseControlPortState: input => lighthouseControlPort.state(input),
          lighthouseControlPortCommand: input => lighthouseControlPort.command(input),
          projectStatus: async input => json(await projectStatus.read(input)),
          boardRead: () => lighthouseControlPort.boardRead(),
          boardPinRoute: input => json(boardPinRoute.read(input)),
          pixieCommand,
          pixieGoWorksAction: input => pixieGoWorksAction(input),
          // Backward-compatible alias for clients that still know the old ROOM-D tool name.
          // It now uses the same direct PIXIE LAB → GO WORKS Work-continuity path and no local Pass/room restriction.
          pixieDebugFactoryAction: input => pixieGoWorksAction(input),
          pixieResult,
          counterCreate: input => {
            const fromActor = authenticatedActor;
            const toActor = authenticatedActor === "LIGHT" ? "GO" : "LIGHT";
            const mode = String(input?.mode || "SEARCH").trim().toUpperCase();
            const routed = { ...input, fromActor, toActor };
            return runMutation("counter.create." + fromActor.toLowerCase(), routed, () => counterDispatch.create(routed));
          },
          counterInbox: input => counter.inbox({ ...input, actor:authenticatedActor }),
          counterGet: input => counterDispatch.get(input),
          counterSeen: input => {
            const actor = authenticatedActor;
            const routed = { ...input, actor };
            return runMutation("counter.seen." + actor.toLowerCase(), routed, () => counter.seen(routed));
          },
          counterPickup: input => {
            const actor = authenticatedActor;
            const routed = { ...input, actor };
            return runMutation("counter.pickup." + actor.toLowerCase(), routed, () => counter.seen(routed));
          },
          counterAnswer: input => {
            const actor = authenticatedActor;
            const routed = { ...input, actor };
            return runMutation("counter.answer." + actor.toLowerCase(), routed, () => counterDispatch.answer(routed));
          },
          counterReadback: input => {
            const actor = authenticatedActor;
            const routed = { ...input, actor };
            return runMutation("counter.readback." + actor.toLowerCase(), routed, () => counter.readback(routed));
          },
          linearListProjects: input => linear.listProjects(input),
          linearGetIssue: input => linear.getIssue(input),
          linearCreateIssue: input => runMutation("linear.create_issue", input, () => linear.createIssue(input)),
          linearUpdateIssue: input => runMutation("linear.update_issue", input, () => linear.updateIssue(input)),
          cloudflareCapabilities: () => cloudflare.capabilities(),
          cloudflareHealth: () => cloudflare.health(),
          cloudflareListWorkers: () => cloudflare.listWorkers(),
          cloudflareInspectWorker: input => cloudflare.inspectWorker(input),
          gmailCapabilities: () => googleWorkspace.capabilities(),
          gmailDiagnostics: () => googleWorkspace.diagnostics(),
          gmailProfile: () => googleWorkspace.gmailProfile(),
          gmailSearch: input => googleWorkspace.gmailSearch(input),
          gmailGetMessage: input => googleWorkspace.gmailGetMessage(input),
          gmailSendMessage: input => runOperationalMutation("gmail.send_message", input, () => googleWorkspace.gmailSendMessage(input)),
          calendarCapabilities: () => googleWorkspace.capabilities(),
          calendarDiagnostics: () => googleWorkspace.diagnostics(),
          calendarList: input => googleWorkspace.calendarList(input),
          calendarEvents: input => googleWorkspace.calendarEvents(input),
          calendarCreateEvent: input => runOperationalMutation("calendar.create_event", input, () => googleWorkspace.calendarCreateEvent(input)),
          driveCapabilities: () => drive.capabilities(),
          driveHealth: async () => {
            const response = await drive.health();
            const payload = await response.json().catch(() => ({}));
            return json({ ...payload, hubOrigin: url.origin });
          },
          driveDiagnostics: () => drive.diagnostics(),
          driveRoot: () => drive.root(),
          driveGetItem: input => drive.getItem(input),
          driveListChildren: input => drive.listChildren(input),
          driveReadDocument: input => drive.readDocument(input),
          driveDownloadFile: input => drive.downloadFile(input),
          driveCreateFolder: input => runOperationalMutation("drive.create_folder", input, () => drive.createFolder(input)),
          driveUploadFile: input => runOperationalMutation("drive.upload_file", input, () => drive.uploadFile(input)),
          driveMoveItem: input => runOperationalMutation("drive.move_item", input, () => drive.moveItem(input)),
          driveRenameItem: input => runOperationalMutation("drive.rename_item", input, () => drive.renameItem(input)),
          listWorkflowArtifacts: input => artifactDelivery.listArtifacts(input),
          archiveWorkflowArtifact: input => runMutation("artifact.archive_workflow", input, () => artifactDelivery.archiveArtifact(input)),
        });
      const speaker = env?.GO_HUB_BROADCAST_STATE
        ? ({ area, observed }) => broadcast.speaker({ area, observed })
        : null;
      registry = createMcpRegistry({
        enforceCardAccess: String(env?.GO_HUB_CARD_ACCESS_V2 || "").trim() === "1",
        workContextOptionalTools: ["go_hub_cloudflare_health"],
        lifecycle: registryLifecycle,
        speaker,
      });

      return createMcpHandler({
        registry,
        issuer: url.origin,
        authenticate: async current => {
          const identity = await verifyAccessToken(current, accessConfig);
          const subject = String(identity.subject || "");
          authenticatedActor = ["LIGHT", "light", "notion"].includes(subject)
            ? "LIGHT"
            : ["GO", "go", "big"].includes(subject)
              ? "GO"
              : subject;
          return identity;
        },
        allowedOrigins: ["https://www.notion.so", "https://notion.so", "https://app.notion.com"],
        resourceMetadataUrl: null,
      })(request);
    },
  });
}

export default createFactoryMcpWorker();

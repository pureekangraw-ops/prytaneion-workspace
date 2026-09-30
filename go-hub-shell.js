import { createHubRuntime, createMissionCard, createCardCounter, composeDressingBrief, compareOneToOne } from "./go-hub-runtime.js";
import { createCodeCapability, createCodeTaskSession } from "./go-hub-code-module.js";
import { createLocalStorageKeyValueStore, createStatePersistence } from "./go-hub-persistence.js";
import { createGitHubWorkspace } from "./go-hub-github-workspace.js";
import { createWorkbenchView } from "./go-hub-workbench-model.js";
import { createOperatorView } from "./go-hub-operator-model.js";
import { createFactoryRealityReturn, createFactoryWorkContext } from "./go-hub-factory-return.js";
import { createCityRoute, routeInbound } from "./go-hub-city-route.js";
import { fitWork } from "./go-hub-optician.js";
import { CENTRE_STATES, admitDestination } from "./go-hub-centre.js";
import { createCentreLiveClient } from "./go-hub-centre-client.js";
import { getWorkTarget } from "./go-hub-work-targets.js";
import { correlateControlRoomTruth } from "./go-hub-control-room.js";
import { mountTicketHub } from "./go-hub-ticket-hub.js";

const FACTORY_DESTINATION = "destination://factory";
const cityRoute = createCityRoute();
const runtime = createHubRuntime();

const centreLive = createCentreLiveClient({
  fetchImpl: globalThis.fetch.bind(globalThis),
  storage: globalThis.localStorage,
});

let centreWork = null;
let centreLoadError = null;
let workspace = null;
let task = null;
let baseCodeCapability = null;
let taskLoadError = null;
let activeWorkbenchKey = null;
let ticketHub = null;

try {
  centreWork = await centreLive.restoreOrStart();
} catch (error) {
  centreLoadError = error instanceof Error ? error.message : String(error);
}

const status = document.querySelector("[data-hub-status]");
const list = document.querySelector("[data-hub-capabilities]");
const empty = document.querySelector("[data-hub-empty]");
const workbenchShell = document.querySelector("[data-workbench-shell]");
const centreForm = document.querySelector("[data-centre-form]");
const centreAction = document.querySelector("[data-centre-action]");
const centreError = document.querySelector("[data-centre-error]");
const centreTarget = document.querySelector("[data-centre-target]");
const controlRoomPanel = document.querySelector("[data-control-room]");
const controlRoomRefresh = document.querySelector("[data-control-room-refresh]");
const controlRoomError = document.querySelector("[data-control-room-error]");

function controlRoomText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value == null || value === "" ? "UNKNOWN" : String(value);
}

function renderControlRoom(payload = {}) {
  const observations = payload.observations || correlateControlRoomTruth({
    centre: payload.centre || centreWork || {},
    projectStatus: payload.projectStatus || {},
    factory: payload.factory || {},
    board: payload.board || {},
    github: payload.github || {},
    cloudflare: payload.cloudflare || {},
    capabilities: payload.capabilities || [],
    autoRefresh: true,
  });
  controlRoomText("[data-control-room-status]", observations.overall);
  controlRoomText("[data-control-room-work]", payload.workId || centreWork?.workId);
  controlRoomText("[data-control-room-checkpoint]", payload.checkpointId || centreWork?.checkpointId);
  controlRoomText("[data-control-room-centre]", observations.sourceStatus?.centre);
  controlRoomText("[data-control-room-project]", observations.sourceStatus?.project);
  controlRoomText("[data-control-room-factory]", observations.sourceStatus?.factory);
  controlRoomText("[data-control-room-board]", observations.board?.status);
  controlRoomText("[data-control-room-cloudflare]", observations.sourceStatus?.cloudflare);
  controlRoomText("[data-control-room-provenance]", observations.deploymentProvenance?.status);
  controlRoomText("[data-control-room-updated]", payload.observedAt || payload.checkedAt || "UNKNOWN");
  const signals = [
    observations.centreProject,
    observations.board,
    observations.deploymentProvenance,
  ].filter(item => item && item.status !== "PASS" && item.status !== "VERIFIED");
  const list = document.querySelector("[data-control-room-signals]");
  if (list) {
    list.replaceChildren(...(signals.length ? signals : [{ status: "PASS", reason: "NO_CORRELATION_CONFLICT" }]).map(item => {
      const li = document.createElement("li");
      li.textContent = `${item.status}: ${item.reason || "—"}`;
      return li;
    }));
  }
}

async function refreshControlRoom() {
  if (!controlRoomPanel || !centreWork?.workId) return;
  try {
    const params = new URLSearchParams({
      workId: String(centreWork.workId),
      checkpointId: String(centreWork.checkpointId || ""),
    });
    const response = await fetch(`/hub/api/centre/control-room?${params}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.code || "CONTROL_ROOM_READ_FAILED");
    renderControlRoom(body);
    if (controlRoomError) controlRoomError.textContent = "";
  } catch (error) {
    renderControlRoom({ workId: centreWork.workId, checkpointId: centreWork.checkpointId });
    if (controlRoomError) controlRoomError.textContent = error instanceof Error ? error.message : String(error);
  }
}

const counterAskForm = document.querySelector("[data-counter-ask-form]");
const counterQuestion = document.querySelector("[data-counter-question]");
const counterConversation = document.querySelector("[data-counter-conversation]");
const counterChatEmpty = document.querySelector("[data-counter-chat-empty]");
const counterResult = document.querySelector("[data-counter-result]");

const DRESSING_STORAGE_KEY = "go-hub:dressing-room:v1";
const dressingCoreInputs = [...document.querySelectorAll("[data-dressing-core]")];
const dressingStatus = document.querySelector("[data-dressing-status]");
const dressingLesson = document.querySelector("[data-dressing-lesson]");
const dressingAdd = document.querySelector("[data-dressing-add]");
const dressingLessons = document.querySelector("[data-dressing-lessons]");
const dressingEmpty = document.querySelector("[data-dressing-empty]");

function readDressingState() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(DRESSING_STORAGE_KEY) || "{}");
    return {
      installed: Array.isArray(parsed.installed) ? [...new Set(parsed.installed.map(String))] : [],
      lessons: Array.isArray(parsed.lessons)
        ? parsed.lessons.filter(item => item && typeof item.text === "string").slice(-200)
        : [],
    };
  } catch {
    return { installed: [], lessons: [] };
  }
}

let dressingState = readDressingState();
let latestMissionBrief = null;

function saveDressingState() {
  globalThis.localStorage?.setItem(DRESSING_STORAGE_KEY, JSON.stringify(dressingState));
}

function renderDressingRoom() {
  const installed = new Set(dressingState.installed);
  for (const input of dressingCoreInputs) input.checked = installed.has(input.value);
  if (dressingStatus) dressingStatus.textContent = `${installed.size}/${dressingCoreInputs.length}`;
  if (dressingEmpty) dressingEmpty.hidden = dressingState.lessons.length > 0;
  if (dressingLessons) {
    dressingLessons.replaceChildren(...dressingState.lessons.map(item => {
      const li = document.createElement("li");
      li.textContent = item.text;
      return li;
    }));
  }
}

function addDressingLesson(value) {
  const text = String(value || "").trim();
  if (!text) return;
  dressingState = {
    ...dressingState,
    lessons: [...dressingState.lessons, { text, addedAt: new Date().toISOString() }].slice(-200),
  };
  saveDressingState();
  if (dressingLesson) dressingLesson.value = "";
  renderDressingRoom();
}

function mountMissionBriefingRoom() {
  const room = document.querySelector("[data-mission-briefing-host]");
  if (!room || room.querySelector("[data-mission-card-reader]")) return;

  const panel = document.createElement("div");
  panel.className = "dressing-briefing-room";
  panel.dataset.missionCardReader = "true";
  panel.innerHTML = `
    <p class="hub-kicker">MISSION BRIEFING ROOM</p>
    <p class="counter-hint">Mission Card เป็น pointer ของ Work เท่านั้น — ทุก observation อ่านใหม่จาก owner source</p>
    <label>Work ID<input data-mission-card-work placeholder="WORK-…"></label>
    <label>Checkpoint ID<input data-mission-card-checkpoint placeholder="CP-…"></label>
    <label>Job Code <span class="counter-hint">(optional)</span><input data-mission-card-job placeholder="JOB-…"></label>
    <div class="dressing-briefing-actions">
      <button type="button" data-mission-card-tap>ทาบ Mission Card</button>
      <button type="button" data-mission-card-remove>ยกบัตรออก</button>
    </div>
    <p class="counter-result" data-mission-card-status role="status">ยังไม่มีบัตร</p>
    <pre class="dressing-briefing-output" data-mission-card-output>ยังไม่มี Brief</pre>
  `;
  room.append(panel);

  const workInput = panel.querySelector("[data-mission-card-work]");
  const checkpointInput = panel.querySelector("[data-mission-card-checkpoint]");
  const jobInput = panel.querySelector("[data-mission-card-job]");
  const tapButton = panel.querySelector("[data-mission-card-tap]");
  const removeButton = panel.querySelector("[data-mission-card-remove]");
  const statusNode = panel.querySelector("[data-mission-card-status]");
  const output = panel.querySelector("[data-mission-card-output]");

  if (centreWork) {
    workInput.value = centreWork.workId || "";
    checkpointInput.value = centreWork.checkpointId || "";
  }

  const readRemote = async (endpoint, context) => {
    const params = new URLSearchParams({ workId: context.card.workId, checkpointId: context.card.checkpointId });
    const response = await fetch(`${endpoint}?${params}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.code || `${endpoint} unavailable`);
    return body;
  };

  const cardCounter = createCardCounter({
    resolveWork: async ({ workId, checkpointId }) => {
      const currentWork = centreWork;
      if (currentWork && currentWork.workId === workId && currentWork.checkpointId === checkpointId) {
        return { status: "LIVE", ownerSource: "Centre", data: structuredClone(currentWork), sourceRef: `centre://${workId}` };
      }
      return readRemote("/hub/api/centre/inspect", { card: { workId, checkpointId } });
    },
    projections: [
      { source: "CENTRE", read: async ({ resolved }) => ({ status: "LIVE", ownerSource: "Centre", data: resolved.work, sourceRef: `centre://${resolved.card.workId}` }) },
      { source: "HEIMDALL", read: async ({ work }) => ({ status: "LIVE", ownerSource: "Heimdall", data: { targetId: work?.data?.targetId || work?.targetId || null } }) },
      { source: "BOARD", read: context => readRemote("/hub/api/board/read", context) },
      { source: "FACTORY", read: context => readRemote("/hub/api/factory/status", context) },
      { source: "GITHUB", read: context => readRemote("/hub/api/github-workspace/status", context) },
      { source: "CLOUDFLARE", read: context => readRemote("/hub/api/cloudflare/status", context) },
      { source: "CONTROL ROOM", read: context => readRemote("/hub/api/centre/control-room", context) },
    ],
  });

  const lightIntel = async ({ card, projection }) => {
    try {
      const body = await postCounterAction("/hub/api/counter/ask", {
        question: `Work ${card.workId} / Checkpoint ${card.checkpointId}: มี decision, architecture note, constraint, prior discussion, related document หรือ open question อะไรเกี่ยวข้องกับงานนี้`,
        workId: card.workId,
        checkpointId: card.checkpointId,
        context: { kind: "MISSION_BRIEF_INTEL", observationCount: projection.observations.length },
      });
      return { status: "LIVE", ownerSource: "LIGHT / Notion AI", data: body, sourceRef: body?.sourceRef || null };
    } catch (error) {
      return { status: "UNKNOWN", ownerSource: "LIGHT / Notion AI", data: null, sourceRef: null, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const renderBrief = brief => {
    const lines = [
      `DRESSING ROOM BRIEF · ${brief.workId} · ${brief.checkpointId}`,
      `MODE: ${brief.mode} · LENS: ${brief.lens}`,
      "",
      "OWNER-SOURCE OBSERVATIONS",
      ...brief.observations.map(item => `${item.source}: ${item.status} · ${item.ownerSource}${item.sourceRef ? ` · ${item.sourceRef}` : ""}`),
      "",
      "1:1 CROSSCHECK",
      ...(brief.comparisons.length ? brief.comparisons.map(item => `${item.topic}: ${item.status}`) : ["UNKNOWN: no comparable pair"]),
      "",
      "DOUBT ENGINE",
      ...(brief.doubts.length ? brief.doubts.map(item => `${item.label} · ${item.topic}: ${item.status}`) : ["NONE OBSERVED"]),
      "",
      "LIGHT INTEL",
      `LIGHT: ${brief.light.status}${brief.light.optional ? " · optional" : ""}`,
      "",
      "SINCE LAST BRIEF",
      ...(brief.sinceLastBrief.length ? brief.sinceLastBrief.map(item => `${item.source}: CHANGED`) : ["NO PRIOR BRIEF"]),
    ];
    output.textContent = lines.join("\n");
  };

  tapButton.addEventListener("click", async () => {
    statusNode.textContent = "กำลังอ่าน owner sources สด…";
    tapButton.disabled = true;
    try {
      const card = createMissionCard({
        workId: workInput.value,
        checkpointId: checkpointInput.value,
        jobCode: jobInput.value,
      });
      const projection = await cardCounter.tap(card, { lens: "dressing-room" });
      const sourceMap = new Map(projection.observations.map(item => [item.source, item]));
      const comparisons = [
        compareOneToOne({ topic: "Centre status ↔ Board status", left: sourceMap.get("CENTRE"), right: sourceMap.get("BOARD") }),
        compareOneToOne({ topic: "GitHub SHA ↔ Cloudflare evidence", left: sourceMap.get("GITHUB"), right: sourceMap.get("CLOUDFLARE") }),
        compareOneToOne({ topic: "GO WORKS phase ↔ Control Room runtime", left: sourceMap.get("FACTORY"), right: sourceMap.get("CONTROL ROOM") }),
      ];
      latestMissionBrief = composeDressingBrief({
        counterProjection: projection,
        lightIntel: await lightIntel({ card, projection }),
        comparisons,
        previousBrief: latestMissionBrief,
      });
      renderBrief(latestMissionBrief);
      statusNode.textContent = "อ่าน Brief ใหม่แล้ว · ไม่มีการ mutate Work / Pass / Route";
    } catch (error) {
      statusNode.textContent = error instanceof Error ? error.message : String(error);
      output.textContent = "UNKNOWN — Brief unavailable";
    } finally {
      tapButton.disabled = false;
    }
  });

  removeButton.addEventListener("click", () => {
    latestMissionBrief = null;
    statusNode.textContent = "ยกบัตรออกแล้ว · ไม่มีการเปลี่ยน Work";
    output.textContent = "ยังไม่มี Brief";
  });
}

function field(name) {
  return centreForm?.elements.namedItem(name) || null;
}

function activeTarget() {
  return getWorkTarget(centreWork?.handoff?.targetId || centreWork?.targetId);
}

function hasActiveWorkbench() {
  return Boolean(
    centreWork?.status === CENTRE_STATES.AWAY &&
    centreWork?.handoff?.destination === FACTORY_DESTINATION &&
    activeTarget() &&
    task &&
    workspace &&
    baseCodeCapability
  );
}

function taskSnapshot() {
  return hasActiveWorkbench() && typeof task.snapshot === "function" ? task.snapshot() : {};
}

function resetWorkbenchMemory() {
  if (runtime.get("Code")) runtime.unregister("Code");
  workspace = null;
  task = null;
  baseCodeCapability = null;
  taskLoadError = null;
  activeWorkbenchKey = null;
}

async function ensureWorkbenchForCentre() {
  const target = activeTarget();
  const shouldOpen = centreWork?.status === CENTRE_STATES.AWAY &&
    centreWork?.handoff?.destination === FACTORY_DESTINATION;

  if (!shouldOpen) {
    resetWorkbenchMemory();
    return;
  }

  if (!target) {
    resetWorkbenchMemory();
    taskLoadError = "WORK_TARGET_REQUIRED";
    return;
  }

  const key = `${centreWork.workId}:${target.id}`;
  if (activeWorkbenchKey === key && task && workspace && baseCodeCapability) return;

  resetWorkbenchMemory();
  activeWorkbenchKey = key;
  workspace = createGitHubWorkspace({
    gatewayBase: "/hub/api/github-workspace",
    repository: target.repository,
  });

  const taskPersistence = createStatePersistence({
    store: createLocalStorageKeyValueStore({
      storage: globalThis.localStorage,
      namespace: `go-hub-code:${target.id}`,
    }),
    key: `work:${centreWork.workId}`,
  });
  const taskSession = createCodeTaskSession({
    persistence: taskPersistence,
    initial: {
      id: `code:${centreWork.workId}`,
      intent: centreWork.task || `GO Hub work for ${target.label}`,
      repository: workspace.repository,
    },
  });

  try {
    task = await taskSession.load();
    if (task.snapshot().repository !== target.repository) {
      throw new Error("WORKBENCH_TARGET_MISMATCH");
    }
    baseCodeCapability = createCodeCapability({ workspace, task });
  } catch (error) {
    taskLoadError = error instanceof Error ? error.message : String(error);
    task = null;
    baseCodeCapability = null;
  }
}

await ensureWorkbenchForCentre();

function assertWorkbenchReady() {
  if (!hasActiveWorkbench()) {
    throw new Error(taskLoadError || "WORKBENCH_STATE_UNAVAILABLE");
  }
}

function createFactoryAccess() {
  assertWorkbenchReady();
  return admitDestination(centreWork, {
    destination: FACTORY_DESTINATION,
    capability: baseCodeCapability,
  });
}

function fitFactoryRoute() {
  const destination = String(field("destination")?.value || "").trim();
  const canonicalFactory = cityRoute.destinations.factory;
  if (destination !== FACTORY_DESTINATION || destination !== canonicalFactory.route) {
    throw new Error("Factory destination does not match canonical city route");
  }
  if (!getWorkTarget(centreWork?.targetId || field("targetId")?.value)) {
    throw new Error("WORK_TARGET_REQUIRED");
  }
  const fit = fitWork({
    context: {
      purpose: centreWork.task,
      successCondition: centreWork.requestedResult,
    },
    reality: { targetId: centreWork.targetId || null },
    role: { reference: centreWork.persona?.personaReference },
    destination: canonicalFactory,
  });
  if (fit.gate !== "PASS") {
    throw new Error(`Optician gate did not pass: ${fit.missing?.join(", ") || "UNKNOWN"}`);
  }
  const route = routeInbound({ fit });
  if (route.destination !== "go-work-loop" || route.workRoute !== destination) {
    throw new Error("Canonical city route did not admit Factory destination");
  }
  return Object.freeze({ fit, route, destination });
}

function syncFactoryAccess() {
  if (!hasActiveWorkbench()) {
    if (runtime.get("Code")) runtime.unregister("Code");
    return;
  }
  if (!runtime.get("Code")) {
    const access = createFactoryAccess();
    const workContext = createFactoryWorkContext(access, taskSnapshot());
    runtime.register("Code", createCodeCapability({ workspace, task, workContext }));
  }
}

function renderWorkbench(snapshot) {
  const view = createWorkbenchView(snapshot || {});
  const mission = document.querySelector("[data-workbench-mission]");
  const blueprint = document.querySelector("[data-workbench-blueprint]");
  const piece = document.querySelector("[data-workbench-piece]");
  const workbenchStatus = document.querySelector("[data-workbench-status]");
  const evidence = document.querySelector("[data-workbench-evidence]");
  const next = document.querySelector("[data-workbench-next]");

  if (mission) mission.textContent = view.mission?.summary || "—";
  if (blueprint) blueprint.textContent = view.blueprint?.title || view.blueprint?.ref || "—";
  if (piece) piece.textContent = view.currentPiece?.title || view.currentPiece?.id || "—";
  if (workbenchStatus) workbenchStatus.textContent = hasActiveWorkbench() ? (view.status || "UNKNOWN") : "IDLE";
  if (evidence) {
    evidence.textContent = view.evidence.length
      ? view.evidence.map(item => item.label || item.kind || String(item.value || "evidence")).join(" · ")
      : "—";
  }
  if (next) next.textContent = hasActiveWorkbench()
    ? (view.blocker ? `BLOCKED — ${view.blocker}` : (view.next || "—"))
    : "NO ACTIVE WORK";
}

function renderOperator(snapshot) {
  if (!hasActiveWorkbench()) {
    const idle = {
      state: "IDLE",
      repository: null,
      base: null,
      "work-branch": null,
      head: null,
      pr: null,
      ci: null,
      deploy: null,
      verification: null,
      blocker: taskLoadError,
      "next-action": "NO ACTIVE WORK",
    };
    for (const [key, value] of Object.entries(idle)) {
      const node = document.querySelector(`[data-code-${key}]`);
      if (node) node.textContent = value || "—";
    }
    return;
  }

  const view = createOperatorView(snapshot || {});
  const values = {
    state: view.state,
    repository: view.repository,
    base: view.base,
    "work-branch": view.workBranch,
    head: view.head,
    pr: view.pullRequest,
    ci: view.ci,
    deploy: view.deploy,
    verification: view.verification,
    blocker: view.interruption?.state || view.blocker,
    "next-action": view.interruption?.actions?.join(" · ") || view.next,
  };
  for (const [key, value] of Object.entries(values)) {
    const node = document.querySelector(`[data-code-${key}]`);
    if (node) node.textContent = value || "—";
  }
}

function renderCentre() {
  if (!centreWork) {
    document.querySelector("[data-centre-state]").textContent = "UNAVAILABLE";
    document.querySelector("[data-centre-checkpoint]").textContent = "—";
    document.querySelector("[data-centre-work]").textContent = "—";
    document.querySelector("[data-centre-return]").textContent = "—";
    if (centreTarget) centreTarget.textContent = "—";
    centreAction.textContent = "Centre unavailable";
    centreAction.disabled = true;
    centreError.textContent = centreLoadError || "CENTRE_LIVE_UNAVAILABLE";
    return;
  }

  document.querySelector("[data-centre-state]").textContent = centreWork.status;
  document.querySelector("[data-centre-checkpoint]").textContent = centreWork.checkpointId;
  document.querySelector("[data-centre-work]").textContent = centreWork.workId;
  document.querySelector("[data-centre-return]").textContent = centreWork.checkpointId;

  field("task").value = centreWork.task || "";
  field("requestedResult").value = centreWork.requestedResult || "";
  field("authority").value = centreWork.authority || "BIG";
  field("targetId").value = centreWork.targetId || "";
  field("personaReference").value = centreWork.persona?.personaReference || "";
  field("workingView").value = centreWork.persona?.workingView || "";

  const target = getWorkTarget(centreWork.targetId);
  if (centreTarget) centreTarget.textContent = target?.label || "—";

  const reviewed = centreWork.status !== CENTRE_STATES.ARRIVED
    && centreWork.status !== CENTRE_STATES.WAIT;
  const fitted = Boolean(centreWork.persona);

  ["task", "requestedResult", "authority", "targetId"].forEach(name => {
    field(name).disabled = reviewed;
  });
  ["personaReference", "workingView"].forEach(name => {
    field(name).disabled = !reviewed || fitted;
    field(name).required = reviewed && !fitted && centreWork.status === CENTRE_STATES.READY;
  });

  const leaveTarget = target?.label || "selected target";
  const labels = {
    [CENTRE_STATES.ARRIVED]: "Review task",
    [CENTRE_STATES.WAIT]: "Review task",
    [CENTRE_STATES.READY]: fitted ? `Leave for ${leaveTarget} via GO WORKS` : "Fit Role",
    [CENTRE_STATES.AWAY]: "Receive return",
    [CENTRE_STATES.RETURNED]: "Returned to checkpoint",
  };
  centreAction.textContent = labels[centreWork.status] || "Unavailable";
  centreAction.disabled = centreWork.status === CENTRE_STATES.RETURNED;
}

function appendCounterMessage(actor, message) {
  if (!counterConversation) return;
  if (counterChatEmpty) counterChatEmpty.hidden = true;
  const item = document.createElement("p");
  item.className = "counter-message";
  item.dataset.actor = actor;
  const name = document.createElement("strong");
  name.textContent = actor === "GO" ? "GO" : actor === "LIGHT" ? "LIGHT" : "NOTION";
  const body = document.createElement("span");
  body.textContent = message;
  item.append(name, body);
  counterConversation.append(item);
  counterConversation.scrollTop = counterConversation.scrollHeight;
}

async function searchNotion(question) {
  const value = String(question || "").trim();
  if (!value || !counterQuestion) return;
  appendCounterMessage("GO", value);
  counterQuestion.value = "";
  counterQuestion.disabled = true;
  if (counterResult) counterResult.textContent = "Notion AI กำลังค้น…";
  try {
    const body = await postCounterAction("/hub/api/counter/ask", { question:value });
    appendCounterMessage("NOTION", String(body?.answer || "UNKNOWN"));
    if (counterResult) {
      const count = Number(body?.resultCount || body?.evidence?.length || 0);
      counterResult.textContent = count > 0 ? `Notion AI · ${count} results` : String(body?.status || "UNKNOWN");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendCounterMessage("NOTION", "UNKNOWN — " + message);
    if (counterResult) counterResult.textContent = message;
  } finally {
    counterQuestion.disabled = false;
    counterQuestion.focus();
  }
}

async function postCounterAction(path, payload) {
  const response = await fetch(path, {
    method:"POST",
    headers:{ "content-type":"application/json" },
    body:JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.code || "COUNTER_ACTION_FAILED");
  }
  return body;
}

function render() {
  syncFactoryAccess();
  const capabilities = runtime.list();
  const target = activeTarget();
  status.textContent = !centreWork
    ? "Centre live unavailable."
    : centreWork.status === CENTRE_STATES.AWAY
      ? taskLoadError
        ? "GO is away from Centre. Workbench target unavailable."
        : `GO is working on ${target?.label || "target"} via GO WORKS.`
      : "GO is at Centre.";

  empty.hidden = capabilities.length > 0;
  workbenchShell.hidden = !runtime.get("Code");
  list.replaceChildren(
    ...capabilities.map(({ name, capability }) => {
      const item = document.createElement("li");
      const title = capability.title || name;
      const state = capability.status ? ` — ${capability.status}` : "";
      item.textContent = `${title}${state}`;
      item.dataset.capability = capability.id || name;
      return item;
    }),
  );
  renderCentre();
  renderWorkbench(taskSnapshot());
  renderOperator(taskSnapshot());
  ticketHub?.refresh();
}

for (const input of dressingCoreInputs) {
  input.addEventListener("change", () => {
    const installed = new Set(dressingState.installed);
    if (input.checked) installed.add(input.value);
    else installed.delete(input.value);
    dressingState = { ...dressingState, installed: [...installed] };
    saveDressingState();
    renderDressingRoom();
  });
}

dressingAdd?.addEventListener("click", () => addDressingLesson(dressingLesson?.value));
dressingLesson?.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  addDressingLesson(dressingLesson.value);
});

renderDressingRoom();

ticketHub = mountTicketHub({
  root:document,
  storage:globalThis.localStorage,
  centreLive,
  getCurrentWork:() => centreWork,
  onWorkChanged:async work => {
    centreWork = work;
    centreLoadError = null;
    await ensureWorkbenchForCentre();
    render();
    void refreshControlRoom();
  },
});

mountMissionBriefingRoom();

controlRoomRefresh?.addEventListener("click", () => { void refreshControlRoom(); });

counterAskForm?.addEventListener("submit", event => {
  event.preventDefault();
  void searchNotion(counterQuestion?.value);
});

counterQuestion?.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void searchNotion(counterQuestion.value);
});

centreForm?.addEventListener("submit", async event => {
  event.preventDefault();
  centreError.textContent = "";
  try {
    if (!centreWork) throw new Error("CENTRE_LIVE_UNAVAILABLE");
    const identity = {
      workId: centreWork.workId,
      checkpointId: centreWork.checkpointId,
      returnAddress: centreWork.checkpointId,
    };

    if (centreWork.status === CENTRE_STATES.ARRIVED || centreWork.status === CENTRE_STATES.WAIT) {
      const target = getWorkTarget(field("targetId").value);
      if (!target) throw new Error("WORK_TARGET_REQUIRED");
      centreWork = await centreLive.command({
        action: "review",
        ...identity,
        task: field("task").value,
        requestedResult: field("requestedResult").value,
        authority: field("authority").value,
        targetId: target.id,
      });
    } else if (centreWork.status === CENTRE_STATES.READY && !centreWork.persona) {
      centreWork = await centreLive.command({
        action: "fit",
        ...identity,
        personaId: field("personaReference").value,
        personaReference: field("personaReference").value,
        workingView: field("workingView").value,
      });
    } else if (centreWork.status === CENTRE_STATES.READY) {
      const route = fitFactoryRoute();
      centreWork = await centreLive.command({
        action: "leave",
        ...identity,
        destination: route.destination,
        targetId: centreWork.targetId,
      });
      await ensureWorkbenchForCentre();
    } else if (centreWork.status === CENTRE_STATES.AWAY) {
      const access = createFactoryAccess();
      const packet = createFactoryRealityReturn(access, taskSnapshot());
      centreWork = await centreLive.command({
        action: "return",
        ...identity,
        payload: packet.payload,
      });
      await ensureWorkbenchForCentre();
    }

    render();
  } catch (error) {
    centreError.textContent = error instanceof Error ? error.message : String(error);
  }
});

render();
void refreshControlRoom();
setInterval(() => { void refreshControlRoom(); }, 30_000);

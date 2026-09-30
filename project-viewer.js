const POINTER_KEY = "go-hub-centre-live-pointer-v1";
const GLOBAL_STATUS = "/hub/api/centre/project-viewer-status";
const CONTROL_ROOM = "/hub/api/centre/control-room";
const $ = selector => document.querySelector(selector);

let installPrompt = null;
let refreshTimer = null;

function clean(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && clean(value)) return value;
  }
  return null;
}

function display(value, fallback = "—") {
  const text = clean(value);
  return text || fallback;
}

function tone(status) {
  const value = upper(status);
  if (["PASS","LIVE","VERIFIED","CURRENT","READY","ACTIVE","ON PROCESS","PROCESSING","NORMAL","IDLE","SELF_LIVE"].includes(value)) return "good";
  if (["FAIL","FAILED","ERROR","ISSUE","BLOCKED","CONFLICT","MISMATCH","OFFLINE","UNAVAILABLE","AUTH_REQUIRED","NOT_CONFIGURED"].includes(value)) return "bad";
  if (["CHECK","STALE","DEGRADED","CAUTION","WAIT","WAIT VERIFY","REVIEW_REQUIRED"].includes(value)) return "warn";
  return "unknown";
}

function setStatus(selector, status) {
  const node = $(selector);
  if (!node) return;
  const value = display(status, "CHECK");
  node.textContent = value;
  node.classList.remove("good","bad","warn","unknown");
  node.classList.add(tone(value));
}

function setText(selector, value, fallback = "—") {
  const node = $(selector);
  if (node) node.textContent = display(value, fallback);
}

function jsonText(value) {
  try { return JSON.stringify(value ?? {}, null, 2); }
  catch { return "{}"; }
}

function readPointer() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POINTER_KEY) || "null");
    const workId = clean(parsed?.workId);
    const checkpointId = clean(parsed?.checkpointId);
    return workId && checkpointId ? { workId, checkpointId } : null;
  } catch {
    return null;
  }
}

function setAttention(items = []) {
  const attention = Array.isArray(items) ? items.filter(Boolean).map(String) : [];
  const list = $("[data-attention-list]");
  if (list) {
    list.replaceChildren(...(attention.length ? attention : ["ไม่มีสัญญาณผิดปกติหลัก"]).map(text => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }));
  }
  setText("[data-attention-count]", attention.length);
}

function renderGlobal(payload = {}) {
  setStatus("[data-overall]", payload.overall || "CHECK");
  setText("[data-overall-message]", payload.message || "กำลังตรวจสถานะ");
  setText("[data-observed]", payload.observedAt);
  setStatus("[data-hub-status]", payload.hub?.status || "CHECK");

  setText("[data-project-status]", payload.projectStatus?.status || "CHECK");
  setText("[data-google-status]", payload.services?.googleWorkspace?.status || "CHECK");
  setText("[data-drive-status]", payload.services?.drive?.status || "CHECK");

  setStatus("[data-factory-status]", payload.factory?.status || "CHECK");
  setText("[data-factory-state]", payload.factory?.state || "READY");
  setText("[data-factory-task]", "NO LOCAL TASK");
  setText("[data-factory-repo]", payload.updates?.github?.repository);
  setText("[data-factory-branch]", "—");
  setText("[data-factory-raw]", jsonText(payload.factory), "{}");

  setStatus("[data-update-status]", payload.updates?.status || "CHECK");
  setText("[data-github-status]", payload.updates?.github?.status || "CHECK");
  setText("[data-head-sha]", payload.updates?.github?.headSha);
  setText("[data-cloudflare-status]", payload.updates?.cloudflare?.status || "CHECK");
  setText("[data-provenance]", payload.updates?.provenance?.status || "CHECK");
  setText("[data-update-raw]", jsonText(payload.updates), "{}");

  setAttention(payload.attention || []);
}

function renderLocalWork(payload = {}) {
  const observations = payload?.observations || {};
  setText("[data-centre-status]", first(payload?.centre?.status, observations.sourceStatus?.centre, "CHECK"));
  setText("[data-work-id]", payload?.workId);
  setText("[data-checkpoint-id]", payload?.checkpointId);
  setText("[data-board-status]", first(payload?.board?.status, observations.board?.status, "CHECK"));

  const factory = payload?.factory || {};
  const task = factory.task || factory.currentTask || factory.state?.task || {};
  if (upper(factory.reason) === "FACTORY_V4_NOT_FOUND") {
    setText("[data-factory-task]", "NO ACTIVE TASK");
    return;
  }
  const taskId = first(task.id, task.taskId, factory.taskId, factory.id);
  if (taskId) {
    setStatus("[data-factory-status]", first(factory.status, task.status, "ACTIVE"));
    setText("[data-factory-state]", first(factory.state?.status, factory.phase, task.phase, task.status, factory.status));
    setText("[data-factory-task]", taskId);
    setText("[data-factory-repo]", first(task.repository, factory.repository));
    const pr = first(task.pullRequest, task.pr, task.pullRequestNumber, factory.pullRequest, factory.pr);
    const branch = first(task.workBranch, task.branch, factory.workBranch, factory.branch);
    setText("[data-factory-branch]", [branch, pr ? `PR #${pr}` : null].filter(Boolean).join(" · "));
    setText("[data-factory-raw]", jsonText(factory), "{}");
  }
}

function renderNoLocalWork() {
  setText("[data-centre-status]", "NO LOCAL WORK");
  setText("[data-work-id]", "—");
  setText("[data-checkpoint-id]", "—");
  setText("[data-board-status]", "—");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method:"GET",
    cache:"no-store",
    headers:{ "accept":"application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.code || `HTTP_${response.status}`);
  return body;
}

async function refresh() {
  const button = $("[data-refresh]");
  if (button) button.disabled = true;
  try {
    const global = await fetchJson(`${GLOBAL_STATUS}?t=${Date.now()}`);
    renderGlobal(global);

    const pointer = readPointer();
    if (!pointer) {
      renderNoLocalWork();
      return;
    }

    const params = new URLSearchParams(pointer);
    try {
      const local = await fetchJson(`${CONTROL_ROOM}?${params}&t=${Date.now()}`);
      renderLocalWork(local);
    } catch (error) {
      setText("[data-centre-status]", "CHECK");
      setText("[data-board-status]", "CHECK");
      const current = $("[data-attention-list]");
      const li = document.createElement("li");
      li.textContent = "Local Work detail: " + (error instanceof Error ? error.message : String(error));
      current?.appendChild(li);
      const count = Number(clean($("[data-attention-count]")?.textContent) || 0);
      setText("[data-attention-count]", count + 1);
    }
  } catch (error) {
    setStatus("[data-overall]", "ERROR");
    setStatus("[data-hub-status]", "ERROR");
    setStatus("[data-factory-status]", "CHECK");
    setStatus("[data-update-status]", "CHECK");
    setText("[data-overall-message]", error instanceof Error ? error.message : String(error));
    setAttention(["GLOBAL_PROJECT_STATUS_FAILED"]);
  } finally {
    if (button) button.disabled = false;
  }
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  const button = $("[data-install]");
  if (button) button.hidden = false;
});

$("[data-install]")?.addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null;
  $("[data-install]").hidden = true;
});

$("[data-refresh]")?.addEventListener("click", () => void refresh());

if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost","127.0.0.1"].includes(location.hostname))) {
  navigator.serviceWorker.register("./go-hub-sw.js", { scope:"/", updateViaCache:"none" }).catch(() => {});
}

void refresh();
refreshTimer = setInterval(() => void refresh(), 30_000);
window.addEventListener("pagehide", () => clearInterval(refreshTimer), { once:true });

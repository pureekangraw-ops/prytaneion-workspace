const POINTER_KEY = "go-hub-centre-live-pointer-v1";
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

function tone(status) {
  const value = upper(status);
  if (["PASS","LIVE","VERIFIED","CURRENT","READY","ACTIVE","ON PROCESS","PROCESSING"].includes(value)) return "good";
  if (["FAIL","FAILED","ERROR","BLOCKED","CONFLICT","MISMATCH","OFFLINE","UNAVAILABLE"].includes(value)) return "bad";
  if (["STALE","DEGRADED","CAUTION","WAIT","WAIT VERIFY","REVIEW_REQUIRED"].includes(value)) return "warn";
  return "unknown";
}

function setStatus(selector, status) {
  const node = $(selector);
  if (!node) return;
  const value = display(status, "UNKNOWN");
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

function factoryView(factory = {}) {
  const task = factory.task || factory.currentTask || factory.state?.task || {};
  const pr = first(task.pullRequest, task.pr, task.pullRequestNumber, factory.pullRequest, factory.pr);
  const branch = first(task.workBranch, task.branch, factory.workBranch, factory.branch);
  return {
    status:first(factory.status, task.status, factory.state?.status, "UNKNOWN"),
    state:first(factory.state?.status, factory.phase, task.phase, task.status, factory.status),
    task:first(task.id, task.taskId, factory.taskId, factory.id),
    repository:first(task.repository, factory.repository),
    branchPr:[branch, pr ? `PR #${pr}` : null].filter(Boolean).join(" · ") || null,
  };
}

function updateAttention(payload) {
  const observations = payload?.observations || {};
  const attention = [];
  const signals = [
    ["Hub", observations.overall],
    ["Centre ↔ Project", observations.centreProject?.status],
    ["Board", observations.board?.status],
    ["Deploy provenance", observations.deploymentProvenance?.status],
  ];
  for (const [label,status] of signals) {
    const value = upper(status);
    if (value && !["PASS","LIVE","VERIFIED","CURRENT"].includes(value)) {
      attention.push(`${label}: ${value}`);
    }
  }
  for (const [name,value] of Object.entries(observations.toolReality || {})) {
    const state = upper(value?.status);
    if (state && state !== "LIVE") attention.push(`${name}: ${state}`);
  }
  const list = $("[data-attention-list]");
  if (list) {
    list.replaceChildren(...(attention.length ? attention : ["No attention signals"]).map(text => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }));
  }
  setText("[data-attention-count]", attention.length);
}

function render(payload) {
  const observations = payload?.observations || {};
  const overall = first(observations.overall, payload?.status, "UNKNOWN");
  setStatus("[data-overall]", overall);
  setText("[data-observed]", payload?.observedAt || payload?.checkedAt);

  const bad = tone(overall) === "bad";
  const warn = tone(overall) === "warn";
  setText("[data-overall-message]", bad
    ? "พบสัญญาณผิดปกติ — เปิดรายละเอียดด้านล่าง"
    : warn
      ? "มีจุดที่ควรตรวจต่อ"
      : tone(overall) === "good"
        ? "สถานะหลักที่อ่านได้อยู่ในภาวะปกติ"
        : "ข้อมูลบางส่วนยัง UNKNOWN");

  const centreStatus = first(payload?.centre?.status, observations.sourceStatus?.centre, "UNKNOWN");
  setStatus("[data-hub-status]", overall);
  setText("[data-centre-status]", centreStatus);
  setText("[data-work-id]", payload?.workId);
  setText("[data-checkpoint-id]", payload?.checkpointId);
  setText("[data-project-status]", first(payload?.projectStatus?.status, observations.sourceStatus?.project));
  setText("[data-google-status]", observations.toolReality?.googleWorkspace?.status);
  setText("[data-drive-status]", observations.toolReality?.drive?.status);
  setText("[data-board-status]", first(payload?.board?.status, observations.board?.status));

  const factory = factoryView(payload?.factory || {});
  setStatus("[data-factory-status]", factory.status);
  setText("[data-factory-state]", factory.state);
  setText("[data-factory-task]", factory.task);
  setText("[data-factory-repo]", factory.repository);
  setText("[data-factory-branch]", factory.branchPr);
  setText("[data-factory-raw]", jsonText(payload?.factory || {}), "{}");

  const githubStatus = first(payload?.github?.status, observations.sourceStatus?.github);
  const cloudflareStatus = first(payload?.cloudflare?.status, observations.sourceStatus?.cloudflare);
  const provenance = observations.deploymentProvenance?.status || "UNKNOWN";
  const updateOverall = [githubStatus, cloudflareStatus, provenance].find(s => tone(s) === "bad")
    || [githubStatus, cloudflareStatus, provenance].find(s => tone(s) === "warn")
    || (tone(githubStatus) === "good" && tone(cloudflareStatus) === "good" && tone(provenance) === "good" ? "LIVE" : "UNKNOWN");
  setStatus("[data-update-status]", updateOverall);
  setText("[data-github-status]", githubStatus);
  setText("[data-head-sha]", first(payload?.github?.headSha, payload?.github?.sha));
  setText("[data-cloudflare-status]", cloudflareStatus);
  setText("[data-provenance]", provenance);
  setText("[data-update-raw]", jsonText({
    projectStatus:payload?.projectStatus || {},
    github:payload?.github || {},
    cloudflare:payload?.cloudflare || {},
    deploymentProvenance:observations.deploymentProvenance || {},
  }), "{}");

  updateAttention(payload);
}

function renderNoPointer() {
  setStatus("[data-overall]", "UNKNOWN");
  setText("[data-overall-message]", "ยังไม่มี current Work pointer ในเครื่องนี้ — เปิด GO Hub หนึ่งครั้งก่อน");
  setStatus("[data-hub-status]", "UNKNOWN");
  setStatus("[data-factory-status]", "UNKNOWN");
  setStatus("[data-update-status]", "UNKNOWN");
  setText("[data-attention-count]", 1);
  const list = $("[data-attention-list]");
  if (list) list.innerHTML = "<li>NO_LOCAL_CENTRE_POINTER</li>";
}

async function refresh() {
  const button = $("[data-refresh]");
  if (button) button.disabled = true;
  try {
    const pointer = readPointer();
    if (!pointer) {
      renderNoPointer();
      return;
    }
    const params = new URLSearchParams(pointer);
    const response = await fetch(`${CONTROL_ROOM}?${params}`, {
      method:"GET",
      cache:"no-store",
      headers:{ "accept":"application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.code || `HTTP_${response.status}`);
    render(body);
  } catch (error) {
    setStatus("[data-overall]", "ERROR");
    setText("[data-overall-message]", error instanceof Error ? error.message : String(error));
    setText("[data-attention-count]", 1);
    const list = $("[data-attention-list]");
    if (list) list.innerHTML = "<li>PROJECT_VIEWER_REFRESH_FAILED</li>";
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

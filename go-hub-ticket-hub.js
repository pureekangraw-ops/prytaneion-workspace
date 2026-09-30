export const TICKET_STORE_KEY = "go-hub:ticket-hub:v1";

const clean = value => String(value ?? "").trim();

function keyOf(value = {}) {
  return clean(value.workId) + "::" + clean(value.checkpointId);
}

export function readStoredTickets(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== "function") return [];
  try {
    const parsed = JSON.parse(storage.getItem(TICKET_STORE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const byKey = new Map();
    for (const item of parsed) {
      const workId = clean(item?.workId);
      const checkpointId = clean(item?.checkpointId);
      if (!workId || !checkpointId) continue;
      byKey.set(keyOf({ workId, checkpointId }), {
        workId,
        checkpointId,
        label: clean(item?.label) || workId,
        savedAt: clean(item?.savedAt) || null,
      });
    }
    return [...byKey.values()].slice(-100);
  } catch {
    return [];
  }
}

export function storeTicketPointer(storage, work, label = "", now = () => new Date().toISOString()) {
  const workId = clean(work?.workId);
  const checkpointId = clean(work?.checkpointId);
  if (!workId || !checkpointId) throw new Error("TICKET_POINTER_IDENTITY_REQUIRED");
  const item = {
    workId,
    checkpointId,
    label: clean(label) || clean(work?.task) || workId,
    savedAt: now(),
  };
  const next = readStoredTickets(storage)
    .filter(existing => keyOf(existing) !== keyOf(item))
    .concat(item)
    .slice(-100);
  storage?.setItem?.(TICKET_STORE_KEY, JSON.stringify(next));
  return item;
}

export function removeTicketPointer(storage, workId, checkpointId) {
  const target = keyOf({ workId, checkpointId });
  const next = readStoredTickets(storage).filter(item => keyOf(item) !== target);
  storage?.setItem?.(TICKET_STORE_KEY, JSON.stringify(next));
  return next;
}

export function filterStoredTickets(items = [], query = "") {
  const needle = clean(query).toLocaleLowerCase("th-TH");
  if (!needle) return [...items];
  return items.filter(item => [
    item.label,
    item.workId,
    item.checkpointId,
  ].some(value => clean(value).toLocaleLowerCase("th-TH").includes(needle)));
}

function field(form, name) {
  return form?.elements?.namedItem?.(name) || null;
}

function text(node, value, fallback = "—") {
  if (node) node.textContent = clean(value) || fallback;
}

function disable(form, value) {
  if (!form) return;
  for (const element of [...form.elements]) element.disabled = value;
}

export function mountTicketHub({
  root = globalThis.document,
  storage = globalThis.localStorage,
  centreLive,
  getCurrentWork = () => null,
  onWorkChanged = async () => {},
} = {}) {
  const hub = root?.querySelector?.("[data-ticket-hub]");
  if (!hub || !centreLive) return Object.freeze({ refresh() {} });

  const createForm = hub.querySelector("[data-ticket-create-form]");
  const findForm = hub.querySelector("[data-ticket-find-form]");
  const storeForm = hub.querySelector("[data-ticket-store-form]");
  const searchInput = hub.querySelector("[data-ticket-search]");
  const storedList = hub.querySelector("[data-ticket-store-list]");
  const storedEmpty = hub.querySelector("[data-ticket-store-empty]");
  const result = hub.querySelector("[data-ticket-result]");

  const currentWork = hub.querySelector("[data-ticket-current-work]");
  const currentCheckpoint = hub.querySelector("[data-ticket-current-checkpoint]");
  const currentStatus = hub.querySelector("[data-ticket-current-status]");

  function setResult(message, isError = false) {
    if (!result) return;
    result.textContent = clean(message);
    result.dataset.state = isError ? "error" : "ok";
  }

  function renderCurrent() {
    const work = getCurrentWork?.() || null;
    text(currentWork, work?.workId);
    text(currentCheckpoint, work?.checkpointId);
    text(currentStatus, work?.status, "UNKNOWN");
  }

  function createStoredRow(item) {
    const li = root.createElement("li");
    li.className = "ticket-store-item";

    const summary = root.createElement("div");
    const title = root.createElement("strong");
    title.textContent = item.label || item.workId;
    const ids = root.createElement("span");
    ids.textContent = item.workId + " · " + item.checkpointId;
    summary.append(title, ids);

    const actions = root.createElement("div");
    const open = root.createElement("button");
    open.type = "button";
    open.textContent = "เปิด";
    open.dataset.ticketOpen = "true";
    open.dataset.workId = item.workId;
    open.dataset.checkpointId = item.checkpointId;

    const remove = root.createElement("button");
    remove.type = "button";
    remove.textContent = "เอาออก";
    remove.dataset.ticketRemove = "true";
    remove.dataset.workId = item.workId;
    remove.dataset.checkpointId = item.checkpointId;

    actions.append(open, remove);
    li.append(summary, actions);
    return li;
  }

  function renderStored() {
    const items = filterStoredTickets(readStoredTickets(storage), searchInput?.value);
    if (storedList) storedList.replaceChildren(...items.map(createStoredRow));
    if (storedEmpty) storedEmpty.hidden = items.length > 0;
  }

  async function adopt(work, message) {
    await onWorkChanged(work);
    renderCurrent();
    renderStored();
    setResult(message);
  }

  createForm?.addEventListener("submit", async event => {
    event.preventDefault();
    setResult("กำลังสร้างตั๋ว…");
    disable(createForm, true);
    try {
      const task = clean(field(createForm, "ticketTask")?.value);
      const requestedResult = clean(field(createForm, "ticketRequestedResult")?.value);
      const targetId = clean(field(createForm, "ticketTargetId")?.value);
      if (!task || !requestedResult || !targetId) throw new Error("TICKET_CREATE_FIELDS_REQUIRED");

      const fresh = await centreLive.startNew();
      const work = await centreLive.command({
        action:"review",
        workId:fresh.workId,
        checkpointId:fresh.checkpointId,
        returnAddress:fresh.checkpointId,
        task,
        requestedResult,
        authority:"BIG",
        targetId,
      });
      await adopt(work, "สร้างตั๋วแล้ว · Centre เป็น owner truth");
      createForm.reset();
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error), true);
    } finally {
      disable(createForm, false);
    }
  });

  findForm?.addEventListener("submit", async event => {
    event.preventDefault();
    setResult("กำลังค้นจาก Centre…");
    disable(findForm, true);
    try {
      const workId = clean(field(findForm, "ticketWorkId")?.value);
      const checkpointId = clean(field(findForm, "ticketCheckpointId")?.value);
      if (!workId || !checkpointId) throw new Error("TICKET_FIND_IDENTITY_REQUIRED");
      const work = await centreLive.inspect(workId, checkpointId);
      await adopt(work, "พบตั๋วแล้ว · อ่าน owner truth สด");
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error), true);
    } finally {
      disable(findForm, false);
    }
  });

  storeForm?.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const work = getCurrentWork?.();
      const label = clean(field(storeForm, "ticketLabel")?.value);
      const saved = storeTicketPointer(storage, work, label);
      field(storeForm, "ticketLabel").value = "";
      renderStored();
      setResult("จัดเก็บ pointer แล้ว · " + saved.label);
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error), true);
    }
  });

  searchInput?.addEventListener("input", renderStored);

  storedList?.addEventListener("click", async event => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    const workId = clean(button.dataset.workId);
    const checkpointId = clean(button.dataset.checkpointId);

    if (button.dataset.ticketRemove === "true") {
      removeTicketPointer(storage, workId, checkpointId);
      renderStored();
      setResult("เอา pointer ออกจากที่จัดเก็บแล้ว");
      return;
    }

    if (button.dataset.ticketOpen === "true") {
      button.disabled = true;
      setResult("กำลังเปิดตั๋วจาก Centre…");
      try {
        const work = await centreLive.inspect(workId, checkpointId);
        await adopt(work, "เปิดตั๋วแล้ว · owner truth อ่านจาก Centre");
      } catch (error) {
        setResult(error instanceof Error ? error.message : String(error), true);
      } finally {
        button.disabled = false;
      }
    }
  });

  renderCurrent();
  renderStored();

  return Object.freeze({
    refresh() {
      renderCurrent();
      renderStored();
    },
  });
}

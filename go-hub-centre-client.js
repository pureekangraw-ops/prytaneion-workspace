export const CENTRE_POINTER_KEY = "go-hub-centre-live-pointer-v1";
const DEFAULT_ENDPOINT = "/hub/api/centre/action";

function clean(value) {
  return String(value || "").trim();
}

function parsePointer(storage) {
  if (!storage || typeof storage.getItem !== "function") return null;
  const raw = storage.getItem(CENTRE_POINTER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const workId = clean(parsed?.workId);
    const checkpointId = clean(parsed?.checkpointId);
    if (!workId || !checkpointId) throw new Error("invalid pointer");
    return { workId, checkpointId };
  } catch {
    storage.removeItem?.(CENTRE_POINTER_KEY);
    return null;
  }
}

function clearPointer(storage) {
  storage?.removeItem?.(CENTRE_POINTER_KEY);
}

function savePointer(storage, work) {
  if (!storage || typeof storage.setItem !== "function") return;
  const workId = clean(work?.workId);
  const checkpointId = clean(work?.checkpointId);
  if (!workId || !checkpointId) throw new Error("CENTRE_LIVE_IDENTITY_MISSING");
  storage.setItem(CENTRE_POINTER_KEY, JSON.stringify({ workId, checkpointId }));
}

function defaultId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function inspectInput(workId, checkpointId) {
  return {
    action: "inspect",
    workId,
    checkpointId,
    returnAddress: checkpointId,
  };
}

export function createCentreLiveClient({
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  idFactory = defaultId,
  endpoint = DEFAULT_ENDPOINT,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("Centre live fetch is required");
  if (typeof idFactory !== "function") throw new TypeError("Centre live ID factory is required");

  async function post(input) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "CENTRE_LIVE_UNAVAILABLE");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(clean(payload?.code) || `CENTRE_LIVE_HTTP_${response.status}`);
    }
    if (!payload || payload.ok !== true || !payload.work) {
      throw new Error("CENTRE_LIVE_INVALID_RESPONSE");
    }
    savePointer(storage, payload.work);
    return payload;
  }

  async function inspect(workId, checkpointId) {
    return post(inspectInput(workId, checkpointId));
  }

  async function startNew() {
    const id = clean(idFactory());
    if (!id) throw new Error("CENTRE_LIVE_ID_FACTORY_EMPTY");
    const workId = `WORK-${id}`;
    const checkpointId = `CENTRE-${id}`;
    const started = await post({
      action: "start",
      workId,
      checkpointId,
      returnAddress: checkpointId,
    });
    const readback = await inspect(started.workId, started.checkpointId);
    return readback.work;
  }

  return Object.freeze({
    async inspect(workId, checkpointId) {
      return (await inspect(workId, checkpointId)).work;
    },

    startNew,

    async restoreOrStart() {
      const pointer = parsePointer(storage);
      if (pointer) {
        try {
          return (await inspect(pointer.workId, pointer.checkpointId)).work;
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "CENTRE_WORK_NOT_FOUND") throw error;
          clearPointer(storage);
        }
      }
      return startNew();
    },

    async command(input = {}) {
      const changed = await post(input);
      const workId = clean(changed.workId || changed.work?.workId);
      const checkpointId = clean(changed.checkpointId || changed.work?.checkpointId);
      const readback = await inspect(workId, checkpointId);
      if (readback.workId !== workId || readback.checkpointId !== checkpointId) {
        throw new Error("CENTRE_LIVE_READBACK_IDENTITY_MISMATCH");
      }
      return readback.work;
    },
  });
}

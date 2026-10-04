const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function clean(value) {
  return String(value ?? "").trim();
}

function validRequestId(value) {
  const id = clean(value);
  return REQUEST_ID_PATTERN.test(id) ? id : null;
}

function invalidPacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return "PIXIE_APPROVED_PACKET_REQUIRED";
  if (clean(packet.approval).toUpperCase() !== "APPROVED") return "PIXIE_APPROVAL_REQUIRED";
  if (!clean(packet.approvedVersionId)) return "PIXIE_APPROVED_VERSION_REQUIRED";
  if (!packet.scene || typeof packet.scene !== "object" || Array.isArray(packet.scene)) return "PIXIE_SCENE_REQUIRED";
  return null;
}

async function readJson(response) {
  return response?.json ? response.json().catch(() => ({})) : {};
}

function monitorStub(binding, requestId) {
  if (!binding || typeof binding.idFromName !== "function" || typeof binding.get !== "function") return null;
  const id = binding.idFromName(requestId);
  return binding.get(id);
}

export function createPixiePreviewBridge({ pixie, monitorBinding } = {}) {
  if (!pixie || typeof pixie.command !== "function" || typeof pixie.result !== "function") {
    throw new Error("PIXIE_COMMAND_SERVICE_REQUIRED");
  }

  return Object.freeze({
    async dispatch({ requestId, packet } = {}) {
      const id = validRequestId(requestId);
      if (!id) return { ok: false, status: 400, code: "PIXIE_REQUEST_ID_INVALID" };
      const packetError = invalidPacket(packet);
      if (packetError) return { ok: false, status: 400, code: packetError };
      const stub = monitorStub(monitorBinding, id);
      if (!stub || typeof stub.fetch !== "function") {
        return { ok: false, status: 503, code: "PIXIE_MONITOR_NOT_CONFIGURED" };
      }

      const commandResponse = await pixie.command({
        requestId: id,
        command: "ui_scene_render",
        args: {
          requestId: id,
          previewId: clean(packet.previewId) || id,
          packetId: clean(packet.packetId) || null,
          designId: clean(packet.designId) || null,
          workId: clean(packet.workId) || null,
          approvedVersionId: clean(packet.approvedVersionId),
          approval: "APPROVED",
          scene: packet.scene,
        },
      });
      const commandBody = await readJson(commandResponse);
      if (!commandResponse?.ok || commandBody?.ok !== true) {
        return {
          ok: false,
          status: commandResponse?.status || 502,
          code: commandBody?.code || "PIXIE_DISPATCH_FAILED",
          dispatch: commandBody,
        };
      }

      const watchResponse = await stub.fetch(new Request("https://pixie-monitor.internal/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: id,
          workContext: {
            previewId: clean(packet.previewId) || id,
            packetId: clean(packet.packetId) || null,
            designId: clean(packet.designId) || null,
            workId: clean(packet.workId) || null,
            approvedVersionId: clean(packet.approvedVersionId),
          },
        }),
      }));
      const watchBody = await readJson(watchResponse);
      if (!watchResponse?.ok || watchBody?.ok !== true) {
        return {
          ok: false,
          status: watchResponse?.status || 502,
          code: watchBody?.code || "PIXIE_MONITOR_WATCH_FAILED",
          dispatch: commandBody,
          monitor: watchBody,
        };
      }
      return {
        ok: true,
        status: 202,
        state: "QUEUED",
        requestId: id,
        approvedVersionId: clean(packet.approvedVersionId),
        command: "ui_scene_render",
        dispatch: commandBody,
        monitor: watchBody,
      };
    },

    async read({ requestId } = {}) {
      const id = validRequestId(requestId);
      if (!id) return { ok: false, status: 400, code: "PIXIE_REQUEST_ID_INVALID" };
      const stub = monitorStub(monitorBinding, id);
      if (!stub || typeof stub.fetch !== "function") {
        return { ok: false, status: 503, code: "PIXIE_MONITOR_NOT_CONFIGURED" };
      }
      const response = await stub.fetch(new Request(
        `https://pixie-monitor.internal/read?requestId=${encodeURIComponent(id)}`,
      ));
      const body = await readJson(response);
      if (!response?.ok || body?.ok !== true) {
        return { ok: false, status: response?.status || 502, code: body?.code || "PIXIE_MONITOR_READ_FAILED" };
      }
      return { ok: true, status: 200, requestId: id, watch: body.watch || null };
    },
  });
}
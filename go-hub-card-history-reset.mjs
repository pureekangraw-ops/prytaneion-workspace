function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{ "content-type":"application/json; charset=utf-8" },
  });
}

function text(value) { return String(value ?? "").trim(); }

async function body(response) {
  return response?.clone ? response.clone().json().catch(() => ({})) : {};
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length:Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

function compactPin(pin = {}) {
  return {
    pinId:text(pin.pinId) || null,
    workId:text(pin.workId) || null,
    canonicalWorkId:text(pin.canonicalWorkId) || null,
    jobCode:text(pin.jobCode || pin.card?.jobCode) || null,
    boardStatus:text(pin.status) || null,
    title:text(pin.title) || null,
    detail:text(pin.detail) || null,
    ownerEmployeeId:text(pin.ownerEmployeeId) || null,
    result:pin.result ?? null,
    nextAction:pin.nextAction ?? null,
    evidence:Array.isArray(pin.evidence) ? structuredClone(pin.evidence) : [],
    links:Array.isArray(pin.links) ? structuredClone(pin.links) : [],
    revision:Number.isSafeInteger(pin.revision) ? pin.revision : null,
    createdAt:text(pin.createdAt) || null,
    updatedAt:text(pin.updatedAt) || null,
    card:pin.card && typeof pin.card === "object" ? structuredClone(pin.card) : null,
  };
}

export function createCardHistoryResetService({ boardRead, centreLive, drive, now = () => new Date().toISOString() } = {}) {
  if (typeof boardRead !== "function") throw new Error("CARD_HISTORY_BOARD_READER_REQUIRED");
  if (!centreLive || typeof centreLive.action !== "function") throw new Error("CARD_HISTORY_CENTRE_REQUIRED");
  if (!drive || typeof drive.uploadFileBytes !== "function") throw new Error("CARD_HISTORY_DRIVE_REQUIRED");

  async function inspect(pin) {
    const workId = text(pin?.workId);
    const checkpointId = text(pin?.card?.checkpointId || pin?.checkpointId);
    if (!workId || !checkpointId) {
      return { ok:false, workId:workId || null, checkpointId:checkpointId || null, code:"CARD_HISTORY_IDENTITY_INCOMPLETE" };
    }
    const response = await centreLive.action({ action:"v4_mission_get", workId, checkpointId });
    const payload = await body(response);
    if (!response?.ok || payload?.ok !== true || payload?.work?.workId !== workId ||
        text(payload?.work?.checkpointId) !== checkpointId) {
      return { ok:false, workId, checkpointId, code:text(payload?.code) || "CARD_HISTORY_OWNER_READ_FAILED" };
    }
    const memory = payload?.mission?.memory || {};
    const machine = memory?.cardMachine || {};
    return {
      ok:true,
      workId,
      checkpointId,
      work:{
        status:text(payload.work.status) || null,
        holder:text(payload.work.holder) || null,
        lastUpdated:text(payload.work.lastUpdated) || null,
      },
      pin:compactPin(pin),
      currentCard:machine.current && typeof machine.current === "object" ? structuredClone(machine.current) : null,
      returnHistory:Array.isArray(memory.returnHistory) ? structuredClone(memory.returnHistory) : [],
      cardAudit:Array.isArray(machine.audit) ? structuredClone(machine.audit) : [],
      previousReset:memory.cardHistoryReset && typeof memory.cardHistoryReset === "object"
        ? structuredClone(memory.cardHistoryReset)
        : null,
    };
  }

  async function archiveAndReset(input = {}) {
    const parentId = text(input.parentId);
    const name = text(input.name) || ("GO-HUB-CARD-HISTORY-PRE-RESET-" + now().slice(0, 10).replaceAll("-", "") + ".json");
    const operatorWorkId = text(input?.workContext?.workId);
    if (!parentId || !operatorWorkId) return json({ code:"CARD_HISTORY_ARCHIVE_DESTINATION_REQUIRED" }, 400);

    const boardResponse = await boardRead();
    const board = await body(boardResponse);
    if (!boardResponse?.ok || board?.ok !== true || !Array.isArray(board.pins)) {
      return json({ code:"CARD_HISTORY_BOARD_READ_FAILED" }, 502);
    }

    const inspected = await mapLimit(board.pins, 12, inspect);
    const failures = inspected.filter(item => !item.ok);
    if (failures.length) {
      return json({
        code:"CARD_HISTORY_PRE_RESET_SNAPSHOT_INCOMPLETE",
        resetStarted:false,
        failureCount:failures.length,
        failures:failures.slice(0, 25),
      }, 409);
    }

    const archivedAt = now();
    const archive = {
      kind:"GO_HUB_CARD_HISTORY_ARCHIVE",
      version:2,
      purpose:"PRE_RESET_BACKUP",
      archivedAt,
      source:{
        boardId:text(board.boardId) || null,
        boardRevision:Number.isSafeInteger(board.revision) ? board.revision : null,
        ownerSource:"CENTRE_DURABLE_STORE",
      },
      policy:{
        archiveBeforeReset:true,
        preserveCentreOwnerTruth:true,
        preserveCurrentCard:true,
        preserveLatestReality:true,
        clear:["mission.memory.returnHistory","mission.memory.cardMachine.audit"],
      },
      counts:{
        works:inspected.length,
        returnHistoryEntries:inspected.reduce((sum, item) => sum + item.returnHistory.length, 0),
        cardAuditEntries:inspected.reduce((sum, item) => sum + item.cardAudit.length, 0),
        legacyCardIds:inspected.filter(item => /^CARD:/i.test(text(item.currentCard?.cardId || item.pin?.card?.cardId))).length,
      },
      records:inspected.map(({ ok, ...item }) => item),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(archive, null, 2));
    const sha256 = await sha256Hex(bytes);
    const uploaded = await drive.uploadFileBytes({
      parentId,
      name,
      mimeType:"application/json",
      bytes,
      sha256,
      appProperties:{
        goHubSource:"card-history-pre-reset",
        goHubWorkId:operatorWorkId,
        sha256,
        archiveKind:"GO_HUB_CARD_HISTORY_ARCHIVE",
      },
    });
    const uploadBody = await body(uploaded);
    if (!uploaded?.ok || uploadBody?.readback !== "PASS" || !text(uploadBody?.item?.id)) {
      return json({
        code:"CARD_HISTORY_DRIVE_ARCHIVE_NOT_VERIFIED",
        resetStarted:false,
        sha256,
        drive:uploadBody,
      }, 502);
    }

    const archiveRef = "gdrive://" + uploadBody.item.id;
    const resetAt = now();
    const resetResults = await mapLimit(inspected, 10, async entry => {
      const response = await centreLive.action({
        action:"v4_mission_history_reset",
        workId:entry.workId,
        checkpointId:entry.checkpointId,
        archiveRef,
        archiveSha256:sha256,
        resetAt,
        actor:"BIG",
      });
      const payload = await body(response);
      return {
        ok:Boolean(response?.ok && payload?.ok === true),
        workId:entry.workId,
        checkpointId:entry.checkpointId,
        code:text(payload?.code) || null,
        idempotent:payload?.idempotent === true,
      };
    });
    const resetFailures = resetResults.filter(item => !item.ok);
    if (resetFailures.length) {
      return json({
        code:"CARD_HISTORY_RESET_PARTIAL",
        archive:{ fileId:uploadBody.item.id, ref:archiveRef, sha256, readback:"PASS" },
        resetStarted:true,
        resetCount:resetResults.length - resetFailures.length,
        failureCount:resetFailures.length,
        failures:resetFailures.slice(0, 25),
      }, 502);
    }

    const verified = await mapLimit(inspected, 12, async entry => {
      const response = await centreLive.action({ action:"v4_mission_get", workId:entry.workId, checkpointId:entry.checkpointId });
      const payload = await body(response);
      const memory = payload?.mission?.memory || {};
      const machine = memory?.cardMachine || {};
      const sameCard = text(machine.current?.cardId) === text(entry.currentCard?.cardId);
      const sameWork = text(payload?.work?.status) === text(entry.work.status) &&
        text(payload?.work?.holder) === text(entry.work.holder) &&
        text(payload?.work?.lastUpdated) === text(entry.work.lastUpdated);
      return {
        workId:entry.workId,
        ok:Boolean(response?.ok && payload?.ok === true &&
          Array.isArray(memory.returnHistory) && memory.returnHistory.length === 0 &&
          Array.isArray(machine.audit) && machine.audit.length === 0 &&
          sameCard && sameWork &&
          text(memory.cardHistoryReset?.archiveRef) === archiveRef &&
          text(memory.cardHistoryReset?.archiveSha256).toLowerCase() === sha256),
      };
    });
    const verifyFailures = verified.filter(item => !item.ok);
    if (verifyFailures.length) {
      return json({
        code:"CARD_HISTORY_RESET_READBACK_FAILED",
        archive:{ fileId:uploadBody.item.id, ref:archiveRef, sha256, readback:"PASS" },
        resetCount:resetResults.length,
        verifyFailureCount:verifyFailures.length,
        failures:verifyFailures.slice(0, 25),
      }, 502);
    }

    return json({
      ok:true,
      action:"archive_and_reset",
      archive:{
        fileId:uploadBody.item.id,
        name:uploadBody.item.name,
        ref:archiveRef,
        sha256,
        size:bytes.byteLength,
        readback:"PASS",
      },
      source:{
        boardId:archive.source.boardId,
        boardRevision:archive.source.boardRevision,
      },
      counts:archive.counts,
      reset:{
        works:resetResults.length,
        returnHistoryEntriesNow:0,
        cardAuditEntriesNow:0,
        currentCardsPreserved:true,
        centreOwnerTruthPreserved:true,
        readback:"PASS",
      },
    });
  }

  return Object.freeze({ archiveAndReset });
}

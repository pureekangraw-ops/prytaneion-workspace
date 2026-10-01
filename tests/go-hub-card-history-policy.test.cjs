"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const moduleUrl = pathToFileURL(path.resolve(__dirname, "../go-hub-card-history-policy.mjs")).href;

test("Card history epoch keeps current records and preserves exact archive reference", async () => {
  const { CARD_HISTORY_RESET, currentCardHistoryPins, cardHistoryPolicyView } =
    await import(moduleUrl + "?policy=" + Date.now());

  const pins = [
    { workId:"WORK-BEFORE", updatedAt:"2026-09-30T23:59:59.000Z" },
    { workId:"WORK-AFTER", updatedAt:"2026-10-01T02:12:00.000Z" },
  ];
  assert.deepEqual(currentCardHistoryPins(pins).map(item => item.workId), ["WORK-AFTER"]);

  const view = cardHistoryPolicyView(CARD_HISTORY_RESET);
  assert.equal(view.mode, "LOGICAL_RESET");
  assert.equal(view.archivedCards, 249);
  assert.equal(view.preserveOwnerTruth, true);
  assert.equal(view.preserveExactLegacyLookup, true);
  assert.equal(view.archiveRef, "gdrive://1DiOsl3wt7Tch_qMQMrgIk-hWx_FIHpzz");
  assert.equal(view.archiveSha256, "54b4cc38703e7fdd63adb4c1bbd8b00e82489fd282a9497b62e79802258a4fb3");
});

export const CARD_HISTORY_RESET = Object.freeze({
  version: 1,
  resetAt: "2026-10-01T02:11:13.731Z",
  archiveRef: "gdrive://1DiOsl3wt7Tch_qMQMrgIk-hWx_FIHpzz",
  archiveSha256: "54b4cc38703e7fdd63adb4c1bbd8b00e82489fd282a9497b62e79802258a4fb3",
  archiveName: "GO-HUB-CARD-HISTORY-PRE-RESET-20261001.json",
  archivedCards: 249,
  mode: "LOGICAL_RESET",
  preserveOwnerTruth: true,
  preserveExactLegacyLookup: true,
});

function time(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function cardHistoryTimestamp(pin = {}) {
  return pin.updatedAt ||
    pin.card?.lastUpdated ||
    pin.createdAt ||
    pin.card?.createdAt ||
    null;
}

export function isCurrentCardHistoryPin(pin = {}, policy = CARD_HISTORY_RESET) {
  const resetAt = time(policy?.resetAt);
  const observedAt = time(cardHistoryTimestamp(pin));
  if (resetAt == null || observedAt == null) return false;
  return observedAt >= resetAt;
}

export function currentCardHistoryPins(pins = [], policy = CARD_HISTORY_RESET) {
  return (Array.isArray(pins) ? pins : []).filter(pin => isCurrentCardHistoryPin(pin, policy));
}

export function cardHistoryPolicyView(policy = CARD_HISTORY_RESET) {
  return {
    version: policy.version,
    resetAt: policy.resetAt,
    archiveRef: policy.archiveRef,
    archiveSha256: policy.archiveSha256,
    archiveName: policy.archiveName,
    archivedCards: policy.archivedCards,
    mode: policy.mode,
    preserveOwnerTruth: policy.preserveOwnerTruth === true,
    preserveExactLegacyLookup: policy.preserveExactLegacyLookup === true,
  };
}

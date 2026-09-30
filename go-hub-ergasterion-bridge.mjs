const text = (value) => String(value ?? '').trim();
const required = (value, label) => {
  const result = text(value);
  if (!result) throw new Error(`${label} is required`);
  return result;
};
const unique = (values = []) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
const clone = (value) => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();

export const HUB_FACTORY_PROTOCOL = 'GO_HUB_ERGASTERION_FACTORY_V1';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createErgasterionFactoryHandoff({
  handoffId,
  workContext,
  requestedResult,
  experimentId = null,
  variantId = null,
  candidateRefs = [],
  artifactRefs = [],
  evidenceRefs = [],
  unknowns = [],
  now = nowIso,
} = {}) {
  const workId = required(workContext?.workId, 'workContext.workId');
  const checkpointId = required(workContext?.checkpointId, 'workContext.checkpointId');
  return freeze({
    protocol: HUB_FACTORY_PROTOCOL,
    handoffId: required(handoffId, 'handoffId'),
    source: 'PRYTANEION',
    destination: 'ERGASTERION',
    workId,
    checkpointId,
    experimentId: text(experimentId) || null,
    variantId: text(variantId) || null,
    requestedResult: required(requestedResult, 'requestedResult'),
    candidateRefs: unique(candidateRefs),
    artifactRefs: unique(artifactRefs),
    evidenceRefs: unique(evidenceRefs),
    unknowns: unique(unknowns),
    authorityTransferred: false,
    routeAuthorityCreated: false,
    approval: 'NOT_AN_APPROVAL',
    sentAt: now(),
  });
}

export function verifyErgasterionFactoryReadback({ handoff, readback } = {}) {
  if (!handoff || handoff.protocol !== HUB_FACTORY_PROTOCOL) throw new Error('HUB_FACTORY_HANDOFF_REQUIRED');
  if (!readback || readback.protocol !== HUB_FACTORY_PROTOCOL) throw new Error('ERGASTERION_READBACK_PROTOCOL_INVALID');
  for (const field of ['handoffId', 'workId', 'checkpointId']) {
    if (text(readback[field]) !== text(handoff[field])) throw new Error(`ERGASTERION_READBACK_${field.toUpperCase()}_MISMATCH`);
  }
  if (text(readback.source) !== 'ERGASTERION' || text(readback.destination) !== 'PRYTANEION') {
    throw new Error('ERGASTERION_READBACK_ROUTE_INVALID');
  }
  return freeze({
    ok: true,
    protocol: HUB_FACTORY_PROTOCOL,
    handoffId: handoff.handoffId,
    workId: handoff.workId,
    checkpointId: handoff.checkpointId,
    status: text(readback.status) || 'UNKNOWN',
    artifactRefs: unique(readback.artifactRefs),
    evidenceRefs: unique(readback.evidenceRefs),
    unknowns: unique(readback.unknowns),
    result: clone(readback.result),
    authorityTransferred: false,
    routeAuthorityCreated: false,
    approval: 'NOT_AN_APPROVAL',
  });
}

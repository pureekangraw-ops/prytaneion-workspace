'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

async function mod() { return import('../go-hub-ergasterion-bridge.mjs'); }

const workContext = { workId: 'WORK-HUB-001', checkpointId: 'CP-HUB-001' };

test('Hub creates a bounded ERGASTERION handoff without transferring authority', async () => {
  const { createErgasterionFactoryHandoff } = await mod();
  const handoff = createErgasterionFactoryHandoff({
    handoffId: 'HANDOFF-001',
    workContext,
    requestedResult: 'Return Factory candidate and evidence',
    experimentId: 'EXP-001',
    variantId: 'VAR-001',
    candidateRefs: ['candidate://one'],
  });
  assert.equal(handoff.protocol, 'GO_HUB_ERGASTERION_FACTORY_V1');
  assert.equal(handoff.source, 'PRYTANEION');
  assert.equal(handoff.destination, 'ERGASTERION');
  assert.equal(handoff.workId, workContext.workId);
  assert.equal(handoff.checkpointId, workContext.checkpointId);
  assert.equal(handoff.authorityTransferred, false);
  assert.equal(handoff.routeAuthorityCreated, false);
  assert.equal(handoff.approval, 'NOT_AN_APPROVAL');
});

test('Hub accepts only an identity-preserving ERGASTERION readback', async () => {
  const { createErgasterionFactoryHandoff, verifyErgasterionFactoryReadback } = await mod();
  const handoff = createErgasterionFactoryHandoff({
    handoffId: 'HANDOFF-002', workContext, requestedResult: 'Return evidence',
  });
  const proof = verifyErgasterionFactoryReadback({
    handoff,
    readback: {
      protocol: handoff.protocol,
      handoffId: handoff.handoffId,
      source: 'ERGASTERION',
      destination: 'PRYTANEION',
      workId: handoff.workId,
      checkpointId: handoff.checkpointId,
      status: 'READY_FOR_PRODUCTION_EVIDENCE',
      artifactRefs: ['artifact://one'],
      evidenceRefs: ['evidence://one'],
      unknowns: ['runtime not observed'],
      result: { candidate: 'artifact://one' },
    },
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.status, 'READY_FOR_PRODUCTION_EVIDENCE');
  assert.equal(proof.workId, workContext.workId);
  assert.equal(proof.checkpointId, workContext.checkpointId);
  assert.equal(proof.authorityTransferred, false);
  assert.throws(() => verifyErgasterionFactoryReadback({
    handoff,
    readback: { protocol: handoff.protocol, handoffId: handoff.handoffId, source: 'ERGASTERION', destination: 'PRYTANEION', workId: 'OTHER', checkpointId: handoff.checkpointId },
  }), /WORKID_MISMATCH/);
});

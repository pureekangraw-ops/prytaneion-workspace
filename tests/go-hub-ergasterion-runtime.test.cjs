'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

async function mod() {
  return import('../go-hub-ergasterion-runtime.mjs');
}

test('ERGASTERION runtime health reads the Factory transport endpoint', async () => {
  const { createErgasterionRuntime } = await mod();
  const runtime = createErgasterionRuntime({
    endpoint:'https://factory.example',
    secret:'shared',
    fetchImpl:async (url, options) => {
      assert.equal(String(url), 'https://factory.example/api/hub-factory/health');
      assert.equal(options.method, 'GET');
      return Response.json({ ok:true, authenticatedTransport:true });
    },
  });
  const response = await runtime.health();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok:true, authenticatedTransport:true });
});

test('ERGASTERION runtime sends signed work-bound handoff and verifies receipt identity', async () => {
  const { createErgasterionRuntime } = await mod();
  const runtime = createErgasterionRuntime({
    endpoint:'https://factory.example/',
    secret:'shared-secret',
    fetchImpl:async (url, options) => {
      assert.equal(String(url), 'https://factory.example/api/hub-factory/receive');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-go-hub-protocol'], 'GO_HUB_ERGASTERION_FACTORY_V1');
      assert.ok(options.headers['x-go-hub-signature']);
      assert.ok(options.headers['x-go-hub-timestamp']);
      const body = JSON.parse(options.body);
      assert.equal(body.source, 'PRYTANEION');
      assert.equal(body.destination, 'ERGASTERION');
      assert.equal(body.workId, 'WORK-1');
      assert.equal(body.checkpointId, 'CP-1');
      return Response.json({
        ok:true,
        protocol:body.protocol,
        handoffId:body.handoffId,
        source:'ERGASTERION',
        destination:'PRYTANEION',
        workId:body.workId,
        checkpointId:body.checkpointId,
        status:'RECEIVED',
        evidenceRefs:['factory-receipt://HANDOFF-1'],
        authorityTransferred:false,
        routeAuthorityCreated:false,
        approval:'NOT_AN_APPROVAL',
      });
    },
  });
  const response = await runtime.handoff({
    handoffId:'HANDOFF-1',
    workContext:{ workId:'WORK-1', checkpointId:'CP-1' },
    requestedResult:'Return authenticated receipt',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'RECEIVED');
  assert.equal(body.verified.workId, 'WORK-1');
  assert.equal(body.transport.authenticated, true);
});

test('ERGASTERION runtime refuses missing endpoint or secret', async () => {
  const { createErgasterionRuntime } = await mod();
  const noEndpoint = createErgasterionRuntime({ secret:'x' });
  assert.equal((await noEndpoint.health()).status, 503);

  const noSecret = createErgasterionRuntime({ endpoint:'https://factory.example' });
  const response = await noSecret.handoff({
    handoffId:'H',
    workContext:{ workId:'W', checkpointId:'CP' },
    requestedResult:'R',
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'ERGASTERION_HUB_SHARED_SECRET_NOT_CONFIGURED');
});

const test = require('node:test');
const assert = require('node:assert/strict');

test('Hub transport signs and retries transient Factory responses', async () => {
  const { sendErgasterionFactoryHandoff } = await import('../go-hub-ergasterion-transport.mjs');
  let calls = 0;
  const result = await sendErgasterionFactoryHandoff({ endpoint:'https://factory.example', secret:'secret', handoff:{protocol:'GO_HUB_ERGASTERION_FACTORY_V1',handoffId:'H',workId:'W',checkpointId:'CP'}, retries:1, fetchImpl: async (_url, options) => { calls += 1; assert.equal(options.headers['x-go-hub-protocol'], 'GO_HUB_ERGASTERION_FACTORY_V1'); assert.ok(options.headers['x-go-hub-signature']); return { ok:calls === 2, status:calls === 1 ? 503 : 200, json:async()=>({ ok:true }) }; } });
  assert.equal(result.ok, true); assert.equal(calls, 2);
});

test('Hub transport requires a secret', async () => {
  const { sendErgasterionFactoryHandoff } = await import('../go-hub-ergasterion-transport.mjs');
  await assert.rejects(() => sendErgasterionFactoryHandoff({ endpoint:'https://factory.example', handoff:{} }), /SECRET_REQUIRED/);
});

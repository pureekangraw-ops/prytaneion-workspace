const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('METRO exposes a Work-bound direct PRISM readback route', () => {
  const gate = read('go-hub-office-gate.mjs');
  const edge = read('go-hub-edge-worker.mjs');
  const shell = read('go-hub-metro-shell.mjs');
  const surface = read('go-hub-metro-surface.js');

  assert.match(gate, /\/office\/api\/prism\/latest/);
  assert.match(gate, /prismEye\.latest\(\{\s*workContext:\s*\{\s*workId, checkpointId\s*\}\s*\}\)/);
  assert.match(gate, /source:"PRISM_BROWSER"/);
  assert.match(edge, /createPrismEyeService/);
  assert.match(edge, /prismEye,/);
  assert.match(shell, /PRISM BROWSER · LIVE READBACK/);
  assert.match(surface, /\/office\/api\/prism\/latest\?/);
  assert.match(surface, /evidenceLive===true/);
  assert.doesNotMatch(surface, /\/office\/api\/eye\/refresh/);
});

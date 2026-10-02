const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'go-hub-sw.js'), 'utf8');
const release = JSON.parse(fs.readFileSync(path.join(root, 'RELEASE_MANIFEST.json'), 'utf8'));

test('GO Hub hard cutover owns a fresh cache generation and activates immediately', () => {
  assert.match(sw, /const CACHE_PREFIX = "go-hub-app-";/,
    'hard cutover requires the dedicated GO Hub cache namespace');
  assert.match(sw, /v13-control-owner-surface/,
    'CONTROL owner surface publication requires its own cache generation');
  assert.match(sw, /skipWaiting\(\)/,
    'hard cutover intentionally activates the new GO Hub worker');
  assert.match(sw, /clients\.claim\(\)/,
    'hard cutover intentionally claims active GO Hub clients');
  assert.equal(release.serviceWorker.file, 'go-hub-sw.js');
  assert.equal(release.serviceWorker.autoActivate, true);
  assert.equal(release.serviceWorker.cachePrefix, 'go-hub-app-');
  assert.doesNotMatch(sw, /ygph-standard-app-/);
});

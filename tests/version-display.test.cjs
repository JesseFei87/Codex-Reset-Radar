const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('renders the packaged app version instead of a stale hard-coded release', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.doesNotMatch(app, /v0\.7\.2/);
  assert.match(app, /v\{appVersion\}/);
  assert.match(main, /version: app\.getVersion\(\)/);
});

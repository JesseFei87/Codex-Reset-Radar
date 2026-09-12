const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SnapshotStore, detectEvents } = require('../electron/snapshot-store.cjs');

function account({ used = 80, resetsAt = '2026-08-24T00:00:00Z', credits = 1, cards = [] } = {}) {
  return { plan: 'plus', remainingPercent: 100 - used, nextNaturalReset: resetsAt, resetCreditAvailableCount: credits, cards, usageWindows: [{ id: 'codex:primary', label: '每周额度', usedPercent: used, remainingPercent: 100 - used, windowDurationMins: 10080, resetsAt }] };
}

test('stores sanitized snapshots without account credentials or content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-history-'));
  const store = new SnapshotStore(directory);
  store.record({ ...account(), token: 'secret', prompt: 'private' }, '2026-08-23T00:00:00Z');
  const history = store.history();
  assert.equal(history.snapshots.length, 1);
  assert.equal(history.snapshots[0].plan, 'plus');
  assert.equal('token' in history.snapshots[0], false);
  assert.equal('prompt' in history.snapshots[0], false);
});

test('detects a confirmed reset-credit consumption from inventory and window movement', () => {
  const before = new SnapshotStore('/tmp').sanitize(account({ used: 90, credits: 1 }), '2026-08-23T00:00:00Z');
  const after = new SnapshotStore('/tmp').sanitize(account({ used: 5, credits: 0, resetsAt: '2026-08-30T00:00:00Z' }), '2026-08-23T00:05:00Z');
  const events = detectEvents(before, after);
  assert.ok(events.some((event) => event.type === 'window-reset'));
  assert.ok(events.some((event) => event.type === 'credit-consumed'));
});

test('does not classify an unexplained credit decrease as consumption', () => {
  const store = new SnapshotStore('/tmp');
  const before = store.sanitize(account({ used: 30, credits: 1 }), '2026-08-23T00:00:00Z');
  const after = store.sanitize(account({ used: 35, credits: 0 }), '2026-08-23T00:05:00Z');
  const events = detectEvents(before, after);
  assert.equal(events.at(-1).type, 'credit-decrease-unknown');
});

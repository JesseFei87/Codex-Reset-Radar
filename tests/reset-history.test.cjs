const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmedCalendarRecords } = require('../electron/reset-history.cjs');

test('excludes manual and personal app-server window resets from the calendar', () => {
  const events = confirmedCalendarRecords([
    { id: 'window-reset:1', at: '2026-08-24T13:57:56.605Z', source: 'Codex app-server' },
    { id: 'manual-1', at: '2026-08-24T13:59:21.400Z', source: '手动确认' },
    { id: 'manual-2', at: '2026-08-24T13:59:22.933Z', source: '手动确认' },
  ]);
  assert.equal(events.length, 0);
});

test('keeps only the Tibo confirmation when a manual placeholder exists', () => {
  const events = confirmedCalendarRecords([
    { id: 'manual-1', at: '2026-08-23T16:00:51.852Z', source: '手动确认' },
    { id: 'tibo-reset-1', at: '2026-08-24T00:46:51.000Z', source: 'Tibo @thsottiaux 公告', url: 'https://x.com/thsottiaux/status/1' },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].at, '2026-08-24T00:46:51.000Z');
  assert.equal(events[0].url, 'https://x.com/thsottiaux/status/1');
});

test('keeps separate events on the same day when neither is a manual placeholder', () => {
  const events = confirmedCalendarRecords([
    { id: 'tibo-reset-1', at: '2026-08-24T00:46:51.000Z', source: 'Tibo @thsottiaux 公告' },
    { id: 'window-reset:1', at: '2026-08-24T13:57:56.605Z', source: 'Codex app-server' },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'tibo-reset');
});

test('shows only Tibo confirmations and reset-credit grants', () => {
  const events = confirmedCalendarRecords([
    { id: 'tibo-reset-1', at: '2026-08-01T03:32:37Z', source: 'Tibo @thsottiaux 公告' },
    { id: 'tibo-reset-2', at: '2026-08-08T20:29:22Z', source: 'Tibo @thsottiaux 公告' },
    { id: 'tibo-reset-3', at: '2026-08-11T00:28:16Z', source: 'Tibo @thsottiaux 公告' },
    { id: 'tibo-reset-4', at: '2026-08-22T00:50:36Z', source: 'Tibo @thsottiaux 公告' },
    { id: 'manual-early', at: '2026-08-23T16:00:51Z', source: '手动确认' },
    { id: 'tibo-reset-5', at: '2026-08-24T00:46:51Z', source: 'Tibo @thsottiaux 公告' },
    { id: 'window-reset:1', at: '2026-08-24T13:57:56Z', source: 'Codex app-server' },
    { id: 'manual-late', at: '2026-08-24T13:59:21Z', source: '手动确认' },
    { id: 'credit-grant:1', type: 'credit-grant', at: '2026-08-25T02:00:00Z', source: 'Codex app-server', label: '获得 1 张重置卡', count: 1 },
  ]);
  assert.equal(events.length, 6);
  assert.equal(events.at(-1).kind, 'credit-grant');
  assert.equal(events.at(-1).label, '获得 1 张重置卡');
});

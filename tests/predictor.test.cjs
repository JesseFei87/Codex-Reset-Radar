const test = require('node:test');
const assert = require('node:assert/strict');
const { predict } = require('../electron/predictor.cjs');

test('strong recent Tibo signals and an overdue cycle produce a high probability', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const signals = Array.from({ length: 8 }, (_, index) => ({
    source: 'X',
    author: '@thsottiaux',
    authority: 'codex-lead',
    confidence: 0.9,
    publishedAt: new Date(now.getTime() - index * 36e5).toISOString(),
  }));
  const resets = ['2026-07-20', '2026-07-30', '2026-08-09'].map((at) => ({ at }));
  const result = predict({ signals, resets, now });
  assert.equal(result.level, '高概率');
  assert.ok(result.probability >= 70);
  assert.equal(result.evidenceCount, 8);
});

test('stale signals are ignored', () => {
  const now = new Date('2026-08-20T12:00:00Z');
  const result = predict({
    signals: [{ source: 'X', confidence: 1, publishedAt: '2026-08-01T00:00:00Z' }],
    resets: [{ at: '2026-08-19T00:00:00Z' }],
    now,
  });
  assert.equal(result.evidenceCount, 0);
  assert.equal(result.level, '低概率');
});

test('a recent confirmed Tibo statement becomes confirmed Beijing-time evidence', () => {
  const now = new Date('2026-08-23T18:30:00Z');
  const result = predict({
    signals: [{ source: 'X', author: '@thsottiaux', authority: 'codex-lead', evidenceKind: 'confirmed', confidence: 1, publishedAt: '2026-08-23T18:00:00Z' }],
    resets: [],
    now,
  });
  assert.equal(result.level, '已确认');
  assert.equal(result.probability, 100);
  assert.match(result.window, /8月24日 02:00/);
  assert.match(result.reason, /不是未来时间推算/);
});

test('a scheduled Tibo statement supplies the Beijing prediction deadline', () => {
  const now = new Date('2026-08-23T18:30:00Z');
  const result = predict({
    signals: [{ source: 'X', author: '@thsottiaux', authority: 'codex-lead', evidenceKind: 'scheduled', confidence: 0.98, publishedAt: '2026-08-23T18:00:00Z', expectedResetAt: '2026-08-25T06:59:59Z' }],
    resets: [],
    now,
  });
  assert.equal(result.level, '高概率');
  assert.ok(result.probability >= 92);
  assert.equal(result.deadline, '2026-08-25T06:59:59.000Z');
  assert.match(result.window, /北京时间/);
});

test('clusters independent Xiaohongshu reposts without treating them as official confirmation', () => {
  const now = new Date('2026-09-12T04:00:00Z');
  const result = predict({ signals: ['观察站', '小灵通', '开发者'].map((author, index) => ({ source: '小红书', author, authority: 'community', evidenceKind: 'scheduled', confidence: 0.72, publishedAt: '2026-09-12T04:00:00Z', expectedResetAt: new Date(Date.parse('2026-09-12T07:00:00Z') + index * 10 * 60e3).toISOString() })), resets: [], now });
  assert.equal(result.level, '高概率');
  assert.ok(result.probability < 90);
  assert.match(result.reason, /并非 Tibo 官方确认/);
  assert.match(result.window, /9月12日 15:/);
});

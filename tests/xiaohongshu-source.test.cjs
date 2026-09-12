const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyXhsNote, parseSearchOutput } = require('../electron/xiaohongshu-source.cjs');

test('turns a Xiaohongshu search result into lower-authority Beijing-time evidence', () => {
  const signal = classifyXhsNote({ author: '观察站', likes: '149', title: '9月12日 Tibo已发布重置预告，下午3点前完成', url: 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=safe', published_at: '2026-09-12' });
  assert.equal(signal.authority, 'community');
  assert.equal(signal.evidenceKind, 'scheduled');
  assert.equal(signal.expectedResetAt, '2026-09-12T07:00:00.000Z');
  assert.ok(signal.confidence < 0.9);
});

test('filters unrelated Xiaohongshu results', () => {
  assert.deepEqual(parseSearchOutput(JSON.stringify([{ title: '普通旅游笔记', url: 'https://www.xiaohongshu.com/search_result/abc123', published_at: '2026-09-12' }])), []);
});

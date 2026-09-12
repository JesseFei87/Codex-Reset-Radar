const test = require('node:test');
const assert = require('node:assert/strict');
const { enhanceSignalsWithMiniMax, extractJsonArray, testMiniMaxKey } = require('../electron/minimax-analyzer.cjs');

test('extracts JSON after a thinking block', () => {
  const result = extractJsonArray('<think>private reasoning</think>\n```json\n[{"id":"a"}]\n```');
  assert.equal(result[0].id, 'a');
});

test('enhances deterministic evidence while preserving identity', async () => {
  const signal = { id: 'tibo-x-1', title: 'old', summary: 'Codex reset tomorrow', evidenceKind: 'scheduled', confidence: 0.98, publishedAt: '2026-08-23T00:00:00Z', expectedResetAt: null };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify([{ id: 'tibo-x-1', title: 'Tibo 预告重置', summary: '明日重置', evidenceKind: 'scheduled', expectedResetAt: '2026-08-24T21:00:00Z', confidence: 0.99, scope: 'all paid subscriptions' }]) } }] }),
  });
  const [result] = await enhanceSignalsWithMiniMax([signal], { apiKey: 'sk-cp-test', fetchImpl });
  assert.equal(result.id, signal.id);
  assert.equal(result.analysisProvider, 'MiniMax-M3');
  assert.equal(result.expectedResetAt, '2026-08-24T21:00:00.000Z');
});

test('does not let MiniMax downgrade a deterministically confirmed reset', async () => {
  const signal = { id: 'tibo-x-landed', title: 'Tibo 确认 Codex 额度已重置', summary: 'The banked reset has landed.', evidenceKind: 'confirmed', confidence: 1, publishedAt: '2026-08-22T00:50:36Z', expectedResetAt: null };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify([{ id: signal.id, title: '预告', summary: signal.summary, evidenceKind: 'scheduled', expectedResetAt: null, confidence: 0.98, scope: 'paid users' }]) } }] }),
  });
  const [result] = await enhanceSignalsWithMiniMax([signal], { apiKey: 'sk-cp-test', fetchImpl });
  assert.equal(result.evidenceKind, 'confirmed');
  assert.equal(result.title, signal.title);
});

test('automatically retries the mainland endpoint after a global 401', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('api.minimax.io')) {
      return { ok: false, status: 401, clone: () => ({ json: async () => ({ error: { message: 'invalid api key' } }) }) };
    }
    return { ok: true, status: 200 };
  };
  const result = await testMiniMaxKey('sk-cp-mainland-test', fetchImpl);
  assert.equal(result.region, 'cn');
  assert.deepEqual(urls, [
    'https://api.minimax.io/v1/chat/completions',
    'https://api.minimaxi.com/v1/chat/completions',
  ]);
});

test('returns an actionable error after both regions reject a key', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    clone: () => ({ json: async () => ({ error: { message: 'authentication failed' } }) }),
  });
  await assert.rejects(
    () => testMiniMaxKey('sk-cp-invalid-test', fetchImpl),
    /已自动尝试国际站和中国大陆站.*套餐席位或 Credits/,
  );
});

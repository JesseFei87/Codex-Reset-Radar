const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchTiboTimeline, normalizeTweet } = require('../electron/agent-reach-source.cjs');

test('normalizes twitter-cli JSON output without exposing credentials', async () => {
  const execImpl = async (python, args) => {
    assert.equal(python, '/test/python');
    assert.ok(args.includes('--json'));
    return { stdout: JSON.stringify({ ok: true, data: [{ id: '9', text: 'Codex reset tomorrow', createdAtISO: '2026-08-23T00:00:00Z' }] }) };
  };
  const result = await fetchTiboTimeline({ runtime: { python: '/test/python', twitter: '/test/twitter' }, execImpl, limit: 5 });
  assert.deepEqual(result, [{ id: '9', text: 'Codex reset tomorrow', created_at: '2026-08-23T00:00:00Z', metrics: null, quotedTweet: null }]);
});

test('normalizes quoted tweet context', () => {
  assert.equal(normalizeTweet({ id: 1, text: 'landed', createdAtISO: '2026-08-23T00:00:00Z', quotedTweet: { text: 'Codex reset' } }).quotedTweet.text, 'Codex reset');
});

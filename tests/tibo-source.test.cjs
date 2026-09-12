const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyTiboPost, classifyTiboTimeline, fetchTiboPostFromUrl, fetchTiboSignals, parseTiboPostUrl, repairStoredSignal, resetRecordFromSignal, signalNeedsUpdate } = require('../electron/tibo-source.cjs');

test('only accepts status URLs from Tibo personal account', () => {
  assert.equal(parseTiboPostUrl('https://x.com/thsottiaux/status/123456789').id, '123456789');
  assert.throws(() => parseTiboPostUrl('https://x.com/someone/status/123456789'), /Tibo/);
});

test('imports a relevant Tibo post through the free oEmbed endpoint', async () => {
  const timestamp = Date.parse('2026-08-23T18:00:00Z');
  const id = String((BigInt(timestamp) - 1288834974657n) << 22n);
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      author_url: 'https://twitter.com/thsottiaux',
      html: '<blockquote><p>We just reset all Codex usage limits &amp; credits.</p></blockquote>',
    }),
  });
  const signal = await fetchTiboPostFromUrl(`https://x.com/thsottiaux/status/${id}`, fetchImpl);
  assert.equal(signal.author, '@thsottiaux');
  assert.equal(signal.evidenceKind, 'confirmed');
  assert.equal(signal.publishedAt, '2026-08-23T18:00:00.000Z');
  assert.match(signal.summary, /limits & credits/);
});

test('merges a follow-up time correction into the previous reset announcement', () => {
  const signals = classifyTiboTimeline([
    { id: '100', text: 'Codex usage reset will land around 14pm PST tomorrow.', created_at: '2026-08-23T06:29:05Z' },
    { id: '101', text: 'Meant 2pm obviously', created_at: '2026-08-23T06:32:27Z' },
  ]);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].evidenceKind, 'scheduled');
  assert.equal(signals[0].expectedResetAt, '2026-08-23T21:00:00.000Z');
  assert.deepEqual(signals[0].supportingPostIds, ['101']);
});

test('classifies a landed reset as confirmed even when its quote said it would happen later', () => {
  const [signal] = classifyTiboTimeline([{
    id: '102',
    text: 'The banked reset has landed, I repeat, the banked reset has landed.',
    created_at: '2026-08-22T00:50:36Z',
    quotedTweet: { text: 'The banked reset will be there by 8pm PST for all paid Codex users.' },
  }]);
  assert.equal(signal.evidenceKind, 'confirmed');
  assert.equal(resetRecordFromSignal(signal).at, '2026-08-22T00:50:36.000Z');
});

test('classifies the August 24 propagated reset as confirmed', () => {
  const signal = classifyTiboPost({
    id: '2091688655828246890',
    text: 'Good Sunday. Reset has been propagated to accounts and we landed some fixes to usage.',
    context_text: 'Update on rate limits in Codex. We will do a full reset for all paid subscriptions.',
    created_at: '2026-08-24T00:46:51Z',
  });
  assert.equal(signal.evidenceKind, 'confirmed');
  assert.equal(resetRecordFromSignal(signal).at, '2026-08-24T00:46:51.000Z');
});

test('recognizes September subscription and Astra reset wording without a literal Codex mention', () => {
  const signals = classifyTiboTimeline([
    { id: '201', text: 'We will do the full banked reset today too for all Plus, Pro and Business users. Lands end of day.', created_at: '2026-09-05T00:39:25Z' },
    { id: '202', text: 'All reset for everyone. Enjoy the week with Astra.', context_text: '', created_at: '2026-09-08T04:05:53Z', quotedTweet: { text: 'We will do a global reset of the usage for all paid subscriptions. Lands around 6pm PST today.' } },
    { id: '203', text: 'Hi Astra users. A reset is also landing by midnight today.', created_at: '2026-09-12T03:20:36Z' },
  ]);
  assert.deepEqual(signals.map((item) => item.id), ['tibo-x-203', 'tibo-x-202', 'tibo-x-201']);
  assert.equal(signals.find((item) => item.id === 'tibo-x-202').evidenceKind, 'confirmed');
});

test('repairs the MiniMax-downgraded propagated reset', () => {
  const repaired = repairStoredSignal({
    id: 'tibo-x-2091688655828246890',
    author: '@thsottiaux',
    authority: 'codex-lead',
    summary: 'Tibo confirms the Codex reset has been propagated to accounts.',
    publishedAt: '2026-08-24T00:46:51.000Z',
    evidenceKind: 'scheduled',
    expectedResetAt: '2026-08-25T06:59:59.000Z',
  });
  assert.equal(repaired.evidenceKind, 'confirmed');
  assert.equal(repaired.expectedResetAt, null);
});

test('reprocesses historical evidence when its classification changes', () => {
  const current = { id: 'tibo-x-102', evidenceKind: 'confirmed', expectedResetAt: null, summary: 'landed', supportingPostIds: [] };
  const stale = { ...current, evidenceKind: 'scheduled' };
  assert.equal(signalNeedsUpdate(current, stale), true);
  assert.equal(signalNeedsUpdate(current, { ...current }), false);
});

test('repairs a stored landed reset that MiniMax previously downgraded', () => {
  const repaired = repairStoredSignal({
    id: 'tibo-x-2090964822422949999',
    author: '@thsottiaux',
    authority: 'codex-lead',
    summary: 'The banked reset has landed, I repeat, the banked reset has landed.',
    publishedAt: '2026-08-22T00:50:36.000Z',
    evidenceKind: 'scheduled',
    expectedResetAt: null,
  });
  assert.equal(repaired.evidenceKind, 'confirmed');
  assert.equal(repaired.deterministicRepair, true);
  assert.equal(resetRecordFromSignal(repaired).at, '2026-08-22T00:50:36.000Z');
});

test('filters unrelated Tibo posts and classifies a confirmed Codex reset', () => {
  assert.equal(classifyTiboPost({ id: '1', text: 'ChatGPT is having a great day', created_at: '2026-03-27T17:40:00Z' }), null);
  const signal = classifyTiboPost({
    id: '2',
    text: 'We have reset Codex usage limits across all plans. Have fun!',
    created_at: '2026-03-27T17:40:00Z',
  });
  assert.equal(signal.evidenceKind, 'confirmed');
  assert.equal(signal.confidence, 1);
  assert.equal(signal.author, '@thsottiaux');
  assert.equal(resetRecordFromSignal(signal).at, '2026-03-27T17:40:00.000Z');
});

test('converts a tomorrow announcement through America/Los_Angeles into a Beijing deadline', () => {
  const signal = classifyTiboPost({
    id: '3',
    text: 'We will reset Codex rate limits tomorrow.',
    created_at: '2026-08-23T18:00:00Z',
  });
  assert.equal(signal.evidenceKind, 'scheduled');
  assert.equal(signal.expectedResetAt, '2026-08-25T06:59:59.000Z');
  assert.equal(resetRecordFromSignal(signal), null);
});

test('paginates the official user timeline and resumes historical backfill', async () => {
  const calls = [];
  const responses = [
    { data: { id: '42' } },
    { data: [{ id: '20', text: 'We have reset Codex usage limits.', created_at: '2026-06-01T00:00:00Z' }], meta: { next_token: 'older' } },
    { data: [{ id: '10', text: 'A new Codex interface update.', created_at: '2026-05-01T00:00:00Z' }], meta: {} },
  ];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const body = responses.shift();
    return { ok: true, json: async () => body };
  };
  const result = await fetchTiboSignals({ token: 'test-token', fetchImpl, maxPages: 3 });
  assert.equal(result.userId, '42');
  assert.equal(result.sinceId, '20');
  assert.equal(result.backfillComplete, true);
  assert.equal(result.signals.length, 1);
  assert.match(calls[2], /pagination_token=older/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { LoginClientCache } = require('../electron/login-client-cache.cjs');

test('reuses a prewarmed Codex client for the next login', async () => {
  let starts = 0;
  const client = { close() {} };
  const cache = new LoginClientCache(async () => {
    starts += 1;
    return client;
  });
  await cache.warm('system', { timeoutMs: 20000 });
  assert.equal(await cache.take('system', { timeoutMs: 20000 }), client);
  assert.equal(starts, 1);
});

test('closes a warm client when the account runtime changes', async () => {
  const closed = [];
  const cache = new LoginClientCache(async ({ id }) => ({ close: () => closed.push(id) }));
  await cache.warm('system', { id: 'system' });
  await cache.warm('secondary', { id: 'secondary' });
  assert.deepEqual(closed, ['system']);
  cache.close();
  assert.deepEqual(closed, ['system', 'secondary']);
});

test('closes a superseded client that finishes warming after the runtime changed', async () => {
  let resolveSystem;
  const closed = [];
  const cache = new LoginClientCache(({ id }) => id === 'system'
    ? new Promise((resolve) => { resolveSystem = resolve; })
    : Promise.resolve({ close: () => closed.push(id) }));
  const oldWarm = cache.warm('system', { id: 'system' }).catch(() => null);
  await cache.warm('secondary', { id: 'secondary' });
  resolveSystem({ close: () => closed.push('system') });
  await oldWarm;
  assert.deepEqual(closed, ['system']);
  cache.close();
  assert.deepEqual(closed, ['system', 'secondary']);
});

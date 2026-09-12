const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverProjectChats, forkProjectChats } = require('../electron/chat-handoff.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-chat-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'account-a');
  const target = path.join(root, 'account-b');
  const sessionDir = path.join(source, 'sessions', '2026', '09', '01');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  const threadId = '01a11111-2222-7333-8444-555555555555';
  const projectId = 'local-project-a';
  fs.writeFileSync(path.join(sessionDir, `rollout-2026-09-01T00-00-00-${threadId}.jsonl`), '{"type":"session_meta"}\n');
  fs.writeFileSync(path.join(source, '.codex-global-state.json'), JSON.stringify({
    'local-projects': { [projectId]: { id: projectId, name: 'Radar', rootPaths: ['/workspace/radar'] } },
    'thread-project-assignments': { [threadId]: { projectKind: 'local', projectId } },
    'sidebar-project-thread-orders': { [projectId]: { threadIds: [threadId] } },
    'thread-workspace-root-hints': { [threadId]: '/workspace/radar' },
    'thread-writable-roots': { [threadId]: ['/workspace/radar'] },
  }));
  fs.writeFileSync(path.join(target, '.codex-global-state.json'), JSON.stringify({
    'local-projects': { [projectId]: { id: projectId, name: 'Radar', rootPaths: ['/workspace/radar'] } },
    'app-server-project-id-by-legacy-project-id-by-host': {
      [`local:${target}`]: { [projectId]: 'app-server-project-b' },
    },
  }));
  fs.writeFileSync(path.join(target, 'auth.json'), '{"token":"account-b"}');
  return { source, target, threadId, projectId };
}

test('discovers only local-project chats with a rollout file', (t) => {
  const { source, threadId, projectId } = fixture(t);
  const chats = discoverProjectChats(source);
  assert.equal(chats.length, 1);
  assert.equal(chats[0].threadId, threadId);
  assert.equal(chats[0].projectId, projectId);
});

test('discovers assigned chats across projects even when the sidebar order is incomplete', (t) => {
  const { source, threadId, projectId } = fixture(t);
  const stateFile = path.join(source, '.codex-global-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const secondProjectId = 'local-project-b';
  const secondThreadId = '01a33333-4444-7555-8666-777777777777';
  state['local-projects'][secondProjectId] = { id: secondProjectId, name: 'Game', rootPaths: ['/workspace/game'] };
  state['thread-project-assignments'][secondThreadId] = { projectKind: 'local', projectId: secondProjectId };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.writeFileSync(
    path.join(source, 'sessions', '2026', '09', '01', `rollout-${secondThreadId}.jsonl`),
    '{"type":"session_meta"}\n',
  );

  const chats = discoverProjectChats(source);
  assert.deepEqual(chats.map((chat) => [chat.threadId, chat.projectId]).sort(), [
    [threadId, projectId],
    [secondThreadId, secondProjectId],
  ].sort());
});

test('ignores chats inferred only from a matching workspace directory', (t) => {
  const { source } = fixture(t);
  const unassignedId = '01a22222-3333-7444-8555-666666666666';
  const unassignedFile = path.join(source, 'sessions', '2026', '09', '01', `rollout-${unassignedId}.jsonl`);
  fs.writeFileSync(unassignedFile, JSON.stringify({ type: 'session_meta', payload: { cwd: '/workspace/radar/game' } }) + '\n');

  const chats = discoverProjectChats(source);
  assert.equal(chats.length, 1);
  assert.equal(chats.some((chat) => chat.threadId === unassignedId), false);
});

test('supports legacy string project assignments', (t) => {
  const { source, threadId, projectId } = fixture(t);
  const stateFile = path.join(source, '.codex-global-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state['thread-project-assignments'][threadId] = projectId;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  assert.equal(discoverProjectChats(source)[0].projectId, projectId);
});

test('forks a project chat once, assigns it to the project, and preserves B auth', async (t) => {
  const { source, target, threadId, projectId } = fixture(t);
  const calls = [];
  const fakeClient = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'thread/fork') return { thread: { id: '01a99999-8888-7777-8666-555555555555' } };
      return {};
    },
    close() {},
  };
  const createClient = async (options) => {
    assert.equal(options.capabilities.experimentalApi, true);
    return fakeClient;
  };

  const first = await forkProjectChats({ sourceCodexHome: source, targetCodexHome: target, codexOptions: {}, createClient });
  const second = await forkProjectChats({ sourceCodexHome: source, targetCodexHome: target, codexOptions: {}, createClient });
  const targetState = JSON.parse(fs.readFileSync(path.join(target, '.codex-global-state.json'), 'utf8'));
  assert.equal(first.forkedChatCount, 1);
  assert.equal(second.forkedChatCount, 0);
  assert.equal(calls.filter((call) => call.method === 'thread/fork').length, 1);
  assert.deepEqual(calls.find((call) => call.method === 'thread/fork').params, {
    threadId,
    path: path.join(source, 'sessions', '2026', '09', '01', `rollout-2026-09-01T00-00-00-${threadId}.jsonl`),
    excludeTurns: true,
    deferGoalContinuation: true,
  });
  assert.deepEqual(calls.find((call) => call.method === 'thread/metadata/update').params, {
    threadId: '01a99999-8888-7777-8666-555555555555',
    projectId: 'app-server-project-b',
  });
  assert.deepEqual(targetState['thread-project-assignments']['01a99999-8888-7777-8666-555555555555'], { projectKind: 'local', projectId });
  assert.deepEqual(targetState['sidebar-project-thread-orders'][projectId].threadIds, ['01a99999-8888-7777-8666-555555555555']);
  assert.equal(fs.readFileSync(path.join(target, 'auth.json'), 'utf8'), '{"token":"account-b"}');
});

test('archives previously forked chats that are no longer visible in account A', async (t) => {
  const { source, target, threadId } = fixture(t);
  const staleSourceId = '01a44444-5555-7666-8777-888888888888';
  const staleForkId = '01a55555-6666-7777-8888-999999999999';
  fs.writeFileSync(path.join(target, 'radar-shared-chat-map.json'), JSON.stringify({
    version: 1,
    threads: { [staleSourceId]: { forkThreadId: staleForkId, projectId: 'local-project-a' } },
  }));
  const stateFile = path.join(target, '.codex-global-state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state['thread-project-assignments'] = { [staleForkId]: { projectKind: 'local', projectId: 'local-project-a' } };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const calls = [];
  const fakeClient = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'thread/fork') return { thread: { id: '01a66666-7777-7888-8999-000000000000' } };
      return {};
    },
    close() {},
  };

  const result = await forkProjectChats({ sourceCodexHome: source, targetCodexHome: target, createClient: async () => fakeClient });
  const map = JSON.parse(fs.readFileSync(path.join(target, 'radar-shared-chat-map.json'), 'utf8'));
  const updatedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(result.archivedChatCount, 1);
  assert.deepEqual(calls.find((call) => call.method === 'thread/archive'), {
    method: 'thread/archive', params: { threadId: staleForkId },
  });
  assert.equal(map.threads[staleSourceId], undefined);
  assert.equal(updatedState['thread-project-assignments'][staleForkId], undefined);
  assert.ok(map.threads[threadId]);
});

test('protects an active B chat instead of retrying destructive cleanup', async (t) => {
  const { source, target } = fixture(t);
  const staleSourceId = '01a77777-8888-7999-8aaa-bbbbbbbbbbbb';
  const activeForkId = '01a88888-9999-7aaa-8bbb-cccccccccccc';
  fs.writeFileSync(path.join(target, 'radar-shared-chat-map.json'), JSON.stringify({
    version: 1,
    threads: { [staleSourceId]: { forkThreadId: activeForkId, projectId: 'local-project-a' } },
  }));
  const fakeClient = {
    request: async (method) => {
      if (method === 'thread/archive') throw new Error(`thread ${activeForkId} already has an active writer`);
      if (method === 'thread/fork') return { thread: { id: '01a99999-aaaa-7bbb-8ccc-dddddddddddd' } };
      return {};
    },
    close() {},
  };

  const result = await forkProjectChats({ sourceCodexHome: source, targetCodexHome: target, createClient: async () => fakeClient });
  const map = JSON.parse(fs.readFileSync(path.join(target, 'radar-shared-chat-map.json'), 'utf8'));
  assert.equal(result.protectedChatCount, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(map.threads[staleSourceId].protected, true);
  assert.equal(map.threads[staleSourceId].protectedReason, 'active-writer');
});

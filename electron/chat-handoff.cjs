const fs = require('node:fs');
const path = require('node:path');
const { createCodexClient } = require('./codex-app-server.cjs');

const THREAD_ID_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function sessionFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? sessionFiles(item) : [item];
  });
}

function discoverProjectChats(sourceCodexHome) {
  const state = readJson(path.join(sourceCodexHome, '.codex-global-state.json'));
  const localProjects = state['local-projects'] || {};
  const assignments = state['thread-project-assignments'] || {};
  const sidebarOrders = state['sidebar-project-thread-orders'] || {};
  const rolloutFiles = [
    ...sessionFiles(path.join(sourceCodexHome, 'sessions')),
    ...sessionFiles(path.join(sourceCodexHome, 'archived_sessions')),
  ];
  const rollouts = new Map(rolloutFiles.flatMap((file) => {
    const match = file.match(THREAD_ID_PATTERN);
    return match ? [[match[1], file]] : [];
  }));
  const visibleThreads = new Map();
  for (const [threadId, assignment] of Object.entries(assignments)) {
    const projectId = typeof assignment === 'string' ? assignment : assignment?.projectId;
    if (localProjects[projectId]) visibleThreads.set(threadId, projectId);
  }
  for (const [projectId, order] of Object.entries(sidebarOrders)) {
    if (!localProjects[projectId]) continue;
    for (const threadId of order?.threadIds || []) visibleThreads.set(threadId, projectId);
  }
  return [...visibleThreads].flatMap(([threadId, orderedProjectId]) => {
    const assignment = assignments[threadId];
    const assignedProjectId = typeof assignment === 'string' ? assignment : assignment?.projectId;
    const projectId = localProjects[assignedProjectId] ? assignedProjectId : orderedProjectId;
    if (!rollouts.has(threadId)) return [];
    return [{
      threadId,
      projectId,
      rolloutPath: rollouts.get(threadId),
      workspaceRootHint: state['thread-workspace-root-hints']?.[threadId] || null,
      writableRoots: state['thread-writable-roots']?.[threadId] || null,
    }];
  });
}

function targetProjectId(targetCodexHome, sourceProjectId) {
  const state = readJson(path.join(targetCodexHome, '.codex-global-state.json'));
  const mappings = state['app-server-project-id-by-legacy-project-id-by-host'] || {};
  for (const mapping of Object.values(mappings)) {
    if (mapping && typeof mapping === 'object' && mapping[sourceProjectId]) return mapping[sourceProjectId];
  }
  return sourceProjectId;
}

function writeForkState(targetCodexHome, records) {
  if (!records.length) return;
  const stateFile = path.join(targetCodexHome, '.codex-global-state.json');
  const state = readJson(stateFile);
  const assignments = { ...(state['thread-project-assignments'] || {}) };
  const rootHints = { ...(state['thread-workspace-root-hints'] || {}) };
  const writableRoots = { ...(state['thread-writable-roots'] || {}) };
  const sidebarOrders = { ...(state['sidebar-project-thread-orders'] || {}) };
  for (const record of records) {
    assignments[record.forkThreadId] = { projectKind: 'local', projectId: record.projectId };
    if (record.workspaceRootHint) rootHints[record.forkThreadId] = record.workspaceRootHint;
    if (record.writableRoots) writableRoots[record.forkThreadId] = record.writableRoots;
    const existing = sidebarOrders[record.projectId] || {};
    const threadIds = (existing.threadIds || []).filter((threadId) => threadId !== record.forkThreadId);
    sidebarOrders[record.projectId] = { ...existing, threadIds: [...threadIds, record.forkThreadId] };
  }
  fs.writeFileSync(stateFile, `${JSON.stringify({
    ...state,
    'thread-project-assignments': assignments,
    'thread-workspace-root-hints': rootHints,
    'thread-writable-roots': writableRoots,
    'sidebar-project-thread-orders': sidebarOrders,
  }, null, 2)}\n`, { mode: 0o600 });
}

function removeForkState(targetCodexHome, forkThreadIds) {
  if (!forkThreadIds.length) return;
  const stateFile = path.join(targetCodexHome, '.codex-global-state.json');
  const state = readJson(stateFile);
  for (const key of ['thread-project-assignments', 'thread-workspace-root-hints', 'thread-writable-roots']) {
    const values = { ...(state[key] || {}) };
    for (const threadId of forkThreadIds) delete values[threadId];
    state[key] = values;
  }
  const orders = { ...(state['sidebar-project-thread-orders'] || {}) };
  for (const [projectId, order] of Object.entries(orders)) {
    orders[projectId] = {
      ...order,
      threadIds: (order?.threadIds || []).filter((threadId) => !forkThreadIds.includes(threadId)),
    };
  }
  state['sidebar-project-thread-orders'] = orders;
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function forkProjectChats({ sourceCodexHome, targetCodexHome, codexOptions = {}, createClient = createCodexClient }) {
  const chats = discoverProjectChats(sourceCodexHome);
  const mapFile = path.join(targetCodexHome, 'radar-shared-chat-map.json');
  const handoff = readJson(mapFile, { version: 1, threads: {} });
  const sourceThreadIds = new Set(chats.map((chat) => chat.threadId));
  const staleEntries = Object.entries(handoff.threads || {}).filter(([threadId, entry]) => (
    !sourceThreadIds.has(threadId) && entry?.protected !== true
  ));
  const pending = chats.filter((chat) => !handoff.threads?.[chat.threadId]);
  const assignmentRetries = chats.filter((chat) => handoff.threads?.[chat.threadId]?.projectAssigned === false);
  const records = chats.flatMap((chat) => {
    const existing = handoff.threads?.[chat.threadId];
    return existing ? [{ ...chat, forkThreadId: existing.forkThreadId }] : [];
  });
  const errors = [];
  const archivedForkIds = [];
  let protectedChatCount = 0;
  let client;
  try {
    if (pending.length || assignmentRetries.length || staleEntries.length) {
      client = await createClient({ ...codexOptions, capabilities: { experimentalApi: true } });
    }
    for (const [sourceThreadId, stale] of staleEntries) {
      try {
        await client.request('thread/archive', { threadId: stale.forkThreadId });
        archivedForkIds.push(stale.forkThreadId);
        delete handoff.threads[sourceThreadId];
      } catch (error) {
        if (/active writer/i.test(error.message)) {
          stale.protected = true;
          stale.protectedReason = 'active-writer';
          protectedChatCount += 1;
        } else {
          errors.push({ threadId: sourceThreadId, message: `清理错误接力副本失败：${error.message}` });
        }
      }
    }
    for (const chat of assignmentRetries) {
      const existing = handoff.threads[chat.threadId];
      try {
        await client.request('thread/metadata/update', {
          threadId: existing.forkThreadId,
          projectId: targetProjectId(targetCodexHome, chat.projectId),
        });
        existing.projectAssigned = true;
      } catch {
        existing.projectAssigned = false;
      }
    }
    for (const chat of pending) {
      try {
        const result = await client.request('thread/fork', {
          threadId: chat.threadId,
          path: chat.rolloutPath,
          excludeTurns: true,
          deferGoalContinuation: true,
        });
        const forkThreadId = result?.thread?.id;
        if (!forkThreadId) throw new Error('Codex 未返回接力线程 ID');
        let projectAssigned = true;
        try {
          await client.request('thread/metadata/update', {
            threadId: forkThreadId,
            projectId: targetProjectId(targetCodexHome, chat.projectId),
          });
        } catch {
          projectAssigned = false;
        }
        handoff.threads = { ...(handoff.threads || {}), [chat.threadId]: {
          forkThreadId,
          projectId: chat.projectId,
          projectAssigned,
          forkedAt: new Date().toISOString(),
        } };
        records.push({ ...chat, forkThreadId });
      } catch (error) {
        errors.push({ threadId: chat.threadId, message: error.message });
      }
    }
  } finally {
    client?.close();
  }
  fs.mkdirSync(targetCodexHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(mapFile, `${JSON.stringify(handoff, null, 2)}\n`, { mode: 0o600 });
  removeForkState(targetCodexHome, archivedForkIds);
  writeForkState(targetCodexHome, records);
  return {
    discoveredChatCount: chats.length,
    forkedChatCount: records.length - (chats.length - pending.length),
    availableChatCount: records.length,
    archivedChatCount: archivedForkIds.length,
    protectedChatCount,
    errors,
  };
}

module.exports = { discoverProjectChats, forkProjectChats };

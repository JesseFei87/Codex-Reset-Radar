const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureProfileRuntime, normalizeProfiles, profileIdsToRefresh, syncLocalProjects, updateProfile } = require('../electron/account-profiles.cjs');

test('migrates the existing system login into account A without connecting account B', () => {
  const profiles = normalizeProfiles(null, { connected: true, plan: 'plus', remainingPercent: 42 });
  assert.equal(profiles[0].connected, true);
  assert.equal(profiles[0].remainingPercent, 42);
  assert.equal(profiles[1].connected, false);
});

test('creates an isolated CODEX_HOME with file-backed official credentials for account B', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-profile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runtime = ensureProfileRuntime(directory, normalizeProfiles()[1]);
  assert.equal(runtime.codexOptions.env.CODEX_HOME, runtime.codexHome);
  assert.match(fs.readFileSync(path.join(runtime.codexHome, 'config.toml'), 'utf8'), /cli_auth_credentials_store = "file"/);
  assert.notEqual(runtime.desktopUserData, runtime.codexHome);
});

test('updates only the selected profile and omits official usage payloads', () => {
  const profiles = updateProfile(normalizeProfiles(), 'secondary', {
    connected: true,
    plan: 'plus',
    remainingPercent: 88,
    officialUsage: { private: 'payload' },
  }, '2026-08-30T00:00:00Z');
  assert.equal(profiles[0].connected, false);
  assert.equal(profiles[1].remainingPercent, 88);
  assert.equal('officialUsage' in profiles[1], false);
});

test('single-instance mode refreshes only the account currently logged into the shared runtime', () => {
  const profiles = normalizeProfiles().map((profile) => ({ ...profile, connected: true }));
  assert.deepEqual(profileIdsToRefresh(profiles, 'secondary', 'single-instance'), ['secondary']);
  assert.deepEqual(profileIdsToRefresh(profiles, 'secondary', 'isolated'), ['primary', 'secondary']);
});

test('shared project mode copies only local project registry data into account B', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-shared-projects-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'account-a');
  const target = path.join(directory, 'account-b');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(source, '.codex-global-state.json'), JSON.stringify({
    'local-projects': {
      'local-a': { id: 'local-a', name: 'Radar', rootPaths: ['/workspace/radar'] },
    },
    'project-order': ['cloud-a', 'local-a'],
    'electron-saved-workspace-roots': ['/workspace/radar'],
    'active-workspace-roots': ['/workspace/radar'],
    'selected-project': { type: 'local', projectId: 'local-a' },
    'thread-project-assignments': { 'thread-a': { projectId: 'local-a' } },
    secret: 'do-not-copy',
  }));
  fs.writeFileSync(path.join(source, 'auth.json'), '{"token":"account-a"}');
  fs.writeFileSync(path.join(target, '.codex-global-state.json'), JSON.stringify({
    'local-projects': {
      'local-b': { id: 'local-b', name: 'B only', rootPaths: ['/workspace/b'] },
    },
    'project-order': ['local-b'],
  }));
  fs.writeFileSync(path.join(target, 'auth.json'), '{"token":"account-b"}');

  const result = syncLocalProjects(source, target);
  const state = JSON.parse(fs.readFileSync(path.join(target, '.codex-global-state.json'), 'utf8'));
  assert.equal(result.projectCount, 1);
  assert.deepEqual(Object.keys(state['local-projects']).sort(), ['local-a', 'local-b']);
  assert.deepEqual(state['project-order'], ['local-a', 'local-b']);
  assert.deepEqual(state['selected-project'], { type: 'local', projectId: 'local-a' });
  assert.equal(state['thread-project-assignments'], undefined);
  assert.equal(state.secret, undefined);
  assert.equal(fs.readFileSync(path.join(target, 'auth.json'), 'utf8'), '{"token":"account-b"}');
});

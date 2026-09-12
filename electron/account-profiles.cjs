const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROFILE_IDS = ['primary', 'secondary'];

function emptyAccount() {
  return {
    connected: false,
    source: 'codex-app-server',
    plan: '未连接',
    email: null,
    accountId: null,
    remainingPercent: 0,
    nextNaturalReset: null,
    cards: [],
    usageWindows: [],
    resetCreditAvailableCount: 0,
  };
}

function defaultProfiles(existingAccount = {}) {
  return [
    { id: 'primary', label: '账号 A', kind: 'system', ...emptyAccount(), ...existingAccount },
    { id: 'secondary', label: '账号 B', kind: 'isolated', ...emptyAccount() },
  ];
}

function normalizeProfiles(saved, existingAccount = {}) {
  const defaults = defaultProfiles(existingAccount);
  return defaults.map((profile) => {
    const stored = Array.isArray(saved) ? saved.find((item) => item?.id === profile.id) : null;
    return { ...profile, ...(stored || {}), id: profile.id, kind: profile.kind };
  });
}

function profileRoot(userData, profileId) {
  if (!PROFILE_IDS.includes(profileId)) throw new Error('Invalid account profile');
  return path.join(userData, 'account-profiles', profileId);
}

function ensureProfileRuntime(userData, profile) {
  if (profile.kind === 'system') return { codexOptions: {}, desktopUserData: null, root: null };
  const root = profileRoot(userData, profile.id);
  const codexHome = path.join(root, 'codex');
  const desktopUserData = path.join(root, 'chatgpt-desktop');
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  fs.mkdirSync(desktopUserData, { recursive: true, mode: 0o700 });
  const configFile = path.join(codexHome, 'config.toml');
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
  return {
    root,
    desktopUserData,
    codexHome,
    codexOptions: { env: { ...process.env, CODEX_HOME: codexHome } },
  };
}

function systemCodexHome({ env = process.env, homedir = os.homedir() } = {}) {
  return env.CODEX_HOME || path.join(homedir, '.codex');
}

function profileIdsToRefresh(profiles, activeProfileId, accountSwitchMode) {
  if (accountSwitchMode === 'single-instance') return [activeProfileId];
  return profiles
    .filter((profile) => profile.id === 'primary' || profile.connected || profile.id === activeProfileId)
    .map((profile) => profile.id);
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter((value) => typeof value === 'string' && value))];
}

function syncLocalProjects(sourceCodexHome, targetCodexHome) {
  const sourceFile = path.join(sourceCodexHome, '.codex-global-state.json');
  const targetFile = path.join(targetCodexHome, '.codex-global-state.json');
  if (sourceFile === targetFile || !fs.existsSync(sourceFile)) return { projectCount: 0, updated: false };

  const source = readJson(sourceFile);
  const target = readJson(targetFile);
  const sourceProjects = Object.fromEntries(Object.entries(source['local-projects'] || {}).flatMap(([id, project]) => {
    if (!project || typeof project !== 'object') return [];
    const rootPaths = uniqueStrings(project.rootPaths);
    if (!rootPaths.length) return [];
    return [[id, {
      id,
      name: typeof project.name === 'string' ? project.name : path.basename(rootPaths[0]),
      rootPaths,
      ...(Number.isFinite(project.createdAt) ? { createdAt: project.createdAt } : {}),
      ...(Number.isFinite(project.updatedAt) ? { updatedAt: project.updatedAt } : {}),
    }]];
  }));
  const sourceIds = Object.keys(sourceProjects);
  if (!sourceIds.length) return { projectCount: 0, updated: false };

  const sourceOrder = uniqueStrings(source['project-order']).filter((id) => sourceProjects[id]);
  const targetOrder = uniqueStrings(target['project-order']).filter((id) => !sourceProjects[id]);
  const selected = source['selected-project'];
  const next = {
    ...target,
    'local-projects': { ...(target['local-projects'] || {}), ...sourceProjects },
    'project-order': [...sourceOrder, ...sourceIds.filter((id) => !sourceOrder.includes(id)), ...targetOrder],
    'electron-saved-workspace-roots': uniqueStrings([
      ...(source['electron-saved-workspace-roots'] || []),
      ...(target['electron-saved-workspace-roots'] || []),
    ]),
    'active-workspace-roots': uniqueStrings(source['active-workspace-roots']),
    ...(selected?.type === 'local' && sourceProjects[selected.projectId]
      ? { 'selected-project': { type: 'local', projectId: selected.projectId } }
      : {}),
  };
  fs.mkdirSync(targetCodexHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(targetFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return { projectCount: sourceIds.length, updated: true };
}

function publicProfile(profile) {
  const { officialUsage, ...safe } = profile;
  return safe;
}

function updateProfile(profiles, profileId, account, checkedAt = new Date().toISOString()) {
  return profiles.map((profile) => profile.id === profileId
    ? publicProfile({ ...profile, ...account, lastCheckedAt: checkedAt, lastError: null })
    : profile);
}

module.exports = {
  PROFILE_IDS,
  defaultProfiles,
  emptyAccount,
  ensureProfileRuntime,
  normalizeProfiles,
  profileRoot,
  profileIdsToRefresh,
  publicProfile,
  syncLocalProjects,
  systemCodexHome,
  updateProfile,
};

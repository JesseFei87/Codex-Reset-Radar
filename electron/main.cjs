const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, nativeImage, safeStorage, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createCodexClient, normalizeCodexAccount, queryCodexAccount } = require('./codex-app-server.cjs');
const { predict } = require('./predictor.cjs');
const { SnapshotStore } = require('./snapshot-store.cjs');
const { fetchTiboPostFromUrl, classifyTiboTimeline, repairStoredSignal, resetRecordFromSignal, signalNeedsUpdate } = require('./tibo-source.cjs');
const { fetchTiboTimeline } = require('./agent-reach-source.cjs');
const { LLM_PROVIDERS, MINIMAX_MODEL, enhanceSignals, testLlmConnection, testMiniMaxKey } = require('./minimax-analyzer.cjs');
const { fetchXiaohongshuSignals, listOpenCliProfiles } = require('./xiaohongshu-source.cjs');
const { SecretStore } = require('./secret-store.cjs');
const { hudPosition } = require('./hud-position.cjs');
const { confirmedCalendarRecords } = require('./reset-history.cjs');
const { mainWindowChrome } = require('./window-chrome.cjs');
const { emptyAccount, ensureProfileRuntime, normalizeProfiles, profileIdsToRefresh, syncLocalProjects, systemCodexHome, updateProfile } = require('./account-profiles.cjs');
const { forkProjectChats } = require('./chat-handoff.cjs');
const { launchDesktopProfile } = require('./desktop-account-switcher.cjs');
const { LoginClientCache } = require('./login-client-cache.cjs');

let mainWindow;
let hudWindow;
let tray;
let timer;
let state;
let snapshotStore;
const profileSnapshotStores = new Map();
let secretStore;
let loginClient;
let activeLogin;
const loginClientCache = new LoginClientCache(createCodexClient);

function daysFromNow(offset, hour = 9) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  value.setHours(hour, 0, 0, 0);
  return value.toISOString();
}

function defaultState() {
  return {
    signals: [],
    resets: [],
    resetEvents: [],
    account: {
      connected: false,
      source: 'demo',
      plan: '未连接',
      remainingPercent: 0,
      nextNaturalReset: null,
      cards: [],
      usageWindows: [],
      resetCreditAvailableCount: 0,
    },
    accountProfiles: normalizeProfiles(),
    activeAccountProfileId: 'primary',
    settings: { dataMode: 'public', accountSwitchMode: 'isolated', signalChannel: 'x', xhsProfile: '', llmProvider: 'minimax', llmModel: 'MiniMax-M3', intervalMinutes: 30, notifyThreshold: 70, launchAtLogin: false },
    tiboEvidence: [],
    xhsEvidence: [],
    sourceState: { tiboLastSeenId: null, tiboBackfillComplete: false, xhsLastSeenIds: [] },
    integrations: {
      agentReach: { status: 'checking', message: '正在检查 Agent Reach' },
      llm: { configured: false, status: 'unconfigured', message: '尚未配置大模型', provider: 'minimax', model: 'MiniMax-M3' },
      minimax: { configured: false, status: 'unconfigured', message: '尚未配置 MiniMax Subscription Key', model: 'MiniMax-M3', region: null },
    },
    prediction: null,
    history: { snapshots: [], events: [] },
    lastRunAt: null,
    lastPredictionNotificationAt: null,
    lastCardNotificationAt: null,
    mode: 'demo',
    sourceStatus: { Codex: '公开雷达模式未启用账户连接', Tibo: '正在检查 Agent Reach' },
  };
}

function dataFile() {
  return path.join(app.getPath('userData'), 'radar-data.json');
}

function loadState() {
  try {
    const defaults = defaultState();
    const saved = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    const tiboEvidence = (saved.tiboEvidence || saved.signals || []).filter((item) => item.author === '@thsottiaux' || item.authority === 'codex-lead');
    const xhsEvidence = (saved.xhsEvidence || []).filter((item) => item.source === '小红书');
    const account = { ...defaults.account, ...(saved.account || {}) };
    const activeAccountProfileId = ['primary', 'secondary'].includes(saved.activeAccountProfileId) ? saved.activeAccountProfileId : 'primary';
    return {
      ...defaults,
      ...saved,
      signals: saved.settings?.signalChannel === 'xiaohongshu' ? xhsEvidence : tiboEvidence,
      tiboEvidence,
      xhsEvidence,
      resets: (saved.resets || []).filter((item) => !item.demo),
      account,
      accountProfiles: normalizeProfiles(saved.accountProfiles, account),
      activeAccountProfileId,
      settings: { ...defaults.settings, ...(saved.settings || {}) },
      sourceState: { ...defaults.sourceState, ...(saved.sourceState || {}) },
      integrations: {
        agentReach: { ...defaults.integrations.agentReach, ...(saved.integrations?.agentReach || {}) },
        llm: { ...defaults.integrations.llm, ...(saved.integrations?.llm || {}), configured: false },
        minimax: { ...defaults.integrations.minimax, ...(saved.integrations?.minimax || {}), configured: false },
      },
      sourceStatus: { ...defaults.sourceStatus, Codex: saved.sourceStatus?.Codex || defaults.sourceStatus.Codex },
    };
  } catch {
    return defaultState();
  }
}

function accountProfile(profileId = state.activeAccountProfileId) {
  const profile = state.accountProfiles.find((item) => item.id === profileId);
  if (!profile) throw new Error('账号槽位不存在');
  return profile;
}

function accountFromProfile(profile) {
  const base = emptyAccount();
  return Object.fromEntries(Object.keys(base).map((key) => [key, profile[key] ?? base[key]]));
}

function runtimeForProfile(profileId) {
  return ensureProfileRuntime(app.getPath('userData'), accountProfile(profileId));
}

function singleInstanceMode() {
  return state.settings.accountSwitchMode === 'single-instance';
}

function accountRuntimeForProfile(profileId) {
  return singleInstanceMode() ? runtimeForProfile('primary') : runtimeForProfile(profileId);
}

function loginRuntimeKey(runtime) {
  return runtime.codexHome || 'system';
}

function warmLoginClient(profileId = state.activeAccountProfileId) {
  if (state.settings.dataMode !== 'account' || loginClient) return;
  const runtime = accountRuntimeForProfile(profileId);
  loginClientCache.warm(loginRuntimeKey(runtime), { timeoutMs: 20000, ...runtime.codexOptions }).catch(() => {});
}

function sendLoginProgress(profileId, phase) {
  mainWindow?.webContents.send('radar:login-progress', { profileId, phase });
}

function desktopRuntimeForProfile(profileId) {
  const runtime = accountRuntimeForProfile(profileId);
  if (singleInstanceMode()) return { runtime, sharedProjectCount: 0 };
  if (profileId !== 'secondary' || state.settings.accountSwitchMode !== 'shared-projects') {
    return { runtime, sharedProjectCount: 0 };
  }
  const sync = syncLocalProjects(systemCodexHome(), runtime.codexHome);
  return { runtime, sharedProjectCount: sync.projectCount };
}

async function sharedChatsForProfile(profileId, runtime) {
  if (profileId !== 'secondary' || state.settings.accountSwitchMode !== 'shared-projects') {
    return { discoveredChatCount: 0, forkedChatCount: 0, availableChatCount: 0, errors: [] };
  }
  return forkProjectChats({
    sourceCodexHome: systemCodexHome(),
    targetCodexHome: runtime.codexHome,
    codexOptions: runtime.codexOptions,
  });
}

function snapshotStoreForProfile(profileId) {
  if (profileId === 'primary') return snapshotStore;
  if (!profileSnapshotStores.has(profileId)) {
    profileSnapshotStores.set(profileId, new SnapshotStore(path.join(app.getPath('userData'), 'account-profiles', profileId, 'history')));
  }
  return profileSnapshotStores.get(profileId);
}

async function readProfileAccount(profileId) {
  const runtime = accountRuntimeForProfile(profileId);
  return queryCodexAccount(runtime.codexOptions).then(normalizeCodexAccount);
}

function saveState() {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(state, null, 2));
}

function broadcastState() {
  for (const window of [mainWindow, hudWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('radar:updated', state);
  }
}

function refreshResetEvents() {
  const creditGrants = (state.history?.events || [])
    .filter((event) => event.type === 'credit-grant');
  state.resetEvents = confirmedCalendarRecords([...state.resets, ...creditGrants]);
}

function mergeById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function tweetIdFromSignal(signal) {
  return String(signal.id || '').replace(/^tibo-x-/, '');
}

function newestTweetId(posts) {
  return posts.reduce((latest, post) => {
    try { return !latest || BigInt(post.id) > BigInt(latest) ? String(post.id) : latest; } catch { return latest; }
  }, null);
}

function isNewTweet(id, sinceId) {
  if (!sinceId) return true;
  try { return BigInt(id) > BigInt(sinceId); } catch { return true; }
}

function maybeNotify() {
  if (!Notification.isSupported()) return;
  const now = Date.now();
  const lastPrediction = state.lastPredictionNotificationAt ? new Date(state.lastPredictionNotificationAt).getTime() : 0;
  if (state.prediction.probability >= state.settings.notifyThreshold && now - lastPrediction > 6 * 36e5) {
    new Notification({
      title: `Codex 重置${state.prediction.level} ${state.prediction.probability}%`,
      body: `${state.prediction.window}。建议合理安排当前额度。`,
    }).show();
    state.lastPredictionNotificationAt = new Date().toISOString();
  }
  const expiring = state.settings.dataMode === 'account' && state.account.cards.find((card) => {
    if (!card.expiresAt) return false;
    const days = (new Date(card.expiresAt) - now) / 864e5;
    return days >= 0 && days <= 5;
  });
  const lastCard = state.lastCardNotificationAt ? new Date(state.lastCardNotificationAt).getTime() : 0;
  if (expiring && now - lastCard > 20 * 36e5) {
    new Notification({ title: '重置卡即将到期', body: `${expiring.label}将在 5 天内到期，请及时使用。` }).show();
    state.lastCardNotificationAt = new Date().toISOString();
  }
}

async function runRadar() {
  const errors = [];
  state.tiboEvidence = (state.tiboEvidence || []).map(repairStoredSignal);
  state.xhsEvidence = state.xhsEvidence || [];
  const channel = state.settings.signalChannel === 'xiaohongshu' ? 'xiaohongshu' : 'x';
  let changed = [];
  if (channel === 'x') {
    const previousLastSeenId = state.sourceState.tiboLastSeenId;
    let timeline = await fetchTiboTimeline({ limit: 200 }).catch((error) => (errors.push(error.message), null));
    if (timeline && previousLastSeenId && !timeline.some((post) => String(post.id) === String(previousLastSeenId))) {
      const oldest = timeline.reduce((value, post) => { try { return value === null || BigInt(post.id) < BigInt(value) ? String(post.id) : value; } catch { return value; } }, null);
      let gap = false;
      try { gap = oldest && BigInt(previousLastSeenId) < BigInt(oldest); } catch {}
      if (gap) timeline = await fetchTiboTimeline({ limit: 1000 }).catch((error) => (errors.push(`X 深度补抓失败：${error.message}`), timeline));
    }
    if (timeline) {
      const deterministic = classifyTiboTimeline(timeline);
      const existingById = new Map(state.tiboEvidence.map((signal) => [signal.id, signal]));
      changed = deterministic.filter((signal) => signalNeedsUpdate(signal, existingById.get(signal.id)) || isNewTweet(tweetIdFromSignal(signal), previousLastSeenId) || (signal.supportingPostIds || []).some((id) => isNewTweet(id, previousLastSeenId)));
      state.tiboEvidence = mergeById([...state.tiboEvidence, ...changed]).sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt)).slice(0, 1000);
      state.sourceState.tiboLastSeenId = newestTweetId(timeline) || previousLastSeenId;
      state.sourceState.tiboBackfillComplete = true;
      state.integrations.agentReach = { status: 'connected', message: `X 自动采集正常 · 回读 ${timeline.length} 条并对照断点` };
      state.sourceStatus.Tibo = 'Agent Reach 自动采集 · twitter-cli · 断点回读';
    } else {
      state.integrations.agentReach = { status: 'error', message: 'X 自动采集不可用 · 可继续手动导入' };
      state.sourceStatus.Tibo = 'Agent Reach 不可用 · 手动导入兜底';
    }
  } else {
    const xhs = await fetchXiaohongshuSignals({ profile: state.settings.xhsProfile }).catch((error) => (errors.push(error.message), null));
    if (xhs) {
      const existing = new Set(state.xhsEvidence.map((signal) => signal.id));
      changed = xhs.filter((signal) => !existing.has(signal.id));
      state.xhsEvidence = mergeById([...state.xhsEvidence, ...xhs]).sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt)).slice(0, 1000);
      state.sourceState.xhsLastSeenIds = xhs.slice(0, 50).map((signal) => signal.id);
      state.integrations.agentReach = { status: 'connected', message: `小红书自动采集正常 · 搜索命中 ${xhs.length} 条` };
      state.sourceStatus.Tibo = 'OpenCLI 小红书搜索 · 社区证据';
    } else {
      state.integrations.agentReach = { status: 'error', message: '小红书自动采集不可用 · 请确认 Chrome 已登录并连接 OpenCLI' };
      state.sourceStatus.Tibo = '小红书渠道待连接';
    }
  }

  const provider = LLM_PROVIDERS[state.settings.llmProvider] ? state.settings.llmProvider : 'minimax';
  const model = state.settings.llmModel || LLM_PROVIDERS[provider].models[0];
  const secretName = `llm-${provider}`;
  let apiKey = null;
  try { apiKey = secretStore?.get(secretName) || (provider === 'minimax' ? secretStore?.get('minimax') : null); } catch (error) { errors.push(`大模型密钥读取失败：${error.message}`); }
  const configured = Boolean(apiKey) || Boolean(LLM_PROVIDERS[provider].keyOptional);
  if (configured && changed.length) {
    try {
      const enhanced = await enhanceSignals(changed, { provider, model, apiKey });
      const target = channel === 'x' ? 'tiboEvidence' : 'xhsEvidence';
      state[target] = mergeById([...state[target], ...enhanced]).sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt)).slice(0, 1000);
      state.integrations.llm = { configured: true, status: 'connected', message: `${model} 分析已启用`, provider, model };
    } catch (error) {
      errors.push(`${LLM_PROVIDERS[provider].label}：${error.message}`);
      state.integrations.llm = { configured: true, status: 'error', message: error.message, provider, model };
    }
  } else {
    state.integrations.llm = { configured, status: configured ? 'connected' : 'unconfigured', message: configured ? `${model} 已配置 · 暂无新证据` : '未配置密钥 · 使用本地规则', provider, model };
  }
  state.integrations.minimax = { ...state.integrations.minimax, configured: provider === 'minimax' && configured, status: state.integrations.llm.status, message: state.integrations.llm.message, model };
  state.signals = [...(channel === 'x' ? state.tiboEvidence : state.xhsEvidence)].sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
  state.mode = state.signals.length ? 'live' : 'demo';
  const tiboResets = (state.tiboEvidence || []).map(resetRecordFromSignal).filter(Boolean);
  let codexAccount = null;
  if (state.settings.dataMode === 'account') {
    const refreshIds = profileIdsToRefresh(state.accountProfiles, state.activeAccountProfileId, state.settings.accountSwitchMode);
    const queryable = state.accountProfiles.filter((profile) => refreshIds.includes(profile.id));
    for (const profile of queryable) {
      try {
        const account = await readProfileAccount(profile.id);
        state.accountProfiles = updateProfile(state.accountProfiles, profile.id, account);
        if (account.connected) snapshotStoreForProfile(profile.id).record(account);
        if (profile.id === state.activeAccountProfileId) codexAccount = account;
      } catch (error) {
        state.accountProfiles = state.accountProfiles.map((item) => item.id === profile.id
          ? { ...item, lastError: error.message, lastCheckedAt: new Date().toISOString() }
          : item);
        if (profile.id === state.activeAccountProfileId) errors.push(error.message);
      }
    }
    state.account = accountFromProfile(accountProfile());
    state.history = snapshotStoreForProfile(state.activeAccountProfileId).history();
  }
  if (state.settings.dataMode === 'public') {
    state.sourceStatus.Codex = '公开雷达模式 · 不启动 Codex';
    state.resets = mergeById([...state.resets, ...tiboResets]);
  } else if (codexAccount?.connected) {
    state.account = accountFromProfile({ ...state.account, ...codexAccount });
    state.sourceStatus.Codex = '已连接官方 app-server';
    state.history = snapshotStoreForProfile(state.activeAccountProfileId).history();
    const durableResets = state.resets.filter((item) => String(item.id).startsWith('manual-') || String(item.id).startsWith('tibo-reset-'));
    state.resets = mergeById([...durableResets, ...tiboResets]);
  } else {
    state.sourceStatus.Codex = '未找到已登录的 Codex CLI';
    state.resets = mergeById([...state.resets, ...tiboResets]);
  }
  refreshResetEvents();
  state.prediction = predict({ signals: state.signals, resets: state.resets });
  state.lastRunAt = new Date().toISOString();
  state.lastErrors = errors;
  maybeNotify();
  saveState();
  broadcastState();
  updateTrayMenu();
  return state;
}

async function startAccountLogin(type, profileId = state.activeAccountProfileId) {
  if (state.settings.dataMode !== 'account') throw new Error('请先切换到账户增强模式');
  if (!['chatgpt', 'chatgptDeviceCode'].includes(type)) throw new Error('Unsupported login type');
  if (loginClient) throw new Error('A Codex login is already in progress');
  accountProfile(profileId);
  const reloginSameInstance = singleInstanceMode();
  const previousId = state.activeAccountProfileId;
  const runtime = accountRuntimeForProfile(profileId);
  sendLoginProgress(profileId, 'connecting');
  loginClient = await loginClientCache.take(loginRuntimeKey(runtime), { timeoutMs: 20000, ...runtime.codexOptions });
  loginClient.on('account/login/completed', async (params) => {
    const client = loginClient;
    loginClient = null;
    activeLogin = null;
    client?.close();
    if (params.success) {
      try {
        const account = await readProfileAccount(profileId);
        state.accountProfiles = updateProfile(state.accountProfiles, profileId, account);
        if (reloginSameInstance) {
          state.activeAccountProfileId = profileId;
          state.account = accountFromProfile(account);
          state.history = snapshotStoreForProfile(profileId).history();
          state.sourceStatus.Codex = `已在同一 Codex 中重新登录 ${accountProfile(profileId).label}`;
          await launchDesktopProfile(accountRuntimeForProfile(profileId)).catch((error) => {
            state.sourceStatus.Codex = `登录成功，唤醒桌面端失败：${error.message}`;
          });
        }
        saveState();
        broadcastState();
      } catch (error) {
        state.accountProfiles = state.accountProfiles.map((profile) => profile.id === profileId
          ? { ...profile, lastError: error.message, lastCheckedAt: new Date().toISOString() }
          : profile);
      }
      mainWindow?.webContents.send('radar:login-updated', { ...params, profileId });
      await runRadar();
      warmLoginClient(profileId);
    } else {
      if (reloginSameInstance) {
        state.account = { ...state.account, connected: false };
        state.sourceStatus.Codex = `${accountProfile(previousId).label} 已退出，目标账号登录未完成`;
        saveState();
        broadcastState();
      }
      mainWindow?.webContents.send('radar:login-updated', { ...params, profileId });
    }
  });
  loginClient.on('client-error', (error) => {
    const client = loginClient;
    loginClient = null;
    activeLogin = null;
    client?.close();
    if (reloginSameInstance) {
      state.account = { ...state.account, connected: false };
      state.sourceStatus.Codex = `${accountProfile(previousId).label} 已退出，目标账号登录失败：${error.message}`;
      saveState();
      broadcastState();
    }
    mainWindow?.webContents.send('radar:login-updated', { success: false, error: error.message, profileId });
  });
  try {
    if (reloginSameInstance) {
      sendLoginProgress(profileId, 'logging-out');
      await loginClient.request('account/logout');
      state.account = { ...state.account, connected: false };
      state.sourceStatus.Codex = `${accountProfile(previousId).label} 已退出，等待登录 ${accountProfile(profileId).label}`;
      saveState();
      broadcastState();
      sendLoginProgress(profileId, 'logged-out');
    }
    const params = type === 'chatgpt'
      ? { type, useHostedLoginSuccessPage: true, appBrand: 'codex' }
      : { type };
    sendLoginProgress(profileId, 'starting-login');
    activeLogin = { ...(await loginClient.request('account/login/start', params)), profileId, previousId, reloginSameInstance };
    sendLoginProgress(profileId, 'waiting');
    return activeLogin;
  } catch (error) {
    loginClient.close();
    loginClient = null;
    activeLogin = null;
    if (reloginSameInstance) {
      state.account = { ...state.account, connected: false };
      state.sourceStatus.Codex = `${accountProfile(previousId).label} 已退出，无法启动目标账号登录：${error.message}`;
      saveState();
      broadcastState();
    }
    throw error;
  }
}

async function cancelAccountLogin() {
  if (!loginClient || !activeLogin?.loginId) return { cancelled: false };
  const cancelledLogin = activeLogin;
  try {
    await loginClient.request('account/login/cancel', { loginId: activeLogin.loginId });
    if (cancelledLogin.reloginSameInstance) {
      state.account = { ...state.account, connected: false };
      state.sourceStatus.Codex = `${accountProfile(cancelledLogin.previousId).label} 已退出，重新登录已取消`;
      saveState();
      broadcastState();
    }
    return { cancelled: true };
  } finally {
    loginClient.close();
    loginClient = null;
    activeLogin = null;
    warmLoginClient(state.activeAccountProfileId);
  }
}

async function consumeResetCredit({ creditId, idempotencyKey }) {
  if (state.settings.dataMode !== 'account') throw new Error('公开雷达模式不会访问或消费重置卡');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(idempotencyKey || ''))) throw new Error('Invalid idempotency key');
  if (creditId != null && (typeof creditId !== 'string' || creditId.length > 300)) throw new Error('Invalid credit ID');
  const client = await createCodexClient(accountRuntimeForProfile(state.activeAccountProfileId).codexOptions);
  let result;
  try {
    const params = { idempotencyKey };
    if (creditId) params.creditId = creditId;
    result = await client.request('account/rateLimitResetCredit/consume', params);
  } finally {
    client.close();
  }
  const refreshedState = await runRadar();
  return { outcome: result?.outcome || 'unknown', state: refreshedState };
}

async function openAccountDesktop(profileId) {
  const profile = accountProfile(profileId);
  const { runtime, sharedProjectCount } = desktopRuntimeForProfile(profileId);
  const sharedChats = await sharedChatsForProfile(profileId, runtime);
  const result = await launchDesktopProfile(runtime);
  state.accountProfiles = state.accountProfiles.map((item) => item.id === profile.id
    ? { ...item, lastDesktopLaunchAt: new Date().toISOString() }
    : item);
  saveState();
  broadcastState();
  return { ...result, sharedProjectCount, sharedChats };
}

async function switchAccountProfile(profileId) {
  if (state.settings.dataMode !== 'account') throw new Error('请先切换到账户增强模式');
  if (singleInstanceMode()) throw new Error('单实例重新登录模式需要在完整雷达中确认退出，再登录目标账号');
  const previousId = state.activeAccountProfileId;
  const account = await readProfileAccount(profileId);
  if (!account.connected) throw new Error(`${accountProfile(profileId).label} 尚未登录，请先完成官方 OAuth`);
  const { runtime, sharedProjectCount } = desktopRuntimeForProfile(profileId);
  const sharedChats = await sharedChatsForProfile(profileId, runtime);
  await launchDesktopProfile(runtime);
  state.accountProfiles = updateProfile(state.accountProfiles, profileId, account)
    .map((item) => item.id === profileId ? { ...item, lastDesktopLaunchAt: new Date().toISOString() } : item);
  state.activeAccountProfileId = profileId;
  state.account = accountFromProfile(account);
  snapshotStoreForProfile(profileId).record(account);
  state.history = snapshotStoreForProfile(profileId).history();
  state.sourceStatus.Codex = profileId === 'secondary' && state.settings.accountSwitchMode === 'shared-projects'
    ? `已切换至账号 B · ${sharedProjectCount} 个项目 · ${sharedChats.availableChatCount} 条接力聊天`
    : `已切换至 ${accountProfile(profileId).label}`;
  saveState();
  broadcastState();
  updateTrayMenu();
  return { state, previousId, activeId: profileId, sharedProjectCount, sharedChats };
}

function scheduleRadar() {
  clearInterval(timer);
  const minutes = Math.max(5, Number(state.settings.intervalMinutes) || 30);
  timer = setInterval(runRadar, minutes * 60 * 1000);
}

function showWindow() {
  mainWindow?.show();
  mainWindow?.focus();
  hudWindow?.hide();
}

function positionHud() {
  if (!tray || !hudWindow) return;
  const trayBounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  hudWindow.setPosition(...Object.values(hudPosition(trayBounds, hudWindow.getBounds(), display.workArea)));
}

function toggleHud() {
  if (!hudWindow) return;
  if (hudWindow.isVisible()) {
    hudWindow.hide();
    return;
  }
  mainWindow?.hide();
  positionHud();
  hudWindow.show();
  hudWindow.focus();
}

function updateTrayMenu() {
  if (!tray) return;
  const summary = state.prediction ? `${state.prediction.level} · ${state.prediction.probability}%` : '等待预测';
  tray.setToolTip(`Codex Reset Radar · ${summary}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: summary, enabled: false },
    { label: hudWindow?.isVisible() ? '隐藏 HUD' : '显示 HUD', click: toggleHud },
    { label: '打开完整雷达', click: showWindow },
    { label: '立即预测', click: runRadar },
    ...(state.settings.dataMode === 'account' ? [{
      label: '切换 Codex 账号',
      submenu: singleInstanceMode()
        ? [{ label: '打开完整雷达并确认重新登录', click: showWindow }]
        : state.accountProfiles.map((profile) => ({
            label: `${profile.id === state.activeAccountProfileId ? '✓ ' : ''}${profile.label}${profile.connected ? ` · ${profile.remainingPercent}%` : ' · 未登录'}`,
            enabled: profile.id !== state.activeAccountProfileId && profile.connected,
            click: () => switchAccountProfile(profile.id).catch((error) => new Notification({ title: '账号切换失败', body: error.message }).show()),
          })),
    }] : []),
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

function loadRenderer(window, view) {
  const query = new URLSearchParams({ platform: process.platform, version: app.getVersion() });
  if (view) query.set('view', view);
  if (app.isPackaged) window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: Object.fromEntries(query) });
  else window.loadURL(`http://127.0.0.1:5173/?${query}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 1020,
    minHeight: 680,
    backgroundColor: '#070b12',
    ...mainWindowChrome(process.platform),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (process.platform === 'win32') {
    mainWindow.removeMenu();
    mainWindow.setMenuBarVisibility(false);
  }
  loadRenderer(mainWindow);
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
}

function createHudWindow() {
  hudWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 380,
    minHeight: 600,
    maxWidth: 480,
    frame: false,
    show: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#070b12',
    roundedCorners: true,
    hasShadow: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  loadRenderer(hudWindow, 'hud');
  hudWindow.on('close', (event) => {
    if (!app.isQuitting) { event.preventDefault(); hudWindow.hide(); }
  });
  hudWindow.on('show', updateTrayMenu);
  hudWindow.on('hide', updateTrayMenu);
}

function createTray() {
  const appIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon-1024.png')).resize({ width: 20, height: 20 });
  const templateIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-iconTemplate.png'));
  const icon = process.platform === 'darwin' && !templateIcon.isEmpty() ? templateIcon : appIcon;
  if (process.platform === 'darwin' && icon === templateIcon) icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on('click', toggleHud);
  tray.on('double-click', showWindow);
  updateTrayMenu();
}

ipcMain.handle('radar:get-state', () => state);
ipcMain.handle('radar:run', runRadar);
ipcMain.handle('radar:toggle-hud', toggleHud);
ipcMain.handle('radar:show-main', showWindow);
ipcMain.handle('radar:hide-hud', () => hudWindow?.hide());
ipcMain.handle('radar:start-login', (_, type, profileId) => startAccountLogin(type, profileId));
ipcMain.handle('radar:cancel-login', cancelAccountLogin);
ipcMain.handle('radar:switch-account-profile', (_, profileId) => switchAccountProfile(profileId));
ipcMain.handle('radar:open-account-desktop', (_, profileId) => openAccountDesktop(profileId));
ipcMain.handle('radar:consume-reset-credit', (_, args) => consumeResetCredit(args || {}));
ipcMain.handle('radar:save-settings', async (_, settings) => {
  if (settings.dataMode && !['public', 'account'].includes(settings.dataMode)) throw new Error('Invalid data mode');
  if (settings.accountSwitchMode && !['isolated', 'shared-projects', 'single-instance'].includes(settings.accountSwitchMode)) throw new Error('Invalid account switch mode');
  if (settings.signalChannel && !['x', 'xiaohongshu'].includes(settings.signalChannel)) throw new Error('Invalid signal channel');
  if (settings.llmProvider && !LLM_PROVIDERS[settings.llmProvider]) throw new Error('Invalid LLM provider');
  if (settings.accountSwitchMode === 'single-instance' && state.settings.accountSwitchMode !== 'single-instance') {
    state.activeAccountProfileId = 'primary';
    state.account = accountFromProfile(accountProfile('primary'));
  }
  state.settings = { ...state.settings, ...settings };
  app.setLoginItemSettings({ openAtLogin: Boolean(state.settings.launchAtLogin), openAsHidden: true });
  saveState();
  scheduleRadar();
  const next = await runRadar();
  warmLoginClient();
  return next;
});
ipcMain.handle('radar:save-account', (_, account) => {
  state.account = { ...state.account, ...account };
  saveState();
  return state;
});
ipcMain.handle('radar:add-reset', (_, record) => {
  const at = new Date(record.at || Date.now());
  if (!Number.isFinite(at.getTime())) throw new Error('重置时间无效');
  const source = String(record.source || '手动确认').trim().slice(0, 80) || '手动确认';
  const duplicate = state.resets.find((item) => String(item.id).startsWith('manual-')
    && item.source === source && Math.abs(new Date(item.at) - at) < 60 * 1000);
  if (!duplicate) state.resets.push({ id: `manual-${Date.now()}`, at: at.toISOString(), source, demo: false });
  refreshResetEvents();
  state.prediction = predict({ signals: state.signals, resets: state.resets });
  saveState();
  broadcastState();
  updateTrayMenu();
  return state;
});
ipcMain.handle('radar:delete-reset', (_, id) => {
  if (!String(id || '').startsWith('manual-')) throw new Error('只能删除手动补记');
  state.resets = state.resets.filter((item) => item.id !== id);
  refreshResetEvents();
  state.prediction = predict({ signals: state.signals, resets: state.resets });
  saveState();
  broadcastState();
  updateTrayMenu();
  return state;
});
ipcMain.handle('radar:import-tibo-post', async (_, url) => {
  const signal = await fetchTiboPostFromUrl(url);
  state.tiboEvidence = mergeById([...(state.tiboEvidence || []), signal])
    .sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt))
    .slice(0, 1000);
  state.signals = [...state.tiboEvidence];
  const reset = resetRecordFromSignal(signal);
  if (reset) state.resets = mergeById([reset, ...state.resets]);
  state.mode = 'live';
  refreshResetEvents();
  state.prediction = predict({ signals: state.signals, resets: state.resets });
  saveState();
  broadcastState();
  return state;
});
ipcMain.handle('radar:save-minimax-key', async (_, value) => {
  const key = String(value || '').trim().replace(/^Bearer\s+/i, '');
  if (!/^sk-[A-Za-z0-9_-]{12,}$/.test(key)) throw new Error('MiniMax Subscription Key 格式不正确');
  const { region } = await testMiniMaxKey(key);
  secretStore.set('minimax', key);
  const regionLabel = region === 'cn' ? '中国大陆站' : '国际站';
  state.integrations.minimax = { configured: true, status: 'connected', message: `${MINIMAX_MODEL} 连接成功 · ${regionLabel}`, model: MINIMAX_MODEL, region };
  saveState();
  return state;
});
ipcMain.handle('radar:clear-minimax-key', () => {
  secretStore.clear('minimax');
  state.integrations.minimax = { configured: false, status: 'unconfigured', message: '尚未配置 MiniMax Subscription Key', model: MINIMAX_MODEL, region: null };
  saveState();
  return state;
});
ipcMain.handle('radar:get-llm-providers', () => Object.entries(LLM_PROVIDERS).map(([id, config]) => ({ id, label: config.label, models: config.models, keyOptional: Boolean(config.keyOptional) })));
ipcMain.handle('radar:get-opencli-profiles', () => listOpenCliProfiles().catch(() => []));
ipcMain.handle('radar:save-llm-key', async (_, args) => {
  const provider = String(args?.provider || '');
  const config = LLM_PROVIDERS[provider];
  if (!config) throw new Error('请选择有效的大模型服务商');
  const model = String(args?.model || config.models[0]).trim();
  const key = String(args?.key || '').trim().replace(/^Bearer\s+/i, '');
  if (!key && !config.keyOptional) throw new Error(`${config.label} 需要 API Key`);
  await testLlmConnection({ provider, model, apiKey: key });
  if (key) secretStore.set(`llm-${provider}`, key);
  state.settings = { ...state.settings, llmProvider: provider, llmModel: model };
  state.integrations.llm = { configured: true, status: 'connected', message: `${model} 连接成功`, provider, model };
  saveState();
  broadcastState();
  return state;
});
ipcMain.handle('radar:clear-llm-key', (_, providerValue) => {
  const provider = String(providerValue || state.settings.llmProvider || 'minimax');
  secretStore.clear(`llm-${provider}`);
  if (provider === 'minimax') secretStore.clear('minimax');
  state.integrations.llm = { configured: false, status: 'unconfigured', message: '密钥已移除 · 使用本地规则', provider, model: state.settings.llmModel };
  saveState();
  broadcastState();
  return state;
});
ipcMain.handle('radar:open-external', (_, url) => {
  if (/^https:\/\//.test(url)) return shell.openExternal(url);
});

app.whenReady().then(async () => {
  state = loadState();
  snapshotStore = new SnapshotStore(path.join(app.getPath('userData'), 'history'));
  secretStore = new SecretStore(path.join(app.getPath('userData'), 'secrets'), safeStorage);
  const provider = state.settings.llmProvider || 'minimax';
  const configured = LLM_PROVIDERS[provider]?.keyOptional || secretStore.has(`llm-${provider}`) || (provider === 'minimax' && secretStore.has('minimax'));
  state.integrations.llm = { ...state.integrations.llm, configured: Boolean(configured), provider, model: state.settings.llmModel || LLM_PROVIDERS[provider]?.models[0] };
  state.integrations.minimax.configured = provider === 'minimax' && Boolean(configured);
  state.history = snapshotStore.history();
  refreshResetEvents();
  createWindow();
  createHudWindow();
  createTray();
  scheduleRadar();
  await runRadar();
  warmLoginClient();
});
app.on('activate', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', () => { app.isQuitting = true; loginClient?.close(); loginClientCache.close(); });

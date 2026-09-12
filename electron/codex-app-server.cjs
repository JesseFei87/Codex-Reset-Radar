const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findCodexBinary({
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  homedir = os.homedir(),
  existsSync = fs.existsSync,
  resourcesPath = process.resourcesPath,
} = {}) {
  if (env.CODEX_BINARY) return env.CODEX_BINARY;
  const join = platform === 'win32' ? path.win32.join : path.join;
  const windowsTarget = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const windowsPackage = arch === 'arm64' ? 'codex-win32-arm64' : 'codex-win32-x64';
  const npmRoot = join(env.APPDATA || join(homedir, 'AppData', 'Roaming'), 'npm');
  const candidates = platform === 'win32'
    ? [
        join(env.LOCALAPPDATA || '', 'Programs', 'ChatGPT', 'resources', 'codex.exe'),
        join(env.LOCALAPPDATA || '', 'Programs', 'ChatGPT', 'resources', 'bin', 'codex.exe'),
        join(env.LOCALAPPDATA || '', 'Programs', 'Codex', 'resources', 'codex.exe'),
        join(env.LOCALAPPDATA || '', 'Programs', 'Codex', 'resources', 'bin', 'codex.exe'),
        join(env.ProgramFiles || env.PROGRAMFILES || '', 'ChatGPT', 'resources', 'codex.exe'),
        join(env.ProgramFiles || env.PROGRAMFILES || '', 'Codex', 'resources', 'codex.exe'),
        resourcesPath && join(resourcesPath, 'codex-runtime', 'bin', 'codex.exe'),
        join(npmRoot, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', windowsPackage, 'vendor', windowsTarget, 'bin', 'codex.exe'),
        join(npmRoot, 'node_modules', '@openai', 'codex', 'vendor', windowsTarget, 'bin', 'codex.exe'),
        join(npmRoot, 'codex.cmd'),
      ]
    : platform === 'darwin'
      ? [
          '/Applications/ChatGPT.app/Contents/Resources/codex',
          path.join(homedir, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex'),
          '/Applications/Codex.app/Contents/Resources/codex',
          resourcesPath && path.join(resourcesPath, 'codex-runtime', 'bin', 'codex'),
          '/opt/homebrew/bin/codex',
          '/usr/local/bin/codex',
        ]
      : ['/usr/local/bin/codex', path.join(homedir, '.local', 'bin', 'codex')];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || 'codex';
}

function buildCodexLaunch(binary, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(binary)) {
    if (binary.includes('"')) throw new Error('CODEX_BINARY contains an invalid quote');
    return {
      command: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', `""${binary}" app-server --stdio"`],
    };
  }
  return { command: binary, args: ['app-server', '--stdio'] };
}

function startCodex(binary, env = process.env) {
  const launch = buildCodexLaunch(binary, { env });
  return spawn(launch.command, launch.args, {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

class CodexAppServerClient extends EventEmitter {
  constructor({ binary, timeoutMs = 15000, env = process.env, capabilities = null } = {}) {
    super();
    this.env = env;
    this.binary = binary || findCodexBinary({ env });
    this.capabilities = capabilities;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.child = null;
    this.closed = false;
  }

  async start() {
    this.child = startCodex(this.binary, this.env);
    this.child.once('error', (error) => this.failAll(new Error(`Unable to start Codex CLI: ${error.message}`)));
    this.child.stderr.on('data', (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-2000); });
    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.once('exit', (code) => {
      if (!this.closed) {
        const detail = this.stderr ? `: ${this.stderr.trim()}` : '';
        const hint = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.binary)
          ? '。当前正在回退使用 npm Codex 启动脚本；请运行 npm install -g @openai/codex@latest 后重试'
          : '';
        this.failAll(new Error(`Codex app-server exited with code ${code}${detail}${hint}`));
      }
    });
    await this.request('initialize', {
      clientInfo: { name: 'codex_reset_radar', title: 'Codex Reset Radar', version: '0.8.1' },
      ...(this.capabilities ? { capabilities: this.capabilities } : {}),
    });
    this.notify('initialized', {});
    return this;
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || 'Codex request failed'));
        else pending.resolve(message.result ?? null);
      } else if (message.method) {
        this.emit('notification', message);
        this.emit(message.method, message.params || {});
      }
    }
  }

  request(method, params) {
    if (!this.child || this.closed) return Promise.reject(new Error('Codex app-server is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      const message = params === undefined ? { method, id } : { method, id, params };
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params) {
    if (!this.child || this.closed) return;
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('client-error', error);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Codex app-server closed'));
    }
    this.pending.clear();
    this.child?.kill();
  }
}

async function createCodexClient(options) {
  const client = new CodexAppServerClient(options);
  return client.start();
}

async function queryCodexAccount(options = {}) {
  const client = await createCodexClient(options);
  try {
    const [account, rateLimits, usage] = await Promise.all([
      client.request('account/read', { refreshToken: false }),
      client.request('account/rateLimits/read'),
      client.request('account/usage/read').catch(() => null),
    ]);
    return { account, rateLimits, usage };
  } finally {
    client.close();
  }
}

function normalizeWindow(window, bucket, lane) {
  if (!window) return null;
  const minutes = window.windowDurationMins ?? null;
  const label = minutes === 300 ? '5 小时额度' : minutes === 10080 ? '每周额度' : `${bucket} ${lane}`;
  return {
    id: `${bucket}:${lane}`,
    label,
    usedPercent: Number(window.usedPercent || 0),
    remainingPercent: Math.max(0, 100 - Number(window.usedPercent || 0)),
    windowDurationMins: minutes,
    resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

function normalizeCodexAccount(payload) {
  const ratePayload = payload.rateLimits || {};
  const buckets = ratePayload.rateLimitsByLimitId || { codex: ratePayload.rateLimits };
  const usageWindows = Object.entries(buckets || {}).flatMap(([bucket, snapshot]) => [
    normalizeWindow(snapshot?.primary, bucket, 'primary'),
    normalizeWindow(snapshot?.secondary, bucket, 'secondary'),
  ]).filter(Boolean);
  const constrained = usageWindows.reduce((value, window) => Math.min(value, window.remainingPercent), 100);
  const nextReset = usageWindows
    .map((window) => window.resetsAt)
    .filter((value) => value && new Date(value) > new Date())
    .sort()[0] || null;
  const creditSummary = ratePayload.rateLimitResetCredits || null;
  const cards = (creditSummary?.credits || []).map((credit) => ({
    id: credit.id,
    label: credit.title || 'Codex 重置卡',
    description: credit.description || '',
    expiresAt: credit.expiresAt ? new Date(credit.expiresAt * 1000).toISOString() : null,
    grantedAt: credit.grantedAt ? new Date(credit.grantedAt * 1000).toISOString() : null,
    status: credit.status,
    demo: false,
  }));
  return {
    connected: Boolean(payload.account?.account),
    source: 'codex-app-server',
    plan: payload.account?.account?.planType || 'Codex account',
    email: payload.account?.account?.email || null,
    accountId: payload.account?.account?.accountId || payload.account?.account?.id || null,
    remainingPercent: constrained,
    nextNaturalReset: nextReset,
    usageWindows,
    cards,
    resetCreditAvailableCount: creditSummary?.availableCount ?? 0,
    officialUsage: payload.usage || null,
  };
}

module.exports = { buildCodexLaunch, CodexAppServerClient, createCodexClient, findCodexBinary, normalizeCodexAccount, queryCodexAccount };

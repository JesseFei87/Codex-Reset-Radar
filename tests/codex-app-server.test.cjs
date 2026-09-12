const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCodexLaunch, findCodexBinary, normalizeCodexAccount } = require('../electron/codex-app-server.cjs');

test('prefers the ChatGPT desktop Codex binary before a system CLI on macOS', () => {
  const desktopBinary = '/Applications/ChatGPT.app/Contents/Resources/codex';
  const systemBinary = '/usr/local/bin/codex';
  const result = findCodexBinary({
    platform: 'darwin',
    env: {},
    homedir: '/Users/example',
    existsSync: (candidate) => candidate === desktopBinary || candidate === systemBinary,
  });
  assert.equal(result, desktopBinary);
});

test('uses the packaged Codex runtime before falling back to a system CLI', () => {
  const bundled = '/Radar.app/Contents/Resources/codex-runtime/bin/codex';
  const system = '/usr/local/bin/codex';
  const result = findCodexBinary({ platform: 'darwin', env: {}, homedir: '/Users/example', resourcesPath: '/Radar.app/Contents/Resources', existsSync: (candidate) => candidate === bundled || candidate === system });
  assert.equal(result, bundled);
});

test('keeps CODEX_BINARY as the explicit highest-priority override', () => {
  const result = findCodexBinary({
    platform: 'darwin',
    env: { CODEX_BINARY: '/custom/codex' },
    existsSync: () => false,
  });
  assert.equal(result, '/custom/codex');
});

test('prefers the native npm Codex executable over codex.cmd on Windows', () => {
  const nativeBinary = 'C:\\Users\\example\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';
  const commandWrapper = 'C:\\Users\\example\\AppData\\Roaming\\npm\\codex.cmd';
  const result = findCodexBinary({
    platform: 'win32',
    arch: 'x64',
    env: { APPDATA: 'C:\\Users\\example\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' },
    homedir: 'C:\\Users\\example',
    existsSync: (candidate) => candidate === nativeBinary || candidate === commandWrapper,
  });
  assert.equal(result, nativeBinary);
});

test('wraps a Windows cmd launcher with the outer quotes required by cmd /s /c', () => {
  const binary = 'C:\\Users\\Example User\\AppData\\Roaming\\npm\\codex.cmd';
  const launch = buildCodexLaunch(binary, { platform: 'win32', env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' } });
  assert.equal(launch.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(launch.args, ['/d', '/s', '/c', `""${binary}" app-server --stdio"`]);
});

test('normalizes official rate-limit windows and reset-credit details', () => {
  const result = normalizeCodexAccount({
    account: { account: { type: 'chatgpt', planType: 'pro', email: 'user@example.com', accountId: 'acct-1' } },
    rateLimits: {
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1787500000 },
        secondary: { usedPercent: 60, windowDurationMins: 10080, resetsAt: 1787600000 },
      },
      rateLimitResetCredits: {
        availableCount: 1,
        credits: [{ id: 'credit-1', title: 'Full reset', expiresAt: 1787700000, status: 'available' }],
      },
    },
    usage: null,
  });
  assert.equal(result.connected, true);
  assert.equal(result.plan, 'pro');
  assert.equal(result.email, 'user@example.com');
  assert.equal(result.accountId, 'acct-1');
  assert.equal(result.remainingPercent, 40);
  assert.deepEqual(result.usageWindows.map((window) => window.label), ['5 小时额度', '每周额度']);
  assert.equal(result.resetCreditAvailableCount, 1);
  assert.equal(result.cards[0].id, 'credit-1');
});

test('handles accounts without reset-credit details', () => {
  const result = normalizeCodexAccount({
    account: { account: { type: 'chatgpt', planType: 'plus' } },
    rateLimits: { rateLimits: { primary: null, secondary: null }, rateLimitResetCredits: null },
    usage: null,
  });
  assert.equal(result.remainingPercent, 100);
  assert.deepEqual(result.cards, []);
  assert.equal(result.resetCreditAvailableCount, 0);
});

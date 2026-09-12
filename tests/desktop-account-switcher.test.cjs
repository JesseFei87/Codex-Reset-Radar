const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDesktopLaunch, findChatGptBinary } = require('../electron/desktop-account-switcher.cjs');

test('finds the installed ChatGPT desktop executable on macOS', () => {
  const binary = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT';
  assert.equal(findChatGptBinary({ platform: 'darwin', existsSync: (candidate) => candidate === binary }), binary);
});

test('finds the per-user ChatGPT desktop executable on Windows', () => {
  const binary = 'C:\\Users\\Example\\AppData\\Local\\Programs\\ChatGPT\\ChatGPT.exe';
  assert.equal(findChatGptBinary({
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' },
    homedir: 'C:\\Users\\Example',
    existsSync: (candidate) => candidate === binary,
  }), binary);
});

test('isolated launch uses matching ChatGPT and Codex profile directories', () => {
  const launch = buildDesktopLaunch('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT', {
    desktopUserData: '/profiles/b/desktop',
    codexHome: '/profiles/b/codex',
  }, { platform: 'darwin', env: { PATH: '/usr/bin' } });
  assert.deepEqual(launch.args, ['--user-data-dir=/profiles/b/desktop']);
  assert.equal(launch.env.CODEX_HOME, '/profiles/b/codex');
});

test('system launch keeps the existing account profile untouched', () => {
  const env = { PATH: '/usr/bin' };
  const launch = buildDesktopLaunch('/Applications/ChatGPT.app/Contents/MacOS/ChatGPT', {
    desktopUserData: null,
    codexHome: null,
  }, { platform: 'darwin', env });
  assert.deepEqual(launch.args, []);
  assert.equal(launch.env, env);
});

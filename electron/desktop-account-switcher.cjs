const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findChatGptBinary({
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
  existsSync = fs.existsSync,
} = {}) {
  const join = platform === 'win32' ? path.win32.join : path.join;
  const candidates = platform === 'darwin'
    ? [
        '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
        join(homedir, 'Applications', 'ChatGPT.app', 'Contents', 'MacOS', 'ChatGPT'),
        '/Applications/Codex.app/Contents/MacOS/Codex',
      ]
    : platform === 'win32'
      ? [
          join(env.LOCALAPPDATA || '', 'Programs', 'ChatGPT', 'ChatGPT.exe'),
          join(env.LOCALAPPDATA || '', 'Programs', 'Codex', 'Codex.exe'),
          join(env.ProgramFiles || env.PROGRAMFILES || '', 'ChatGPT', 'ChatGPT.exe'),
          join(env.ProgramFiles || env.PROGRAMFILES || '', 'Codex', 'Codex.exe'),
        ]
      : [];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

function buildDesktopLaunch(binary, runtime, { platform = process.platform, env = process.env } = {}) {
  if (!binary) throw new Error('未找到 ChatGPT/Codex 桌面端，请先安装最新版桌面应用');
  if (!['darwin', 'win32'].includes(platform)) throw new Error('当前系统暂不支持桌面账号切换');
  const args = runtime.desktopUserData ? [`--user-data-dir=${runtime.desktopUserData}`] : [];
  const childEnv = runtime.codexHome ? { ...env, CODEX_HOME: runtime.codexHome } : env;
  return { command: binary, args, env: childEnv };
}

function launchDesktopProfile(runtime, options = {}) {
  const binary = options.binary || findChatGptBinary(options);
  const launch = buildDesktopLaunch(binary, runtime, options);
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      env: launch.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve({ launched: true, pid: child.pid });
    });
  });
}

module.exports = { buildDesktopLaunch, findChatGptBinary, launchDesktopProfile };

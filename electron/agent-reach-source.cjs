const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const BRIDGE = [
  'import os, sys',
  'from agent_reach.config import Config',
  'from agent_reach.channels.twitter import twitter_cli_child_env',
  'env = os.environ.copy()',
  'env.update(twitter_cli_child_env(Config(read_only=True)))',
  'os.execvpe(sys.argv[1], sys.argv[1:], env)',
].join('; ');

function resolveAgentReach(env = process.env, platform = process.platform, homedir = os.homedir()) {
  const windows = platform === 'win32';
  const venv = env.AGENT_REACH_VENV || path.join(homedir, '.agent-reach-venv');
  const pythonCandidates = [
    env.AGENT_REACH_PYTHON,
    windows ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python'),
    windows ? path.join(venv, 'Scripts', 'python3.exe') : path.join(venv, 'bin', 'python3'),
  ].filter(Boolean);
  const twitterCandidates = [
    env.AGENT_REACH_TWITTER,
    windows ? path.join(venv, 'Scripts', 'twitter.exe') : path.join(venv, 'bin', 'twitter'),
  ].filter(Boolean);
  const python = pythonCandidates.find((candidate) => fs.existsSync(candidate));
  const twitter = twitterCandidates.find((candidate) => fs.existsSync(candidate));
  if (!python || !twitter) return null;
  return { python, twitter, venv };
}

function normalizeTweet(tweet) {
  return {
    id: String(tweet.id),
    text: String(tweet.text || ''),
    created_at: tweet.createdAtISO || tweet.created_at,
    metrics: tweet.metrics || null,
    quotedTweet: tweet.quotedTweet || null,
  };
}

async function fetchTiboTimeline({ limit = 20, execImpl = execFileAsync, runtime = resolveAgentReach() } = {}) {
  if (!runtime) throw new Error('未找到 Agent Reach；请先安装并配置 Twitter/X 渠道');
  const args = ['-c', BRIDGE, runtime.twitter, 'user-posts', 'thsottiaux', '-n', String(limit), '--json'];
  let stdout;
  try {
    ({ stdout } = await execImpl(runtime.python, args, {
      timeout: limit > 200 ? 120000 : 60000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }));
  } catch (error) {
    const detail = String(error.stderr || error.message || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
    throw new Error(`Agent Reach 读取 Tibo 失败${detail ? `：${detail.slice(0, 240)}` : ''}`);
  }
  let payload;
  try {
    payload = JSON.parse(String(stdout));
  } catch {
    throw new Error('Agent Reach 返回了无法解析的数据');
  }
  if (payload.ok === false) throw new Error(payload.error || 'Twitter/X 登录验证失败');
  const records = Array.isArray(payload) ? payload : payload.data;
  if (!Array.isArray(records)) throw new Error('Agent Reach 未返回 Tibo 时间线');
  return records.filter((tweet) => tweet?.id && tweet?.text && (tweet.createdAtISO || tweet.created_at)).map(normalizeTweet);
}

module.exports = { BRIDGE, fetchTiboTimeline, normalizeTweet, resolveAgentReach };

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const QUERY = 'tibo重置';

function resolveOpenCli(env = process.env, platform = process.platform, homedir = os.homedir(), resourcesPath = process.resourcesPath) {
  const windows = platform === 'win32';
  const executable = windows ? 'opencli.cmd' : 'opencli';
  const candidates = [
    env.OPENCLI_BINARY,
    resourcesPath && path.join(resourcesPath, 'opencli', executable),
    windows && path.join(env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), 'npm', executable),
    path.join(homedir, '.local', 'bin', executable),
    '/opt/homebrew/bin/opencli',
    '/usr/local/bin/opencli',
  ].filter(Boolean);
  const binary = candidates.find((candidate) => fs.existsSync(candidate));
  if (binary) return { command: binary, argsPrefix: [] };
  const localMain = path.join(homedir, '.local', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
  const nodeCandidates = [env.OPENCLI_NODE, windows && path.join(env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'), '/opt/homebrew/bin/node', '/usr/local/bin/node'].filter(Boolean);
  const node = nodeCandidates.find((candidate) => fs.existsSync(candidate));
  if (node && fs.existsSync(localMain)) return { command: node, argsPrefix: [localMain] };
  return null;
}

function noteId(url) {
  return String(url || '').match(/\/(?:search_result|explore)\/([a-z0-9]+)/i)?.[1] || null;
}

function beijingIso(date, hour = 12, minute = 0) {
  const match = String(date || '').match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 8, minute)).toISOString();
}

function expectedFromTitle(title, publishedAt) {
  const explicitDate = String(title).match(/(?:(20\d{2})[年/.\-])?(\d{1,2})[月/.\-](\d{1,2})日?/);
  const clock = String(title).match(/(?:(上午|下午|晚上|中午)\s*)?(\d{1,2})(?:[:点时](\d{1,2})?)\s*(?:分)?/);
  if (!clock) return null;
  const published = new Date(publishedAt);
  const local = new Date(published.getTime() + 8 * 36e5);
  const year = explicitDate?.[1] ? Number(explicitDate[1]) : local.getUTCFullYear();
  const month = explicitDate ? Number(explicitDate[2]) : local.getUTCMonth() + 1;
  const day = explicitDate ? Number(explicitDate[3]) : local.getUTCDate();
  let hour = Number(clock[2]);
  if (['下午', '晚上'].includes(clock[1]) && hour < 12) hour += 12;
  if (clock[1] === '中午' && hour < 11) hour += 12;
  return new Date(Date.UTC(year, month - 1, day, hour - 8, Number(clock[3] || 0))).toISOString();
}

function classifyXhsNote(note) {
  const title = String(note.title || '').trim();
  const id = noteId(note.url);
  if (!id || !title || !/tibo|codex|astra/i.test(title) || !/重置|额度/.test(title)) return null;
  const publishedAt = beijingIso(note.published_at) || new Date().toISOString();
  const confirmed = /已(?:经)?重置|重置(?:完成|成功|到账|已到)|按了/.test(title);
  const scheduled = !confirmed && /预告|将|即将|预计|预测|前|左右|今天|时间/.test(title);
  const likes = Number(String(note.likes || '').replace(/[^\d.]/g, '')) || 0;
  return {
    id: `tibo-xhs-${id}`,
    source: '小红书',
    author: String(note.author || '小红书用户'),
    title,
    summary: title,
    confidence: Math.min(0.82, 0.52 + Math.log10(likes + 1) * 0.1),
    publishedAt,
    expectedResetAt: scheduled ? expectedFromTitle(title, publishedAt) : null,
    evidenceKind: confirmed ? 'confirmed' : scheduled ? 'scheduled' : 'context',
    authority: 'community',
    scope: '小红书社区转述',
    url: String(note.url),
    metrics: { likes },
    demo: false,
  };
}

function parseSearchOutput(stdout) {
  const payload = JSON.parse(String(stdout));
  if (!Array.isArray(payload)) throw new Error('OpenCLI 未返回小红书搜索列表');
  return payload.map(classifyXhsNote).filter(Boolean);
}

async function listOpenCliProfiles({ execImpl = execFileAsync, runtime = resolveOpenCli() } = {}) {
  if (!runtime) return [];
  const { stdout } = await execImpl(runtime.command, [...runtime.argsPrefix, 'profile', 'list'], { timeout: 15000, maxBuffer: 1024 * 1024, env: process.env });
  return [...String(stdout).matchAll(/^\s+([a-z0-9_-]+)\s+—\s+connected/gim)].map((match) => match[1]);
}

async function fetchXiaohongshuSignals({ profile, execImpl = execFileAsync, runtime = resolveOpenCli() } = {}) {
  if (!runtime) throw new Error('未找到 OpenCLI；请安装 Agent Reach 的小红书渠道');
  const args = [...runtime.argsPrefix, ...(profile ? ['--profile', profile] : []), 'xiaohongshu', 'search', QUERY, '-f', 'json', '--window', 'background'];
  try {
    const { stdout } = await execImpl(runtime.command, args, { timeout: 60000, maxBuffer: 8 * 1024 * 1024, env: process.env });
    return parseSearchOutput(stdout);
  } catch (error) {
    const detail = String(error.stderr || error.message || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
    throw new Error(`小红书读取失败${detail ? `：${detail.slice(0, 240)}` : ''}`);
  }
}

module.exports = { QUERY, classifyXhsNote, expectedFromTitle, fetchXiaohongshuSignals, listOpenCliProfiles, noteId, parseSearchOutput, resolveOpenCli };

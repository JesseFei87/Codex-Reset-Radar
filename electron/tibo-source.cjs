const TIBO_USERNAME = 'thsottiaux';
const TIBO_AUTHOR = '@thsottiaux';
const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const AUTHOR_TIME_ZONE = 'America/Los_Angeles';

function timeZoneParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function zonedEndOfDay(value, dayOffset, timeZone = AUTHOR_TIME_ZONE) {
  const local = timeZoneParts(value, timeZone);
  const targetDay = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset));
  const desired = {
    year: targetDay.getUTCFullYear(),
    month: targetDay.getUTCMonth() + 1,
    day: targetDay.getUTCDate(),
    hour: 23,
    minute: 59,
    second: 59,
  };
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second);
  let guess = desiredAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const actual = timeZoneParts(guess, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desiredAsUtc - actualAsUtc;
  }
  return new Date(guess).toISOString();
}

function zonedDateTime(parts, timeZone = AUTHOR_TIME_ZONE) {
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0, parts.second || 0);
  let guess = desiredAsUtc;
  for (let index = 0; index < 3; index += 1) {
    const actual = timeZoneParts(guess, timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += desiredAsUtc - actualAsUtc;
  }
  return new Date(guess).toISOString();
}

function timeMention(text) {
  const match = String(text).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:PST|PDT|Pacific)?\b/i);
  if (!match || (!match[3] && !/PST|PDT|Pacific/i.test(match[0]))) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = match[3]?.toLowerCase();
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function expectedResetAt(text, publishedAt) {
  const hours = text.match(/\bin\s+(\d{1,2})\s+hours?\b/i);
  if (hours) return new Date(new Date(publishedAt).getTime() + Number(hours[1]) * 36e5).toISOString();
  const days = text.match(/\b(?:in|next)\s+(\d{1,2})\s+days?\b/i);
  if (days) return zonedEndOfDay(publishedAt, Number(days[1]));
  if (/\btomorrow\b/i.test(text)) {
    const exact = timeMention(text);
    if (exact) {
      const local = timeZoneParts(publishedAt, AUTHOR_TIME_ZONE);
      const target = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
      return zonedDateTime({
        year: target.getUTCFullYear(), month: target.getUTCMonth() + 1, day: target.getUTCDate(),
        hour: exact.hour, minute: exact.minute, second: 0,
      });
    }
    return zonedEndOfDay(publishedAt, 1);
  }
  if (/\b(?:later today|today)\b/i.test(text)) return zonedEndOfDay(publishedAt, 0);
  return null;
}

function classifyTiboPost(post) {
  const text = String(post.text || '').trim();
  const searchableText = `${text}\n${String(post.context_text || '')}`;
  const mentionsCodex = /\bcodex\b/i.test(searchableText);
  const tiboGlobalReset = /\b(?:all paid subscriptions?|all (?:plus|pro|business|paid) users?|plus,?\s+pro\s+and\s+business|global reset|astra users?)\b/i.test(searchableText)
    && /\breset(?:s|ting)?\b/i.test(searchableText);
  const mentionsReset = /\b(?:reset(?:s|ting)?|rate\s*limits?|usage\s*limits?|quota|banked\s+reset|credits?)\b/i.test(searchableText);
  if ((!mentionsCodex && !tiboGlobalReset) || !mentionsReset || !post.id || !post.created_at) return null;

  const scheduled = (/\b(?:will|going to|plan(?:ning)? to|tomorrow|later today|next\s+\d+\s+days?|in\s+\d+\s+hours?)\b/i.test(text)
    || /\b(?:reset\s+is(?:\s+also)?\s+landing|lands?\s+(?:by|around|at|end))\b/i.test(text))
    && /\breset/i.test(text);
  const confirmed = !scheduled && (
    /\b(?:we|i)\s+(?:have|'ve|just|now)?\s*reset\b/i.test(text)
    || /\b(?:have been|were|are now)\s+reset\b/i.test(text)
    || /\breset\s+(?:all|the|your|codex|usage|rate)/i.test(text)
    || /\breset\s+has\s+landed\b/i.test(text)
    || /\breset\s+has\s+been\s+(?:propagated|applied|rolled\s+out|completed)\b/i.test(text)
    || /\breset\s+is\s+(?:live|done|complete)\b/i.test(text)
    || /\ball reset for everyone\b/i.test(text)
  );
  const evidenceKind = confirmed ? 'confirmed' : scheduled ? 'scheduled' : 'context';
  const titles = {
    confirmed: 'Tibo 确认 Codex 额度已重置',
    scheduled: 'Tibo 预告 Codex 额度重置',
    context: 'Tibo 发布 Codex 额度相关消息',
  };
  return {
    id: `tibo-x-${post.id}`,
    source: 'X',
    author: TIBO_AUTHOR,
    title: titles[evidenceKind],
    summary: text,
    confidence: confirmed ? 1 : scheduled ? 0.98 : 0.92,
    publishedAt: new Date(post.created_at).toISOString(),
    expectedResetAt: scheduled ? expectedResetAt(text, post.created_at) : null,
    evidenceKind,
    authority: 'codex-lead',
    url: `https://x.com/${TIBO_USERNAME}/status/${post.id}`,
    demo: false,
  };
}

function classifyTiboTimeline(posts) {
  const ordered = [...posts].sort((left, right) => new Date(left.created_at) - new Date(right.created_at));
  const signals = [];
  let lastScheduled = null;
  for (const post of ordered) {
    const quotedText = post.quotedTweet?.text || post.quoted_tweet?.text || '';
    const isCorrection = /\b(?:meant|correction|correcting|actually)\b/i.test(String(post.text || ''))
      || (/\b(?:land(?:s|ing)?|reset)\b/i.test(String(post.text || '')) && String(post.text || '').length < 80);
    const correctionTime = timeMention(post.text);
    const ageMs = lastScheduled ? new Date(post.created_at) - new Date(lastScheduled.publishedAt) : Infinity;
    if (isCorrection && correctionTime && lastScheduled?.expectedResetAt && ageMs >= 0 && ageMs <= 6 * 36e5) {
      const target = timeZoneParts(lastScheduled.expectedResetAt, AUTHOR_TIME_ZONE);
      lastScheduled.expectedResetAt = zonedDateTime({
        year: target.year, month: target.month, day: target.day,
        hour: correctionTime.hour, minute: correctionTime.minute, second: 0,
      });
      lastScheduled.summary += `\n\n时间修正：${String(post.text).trim()}`;
      lastScheduled.supportingPostIds.push(String(post.id));
      lastScheduled.confidence = 1;
      continue;
    }

    const signal = classifyTiboPost({ ...post, context_text: quotedText });
    if (signal) {
      signal.metrics = post.metrics || null;
      signal.supportingPostIds = [];
      signals.push(signal);
      if (signal.evidenceKind === 'scheduled') lastScheduled = signal;
    }
  }
  return signals.sort((left, right) => new Date(right.publishedAt) - new Date(left.publishedAt));
}

function resetRecordFromSignal(signal) {
  if (signal.evidenceKind !== 'confirmed') return null;
  return {
    id: `tibo-reset-${signal.id}`,
    at: signal.publishedAt,
    source: 'Tibo @thsottiaux 公告',
    evidenceSignalId: signal.id,
    url: signal.url,
    demo: false,
  };
}

function signalNeedsUpdate(signal, existing) {
  if (!existing) return true;
  return existing.evidenceKind !== signal.evidenceKind
    || existing.expectedResetAt !== signal.expectedResetAt
    || existing.summary !== signal.summary
    || JSON.stringify(existing.supportingPostIds || []) !== JSON.stringify(signal.supportingPostIds || []);
}

function repairStoredSignal(signal) {
  if (!signal || signal.authority !== 'codex-lead' || signal.evidenceKind === 'confirmed') return signal;
  const id = String(signal.id || '').replace(/^tibo-x-/, '');
  const deterministic = classifyTiboPost({
    id,
    text: signal.summary,
    context_text: 'Codex',
    created_at: signal.publishedAt,
  });
  if (deterministic?.evidenceKind !== 'confirmed') return signal;
  return {
    ...signal,
    title: deterministic.title,
    evidenceKind: 'confirmed',
    expectedResetAt: null,
    confidence: 1,
    deterministicRepair: true,
  };
}

function decodeHtml(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (match, entity) => {
    if (entity.toLowerCase().startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return entities[entity.toLowerCase()] || match;
  });
}

function parseTiboPostUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('请输入完整的 Tibo 帖子链接');
  }
  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('仅支持 x.com 上的 Tibo 帖子链接');
  }
  const match = url.pathname.match(/^\/thsottiaux\/status\/(\d+)/i);
  if (!match) throw new Error('链接必须来自 Tibo（@thsottiaux）的个人账号');
  return { id: match[1], url: `https://x.com/${TIBO_USERNAME}/status/${match[1]}` };
}

function publishedAtFromPostId(id) {
  const timestamp = Number((BigInt(id) >> 22n) + 1288834974657n);
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || timestamp < 1288834974657 || timestamp > Date.now() + 864e5) {
    throw new Error('无法识别帖子发布时间');
  }
  return date.toISOString();
}

async function fetchTiboPostFromUrl(value, fetchImpl = fetch) {
  const post = parseTiboPostUrl(value);
  const endpoint = new URL('https://publish.x.com/oembed');
  endpoint.searchParams.set('url', post.url);
  endpoint.searchParams.set('omit_script', 'true');
  endpoint.searchParams.set('dnt', 'true');
  const response = await fetchImpl(endpoint, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`X 无法读取该帖子（${response.status}）`);
  const payload = await response.json();
  if (!String(payload.author_url || '').toLowerCase().includes('/thsottiaux')) {
    throw new Error('帖子作者不是 Tibo（@thsottiaux）');
  }
  const paragraph = String(payload.html || '').match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i)?.[1];
  if (!paragraph) throw new Error('X 未返回可分析的帖子正文');
  const text = decodeHtml(paragraph.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
  const signal = classifyTiboPost({ id: post.id, text, created_at: publishedAtFromPostId(post.id) });
  if (!signal) throw new Error('这条帖子没有同时提到 Codex 与额度重置');
  return signal;
}

async function xJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`X API ${response.status}`);
  return response.json();
}

async function fetchTiboSignals({ token, userId, sinceId, paginationToken, backfillComplete = false, fetchImpl = fetch, maxPages = 3 }) {
  if (!token) return { signals: [], userId, sinceId, paginationToken, backfillComplete };
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const lookup = await xJson(`https://api.x.com/2/users/by/username/${TIBO_USERNAME}`, token, fetchImpl);
    resolvedUserId = lookup.data?.id;
    if (!resolvedUserId) throw new Error('X API did not return the Tibo user ID');
  }

  const signals = [];
  let nextToken = paginationToken || null;
  let newestId = sinceId || null;
  let completed = backfillComplete;
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,public_metrics,conversation_id,referenced_tweets',
      exclude: 'retweets',
    });
    if (!completed && nextToken) params.set('pagination_token', nextToken);
    if (completed && newestId) params.set('since_id', newestId);
    const payload = await xJson(`https://api.x.com/2/users/${resolvedUserId}/tweets?${params}`, token, fetchImpl);
    for (const post of payload.data || []) {
      if (!newestId || BigInt(post.id) > BigInt(newestId)) newestId = post.id;
      const signal = classifyTiboPost(post);
      if (signal) signals.push(signal);
    }
    nextToken = payload.meta?.next_token || null;
    if (completed || !nextToken) {
      completed = true;
      nextToken = null;
      break;
    }
  }
  return { signals, userId: resolvedUserId, sinceId: newestId, paginationToken: nextToken, backfillComplete: completed };
}

module.exports = {
  AUTHOR_TIME_ZONE,
  BEIJING_TIME_ZONE,
  TIBO_AUTHOR,
  TIBO_USERNAME,
  classifyTiboPost,
  classifyTiboTimeline,
  expectedResetAt,
  fetchTiboPostFromUrl,
  fetchTiboSignals,
  parseTiboPostUrl,
  publishedAtFromPostId,
  resetRecordFromSignal,
  repairStoredSignal,
  signalNeedsUpdate,
  zonedEndOfDay,
  zonedDateTime,
};

const { consolidateResetRecords } = require('./reset-history.cjs');

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function beijingLabel(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${Number(values.month)}月${Number(values.day)}日 ${values.hour}:${values.minute}`;
}

function beijingWeekday(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(new Date(value));
}

function predict({ signals, resets, now = new Date() }) {
  const recentSignals = signals.filter((signal) => {
    const ageHours = (now - new Date(signal.publishedAt)) / 36e5;
    return ageHours >= 0 && ageHours <= 120;
  });

  let weightedEvidence = 0;
  let totalWeight = 0;
  for (const signal of recentSignals) {
    const ageHours = (now - new Date(signal.publishedAt)) / 36e5;
    const recency = Math.exp(-ageHours / 42);
    const weight = recency;
    weightedEvidence += clamp(signal.confidence ?? 0.5) * weight;
    totalWeight += weight;
  }
  const evidenceScore = totalWeight ? weightedEvidence / totalWeight : 0.16;

  const resetEvents = consolidateResetRecords(resets);
  const sorted = resetEvents.map((item) => new Date(item.at)).sort((a, b) => a - b);
  const intervals = sorted.slice(1).map((date, index) => (date - sorted[index]) / 864e5);
  const averageInterval = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : 14;
  const lastReset = sorted.at(-1);
  const elapsed = lastReset ? (now - lastReset) / 864e5 : 0;
  const cycleScore = clamp(elapsed / Math.max(averageInterval, 1));
  const sampleBoost = clamp(recentSignals.length / 8) * 0.08;
  let probability = Math.round(clamp(evidenceScore * 0.58 + cycleScore * 0.34 + sampleBoost) * 100);

  const confirmed = recentSignals.find((signal) => signal.authority === 'codex-lead' && signal.evidenceKind === 'confirmed'
    && now - new Date(signal.publishedAt) <= 48 * 36e5);
  const scheduled = recentSignals
    .filter((signal) => signal.authority === 'codex-lead' && signal.evidenceKind === 'scheduled' && signal.expectedResetAt)
    .filter((signal) => new Date(signal.expectedResetAt) >= now && new Date(signal.expectedResetAt) - now <= 7 * 864e5)
    .sort((left, right) => new Date(left.expectedResetAt) - new Date(right.expectedResetAt))[0];
  const communityTimes = recentSignals
    .filter((signal) => signal.authority === 'community' && signal.evidenceKind === 'scheduled' && signal.expectedResetAt)
    .map((signal) => ({ signal, time: new Date(signal.expectedResetAt).getTime() }))
    .filter((item) => item.time >= now.getTime() - 2 * 36e5 && item.time <= now.getTime() + 7 * 864e5);
  const clusters = new Map();
  for (const item of communityTimes) {
    const bucket = Math.round(item.time / (6 * 36e5));
    clusters.set(bucket, [...(clusters.get(bucket) || []), item]);
  }
  const communityCluster = [...clusters.values()]
    .filter((items) => new Set(items.map((item) => item.signal.author)).size >= 2)
    .sort((left, right) => right.length - left.length)[0];
  const communityDeadline = communityCluster
    ? new Date(communityCluster.map((item) => item.time).sort((a, b) => a - b)[Math.floor(communityCluster.length / 2)])
    : null;

  if (confirmed) {
    probability = 100;
    return {
      probability,
      level: '已确认',
      window: `北京时间 ${beijingLabel(confirmed.publishedAt)} 已重置`,
      deadline: confirmed.publishedAt,
      evidenceCount: recentSignals.length,
      averageInterval: Number(averageInterval.toFixed(1)),
      factors: { socialSignals: 100, historicalCycle: Math.round(cycleScore * 100), sourceCoverage: 100 },
      reason: 'Tibo 已明确表示重置已下发到账号；这是确认结果，不是未来时间推算。',
      calculation: [`直接证据：@thsottiaux · ${beijingLabel(confirmed.publishedAt)}（北京时间）`, '原文语义：Reset has been propagated to accounts', `历史样本：${resetEvents.length} 次去重事件，仅作背景参考`],
    };
  }

  if (scheduled) probability = Math.max(probability, 92);
  if (!scheduled && communityDeadline) probability = Math.max(probability, Math.min(85, 62 + communityCluster.length * 4));

  const days = probability >= 80 ? 2 : probability >= 65 ? 3 : probability >= 45 ? 5 : 7;
  const deadline = scheduled ? new Date(scheduled.expectedResetAt) : communityDeadline || new Date(now);
  if (!scheduled && !communityDeadline) deadline.setDate(deadline.getDate() + days);
  return {
    probability,
    level: probability >= 70 ? '高概率' : probability >= 45 ? '中概率' : '低概率',
    window: scheduled || communityDeadline ? `预计北京时间 ${beijingLabel(deadline)} 前` : `预计北京时间${beijingWeekday(deadline)}前`,
    deadline: deadline.toISOString(),
    evidenceCount: recentSignals.length,
    averageInterval: Number(averageInterval.toFixed(1)),
    factors: {
      socialSignals: Math.round(evidenceScore * 100),
      historicalCycle: Math.round(cycleScore * 100),
      sourceCoverage: Math.min(100, recentSignals.length * 12),
    },
    reason: scheduled
      ? '时间来自 Tibo 的明确预告，并已换算为北京时间；不使用历史周期外推截止时间。'
      : communityDeadline
        ? `时间来自 ${new Set(communityCluster.map((item) => item.signal.author)).size} 个小红书来源的相近转述；属于社区预警，并非 Tibo 官方确认。`
      : '没有明确预告时间，以下仅为近期证据与历史周期的启发式估计。',
    calculation: scheduled
      ? [`明确预告：${beijingLabel(deadline)}（北京时间）`, `近期有效证据：${recentSignals.length} 条`, `历史样本：${resetEvents.length} 次去重事件`]
      : communityDeadline
        ? [`社区时间聚类：${communityCluster.length} 条`, `独立发布者：${new Set(communityCluster.map((item) => item.signal.author)).size} 个`, `聚类中位时间：${beijingLabel(deadline)}（北京时间）`, '社区证据不写入已确认重置日历']
      : [`Tibo 证据：${Math.round(evidenceScore * 100)} × 58%`, `历史周期：${Math.round(cycleScore * 100)} × 34%`, `证据数量加成：${Math.round(sampleBoost * 100)} 个百分点`],
  };
}

module.exports = { predict };

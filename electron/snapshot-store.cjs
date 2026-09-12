const fs = require('node:fs');
const path = require('node:path');

function readJsonLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function appendJsonLine(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

function windowReset(before, after) {
  return before && after
    && before.windowDurationMins === after.windowDurationMins
    && after.usedPercent + 3 < before.usedPercent
    && before.resetsAt && after.resetsAt
    && new Date(after.resetsAt) > new Date(before.resetsAt);
}

function detectEvents(previous, current) {
  if (!previous) return [];
  const events = [];
  const beforeWindows = new Map(previous.windows.map((window) => [window.id, window]));
  const resetWindows = current.windows.filter((window) => windowReset(beforeWindows.get(window.id), window));
  for (const window of resetWindows) {
    events.push({
      id: `window-reset:${window.id}:${current.observedAt}`,
      type: 'window-reset',
      at: current.observedAt,
      label: `${window.label}已重置`,
      windowId: window.id,
      source: 'Codex app-server',
    });
  }

  const delta = current.resetCreditAvailableCount - previous.resetCreditAvailableCount;
  if (delta > 0) {
    events.push({ id: `credit-grant:${current.observedAt}`, type: 'credit-grant', at: current.observedAt, count: delta, label: `获得 ${delta} 张重置卡`, source: 'Codex app-server' });
  } else if (delta < 0) {
    const beforeCards = new Map(previous.cards.map((card) => [card.id, card]));
    const removed = previous.cards.filter((card) => !current.cards.some((item) => item.id === card.id));
    const expired = removed.some((card) => card.expiresAt && new Date(card.expiresAt) <= new Date(current.observedAt));
    const type = resetWindows.length ? 'credit-consumed' : expired ? 'credit-expired' : 'credit-decrease-unknown';
    const labels = { 'credit-consumed': '使用了重置卡', 'credit-expired': '重置卡已过期', 'credit-decrease-unknown': '重置卡库存减少（原因待确认）' };
    events.push({
      id: `${type}:${current.observedAt}`,
      type,
      at: current.observedAt,
      count: Math.abs(delta),
      label: labels[type],
      cardIds: removed.filter((card) => beforeCards.has(card.id)).map((card) => card.id),
      source: 'Codex app-server',
    });
  }
  return events;
}

class SnapshotStore {
  constructor(directory, { maxSnapshots = 20000, maxEvents = 5000 } = {}) {
    this.directory = directory;
    this.snapshotsFile = path.join(directory, 'quota-snapshots.jsonl');
    this.eventsFile = path.join(directory, 'quota-events.jsonl');
    this.maxSnapshots = maxSnapshots;
    this.maxEvents = maxEvents;
  }

  sanitize(account, observedAt = new Date().toISOString()) {
    return {
      observedAt,
      plan: account.plan || null,
      remainingPercent: Number(account.remainingPercent),
      nextNaturalReset: account.nextNaturalReset || null,
      resetCreditAvailableCount: Number(account.resetCreditAvailableCount || 0),
      windows: (account.usageWindows || []).map((window) => ({
        id: window.id,
        label: window.label,
        usedPercent: Number(window.usedPercent),
        remainingPercent: Number(window.remainingPercent),
        windowDurationMins: window.windowDurationMins ?? null,
        resetsAt: window.resetsAt || null,
      })),
      cards: (account.cards || []).map((card) => ({ id: card.id, label: card.label, grantedAt: card.grantedAt || null, expiresAt: card.expiresAt || null, status: card.status || null })),
    };
  }

  record(account, observedAt) {
    const snapshots = readJsonLines(this.snapshotsFile);
    const previous = snapshots.at(-1) || null;
    const current = this.sanitize(account, observedAt);
    appendJsonLine(this.snapshotsFile, current);
    const events = detectEvents(previous, current);
    for (const event of events) appendJsonLine(this.eventsFile, event);
    this.trimIfNeeded(this.snapshotsFile, snapshots.length + 1, this.maxSnapshots);
    const eventCount = readJsonLines(this.eventsFile).length;
    this.trimIfNeeded(this.eventsFile, eventCount, this.maxEvents);
    return { snapshot: current, events };
  }

  trimIfNeeded(file, count, max) {
    if (count <= max) return;
    const retained = readJsonLines(file).slice(-max);
    fs.writeFileSync(file, `${retained.map((item) => JSON.stringify(item)).join('\n')}\n`, { mode: 0o600 });
  }

  history({ snapshotLimit = 2000, eventLimit = 500 } = {}) {
    return {
      snapshots: readJsonLines(this.snapshotsFile).slice(-snapshotLimit),
      events: readJsonLines(this.eventsFile).slice(-eventLimit),
    };
  }
}

module.exports = { SnapshotStore, detectEvents, windowReset };

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function beijingDay(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function isManual(record) {
  return String(record.id || '').startsWith('manual-');
}

function isTibo(record) {
  return String(record.id || '').startsWith('tibo-reset-') || String(record.source || '').includes('Tibo');
}

function isCreditGrant(record) {
  return record?.type === 'credit-grant' || String(record?.id || '').startsWith('credit-grant:');
}

function isConfirmedCalendarRecord(record) {
  return isTibo(record) || isCreditGrant(record);
}

function sameReset(left, right) {
  const distance = Math.abs(new Date(left.at) - new Date(right.at));
  if (distance <= 5 * 60 * 1000) return true;
  return beijingDay(left.at) === beijingDay(right.at)
    && distance <= 12 * 60 * 60 * 1000
    && ((isManual(left) && isTibo(right)) || (isTibo(left) && isManual(right)));
}

function consolidateResetRecords(records = []) {
  const valid = records
    .filter((record) => record?.at && Number.isFinite(new Date(record.at).getTime()))
    .map((record, index) => ({ ...record, id: record.id || `legacy-reset-${index}` }));
  const parents = valid.map((_, index) => index);
  const find = (index) => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };
  for (let left = 0; left < valid.length; left += 1) {
    for (let right = left + 1; right < valid.length; right += 1) {
      if (sameReset(valid[left], valid[right])) join(left, right);
    }
  }
  const groups = new Map();
  valid.forEach((record, index) => groups.set(find(index), [...(groups.get(find(index)) || []), record]));
  return [...groups.values()].map((evidence) => {
    const preferred = evidence.find(isTibo)
      || evidence.find((record) => String(record.source || '').includes('app-server'))
      || evidence[0];
    const sources = [...new Set(evidence.map((record) => record.source).filter(Boolean))];
    return {
      id: `reset-event-${preferred.id}`,
      at: preferred.at,
      source: sources.join(' + '),
      kind: isTibo(preferred) ? 'tibo-reset' : 'credit-grant',
      label: preferred.label,
      count: preferred.count,
      sources,
      evidenceIds: evidence.map((record) => record.id),
      manualIds: evidence.filter(isManual).map((record) => record.id),
      evidenceSignalId: preferred.evidenceSignalId,
      url: evidence.find((record) => record.url)?.url,
      demo: false,
    };
  }).sort((left, right) => new Date(left.at) - new Date(right.at));
}

function confirmedCalendarRecords(records = []) {
  return consolidateResetRecords(records.filter(isConfirmedCalendarRecord));
}

module.exports = { beijingDay, confirmedCalendarRecords, consolidateResetRecords, isConfirmedCalendarRecord, sameReset };

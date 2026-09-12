import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleGauge, Clock3, Cloud,
  ArrowRightLeft, Copy, ExternalLink, History, LayoutDashboard, LoaderCircle, LogIn, Maximize2, MonitorUp, Play, Plus, Radio,
  RotateCcw, Settings, ShieldCheck, Sparkles, Ticket, Trash2, UserRound, Wifi, X,
} from 'lucide-react';

type Page = 'overview' | 'signals' | 'history' | 'account' | 'settings';

const fallback: RadarState = {
  signals: [], resets: [], resetEvents: [], prediction: null, lastRunAt: null, mode: 'demo', sourceStatus: {},
  history: { snapshots: [], events: [] },
  account: { connected: false, source: 'demo', plan: '未连接', remainingPercent: 0, nextNaturalReset: null, cards: [], usageWindows: [], resetCreditAvailableCount: 0 },
  accountProfiles: [
    { id: 'primary', label: '账号 A', kind: 'system', connected: false, plan: '未连接', remainingPercent: 0, nextNaturalReset: null, cards: [], usageWindows: [], resetCreditAvailableCount: 0 },
    { id: 'secondary', label: '账号 B', kind: 'isolated', connected: false, plan: '未连接', remainingPercent: 0, nextNaturalReset: null, cards: [], usageWindows: [], resetCreditAvailableCount: 0 },
  ],
  activeAccountProfileId: 'primary',
  settings: { dataMode: 'public', accountSwitchMode: 'isolated', signalChannel: 'x', xhsProfile: '', llmProvider: 'minimax', llmModel: 'MiniMax-M3', intervalMinutes: 30, notifyThreshold: 70, launchAtLogin: false },
  integrations: {
    agentReach: { status: 'checking', message: '正在检查 Agent Reach' },
    llm: { configured: false, status: 'unconfigured', message: '尚未配置大模型', provider: 'minimax', model: 'MiniMax-M3' },
    minimax: { configured: false, status: 'unconfigured', message: '尚未配置 MiniMax', model: 'MiniMax-M3', region: null },
  },
};

function relativeTime(value: string | null) {
  if (!value) return '尚未运行';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 6e4));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时前`;
  return `${Math.round(minutes / 1440)} 天前`;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function daysLeft(value: string) {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 864e5));
}

function ProbabilityRing({ value }: { value: number }) {
  return (
    <div className="probability-ring" style={{ '--progress': `${value * 3.6}deg` } as React.CSSProperties}>
      <div className="ring-inner"><strong>{value}<small>%</small></strong><span>重置概率</span></div>
    </div>
  );
}

function MiniLineChart({ resets }: { resets: Reset[] }) {
  const now = beijingDateParts(new Date());
  const monthResets = resets.filter((item) => {
    const date = beijingDateParts(item.at);
    return date.month === now.month && date.year === now.year;
  });
  const days = new Date(Date.UTC(now.year, now.month, 0)).getUTCDate();
  const counts = Array.from({ length: days }, (_, index) =>
    monthResets.filter((item) => beijingDateParts(item.at).day <= index + 1).length);
  const maxCount = Math.max(1, ...counts);
  const points = counts.map((count, index) => {
    return { x: 18 + index * (564 / (days - 1)), y: 150 - (count / maxCount) * 120 };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `18,158 ${line} 582,158`;
  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 600 180" role="img" aria-label="本月重置累计折线图">
        {[38, 78, 118, 158].map((y) => <line key={y} x1="18" x2="582" y1={y} y2={y} className="grid-line" />)}
        <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#62f7a1" stopOpacity=".25"/><stop offset="1" stopColor="#62f7a1" stopOpacity="0"/></linearGradient></defs>
        <polygon points={area} fill="url(#chart-fill)" />
        <polyline points={line} fill="none" stroke="#62f7a1" strokeWidth="3" strokeLinejoin="round" />
        {monthResets.map((item) => {
          const day = beijingDateParts(item.at).day;
          const point = points[day - 1];
          return <circle key={item.id} cx={point.x} cy={point.y} r="5" fill="#07110c" stroke="#62f7a1" strokeWidth="3" />;
        })}
        <text x="18" y="175">1日</text><text x="286" y="175">月中</text><text x="558" y="175">月底</text>
      </svg>
    </div>
  );
}

function beijingDateParts(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)])) as { year: number; month: number; day: number };
}

function ResetCalendar({ resets }: { resets: Reset[] }) {
  const today = beijingDateParts(new Date());
  const [cursor, setCursor] = useState(() => new Date(Date.UTC(today.year, today.month - 1, 1)));
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthRecords = resets.filter((record) => {
    const date = beijingDateParts(record.at);
    return date.year === year && date.month === month + 1;
  }).sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  const byDay = new Map<number, Reset[]>();
  monthRecords.forEach((record) => {
    const day = beijingDateParts(record.at).day;
    byDay.set(day, [...(byDay.get(day) || []), record]);
  });
  const cells = Array.from({ length: firstWeekday + dayCount }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const move = (offset: number) => setCursor(new Date(Date.UTC(year, month + offset, 1)));
  return <section className="panel reset-calendar"><div className="panel-head"><div><h3><CalendarDays size={15}/>Codex 历史重置日历</h3><p>仅记录 Tibo 公开确认的额度重置与重置卡发放；统一按北京时间归档</p></div><div className="calendar-controls"><button onClick={() => move(-1)} aria-label="上个月"><ChevronLeft size={16}/></button><b>{year}年{month + 1}月</b><button onClick={() => move(1)} aria-label="下个月"><ChevronRight size={16}/></button></div></div><div className="calendar-weekdays">{['日','一','二','三','四','五','六'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((day, index) => day ? <div key={day} className={`${byDay.has(day) ? 'has-reset' : ''} ${day === today.day && month + 1 === today.month && year === today.year ? 'today' : ''}`}><span>{day}</span>{(byDay.get(day) || []).map((record) => <button key={record.id} title={record.label || record.source} className={record.kind === 'credit-grant' ? 'server-dot' : 'tibo-dot'} onClick={() => record.url && window.radar?.openExternal(record.url)}>{record.kind === 'credit-grant' ? `发放${record.count || 1}张卡` : 'Tibo 确认'}</button>)}</div> : <div key={`blank-${index}`} className="calendar-blank"/>)}</div><div className="calendar-legend"><span><i className="tibo-dot"/>Tibo 公开确认</span><span><i className="server-dot"/>重置卡发放</span></div>{monthRecords.length ? <div className="calendar-records">{monthRecords.map((record) => <button key={record.id} onClick={() => record.url && window.radar?.openExternal(record.url)}><time>{dateLabel(record.at)}</time><span>{record.kind === 'credit-grant' ? record.label || '获得重置卡' : record.source}</span>{record.url && <ExternalLink size={13}/>}</button>)}</div> : <div className="empty calendar-empty">本月暂无 Tibo 确认重置或重置卡发放记录</div>}</section>;
}

function QuotaHistoryChart({ snapshots }: { snapshots: QuotaSnapshot[] }) {
  const values = snapshots.slice(-120).map((snapshot) => {
    const window = snapshot.windows.find((item) => item.windowDurationMins === 10080) || snapshot.windows[0];
    return { at: snapshot.observedAt, remaining: window?.remainingPercent ?? snapshot.remainingPercent };
  });
  if (values.length < 2) return <div className="empty chart-empty">收集至少两次真实快照后显示趋势</div>;
  const points = values.map((item, index) => ({ x: 18 + index * (564 / (values.length - 1)), y: 153 - item.remaining * 1.25 }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = `18,158 ${line} 582,158`;
  return <div className="chart-wrap"><svg viewBox="0 0 600 180" role="img" aria-label="真实剩余额度历史折线图">{[28, 70, 112, 153].map((y) => <line key={y} x1="18" x2="582" y1={y} y2={y} className="grid-line"/>)}<defs><linearGradient id="quota-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#62baf7" stopOpacity=".24"/><stop offset="1" stopColor="#62baf7" stopOpacity="0"/></linearGradient></defs><polygon points={area} fill="url(#quota-fill)"/><polyline points={line} fill="none" stroke="#62baf7" strokeWidth="3" strokeLinejoin="round"/><circle cx={points.at(-1)!.x} cy={points.at(-1)!.y} r="5" fill="#07111a" stroke="#62baf7" strokeWidth="3"/><text x="18" y="175">{dateLabel(values[0].at)}</text><text x="485" y="175">{dateLabel(values.at(-1)!.at)}</text></svg></div>;
}

function SignalItem({ signal }: { signal: Signal }) {
  return (
    <button className="signal-item" onClick={() => signal.url && window.radar?.openExternal(signal.url)}>
      <span className={`source-icon ${signal.source === '小红书' ? 'source-xhs' : 'source-X'}`}>{signal.source === '小红书' ? '红' : 'X'}</span>
      <span className="signal-copy">
        <span className="signal-meta"><b>{signal.source}</b><span>·</span><span>{signal.author}</span><span>·</span><span>{dateLabel(signal.publishedAt)} 北京时间</span>{signal.evidenceKind && <em>{signal.evidenceKind === 'confirmed' ? '已确认' : signal.evidenceKind === 'scheduled' ? '预告' : '相关'}</em>}{signal.analysisProvider && <em>{signal.analysisProvider}</em>}{signal.demo && <em>演示</em>}</span>
        <strong>{signal.title}</strong>
        <small>{signal.summary}</small>
      </span>
      <span className="confidence"><b>{Math.round(signal.confidence * 100)}%</b><small>可信度</small></span>
      <ChevronRight size={18} />
    </button>
  );
}

function Overview({ state, running, run }: { state: RadarState; running: boolean; run: () => void }) {
  const prediction = state.prediction;
  const resetEvents = state.resetEvents || state.resets;
  const fiveHourWindow = state.account.usageWindows.find((item) => item.windowDurationMins === 300);
  const weeklyWindow = state.account.usageWindows.find((item) => item.windowDurationMins === 10080);
  const monthCount = useMemo(() => {
    const now = beijingDateParts(new Date());
    return resetEvents.filter((item) => { const date = beijingDateParts(item.at); return date.month === now.month && date.year === now.year; }).length;
  }, [resetEvents]);
  return (
    <>
      <header className="page-header">
        <div><span className="eyebrow">实时态势</span><h1>下午好，雷达正在监听。</h1><p>结合{state.settings.signalChannel === 'xiaohongshu' ? '小红书社区证据链' : ' Tibo 官方公开言论'}与历史周期，判断下一次 Codex 额度重置。</p></div>
        <button className="run-button" onClick={run} disabled={running}><Play size={16} fill="currentColor" />{running ? '分析中…' : '立即预测'}</button>
      </header>

      {!state.signals.length && <div className="demo-banner"><Sparkles size={17}/><span><b>等待证据</b> · 请在设置中检查当前渠道连接状态。</span></div>}

      <section className="hero-card">
        <div className="hero-glow" />
        <ProbabilityRing value={prediction?.probability || 0} />
        <div className="prediction-copy">
          <div className="prediction-badge"><Radio size={14}/>{prediction?.level || '等待预测'}</div>
          <h2>{prediction?.window || '正在建立信号基线'}</h2>
          <p>基于 <b>{prediction?.evidenceCount || 0} 条近期信号</b>和历史平均 <b>{prediction?.averageInterval || '--'} 天</b>的重置周期。</p>
          {prediction?.reason && <details className="prediction-explanation" open={prediction.level === '已确认'}><summary>为什么得出这个结果</summary><p>{prediction.reason}</p>{prediction.calculation?.map((item) => <span key={item}>{item}</span>)}</details>}
          <div className="factor-bars">
            {[
              [state.settings.signalChannel === 'xiaohongshu' ? '社区证据' : 'Tibo 证据', prediction?.factors.socialSignals || 0],
              ['历史周期', prediction?.factors.historicalCycle || 0],
              ['证据数量', prediction?.factors.sourceCoverage || 0],
            ].map(([label, value]) => <div key={label as string}><span>{label}<b>{value}%</b></span><i><u style={{ width: `${value}%` }}/></i></div>)}
          </div>
        </div>
        <div className="hero-status"><span><Activity size={16}/>上次分析</span><b>{relativeTime(state.lastRunAt)}</b><small>每 {state.settings.intervalMinutes} 分钟自动运行</small></div>
      </section>

      <section className="metric-grid">
        <article><span className="metric-icon green"><RotateCcw size={19}/></span><div><small>本月确认重置</small><strong>{monthCount}<em>次</em></strong><span>来自历史记录</span></div></article>
        {state.settings.dataMode === 'account' ? <><article><span className="metric-icon blue"><CircleGauge size={19}/></span><div><small>5 小时限额</small><strong>{fiveHourWindow ? fiveHourWindow.remainingPercent : '--'}{fiveHourWindow && <em>%</em>}</strong><span>{fiveHourWindow ? `已用 ${fiveHourWindow.usedPercent}% · ${fiveHourWindow.resetsAt ? `${dateLabel(fiveHourWindow.resetsAt)} 重置` : '重置时间未知'}` : '服务端未返回 300 分钟窗口'}</span></div></article><article><span className="metric-icon amber"><Clock3 size={19}/></span><div><small>每周额度</small><strong>{weeklyWindow ? weeklyWindow.remainingPercent : '--'}{weeklyWindow && <em>%</em>}</strong><span>{weeklyWindow?.resetsAt ? `${dateLabel(weeklyWindow.resetsAt)} 重置` : '服务端未返回周窗口'}</span></div></article><article><span className="metric-icon violet"><Ticket size={19}/></span><div><small>可用重置卡</small><strong>{state.account.resetCreditAvailableCount}<em>张</em></strong><span>{state.account.cards[0]?.expiresAt ? `${daysLeft(state.account.cards[0].expiresAt)} 天后到期` : '暂无到期明细'}</span></div></article></> : <><article><span className="metric-icon blue"><Radio size={19}/></span><div><small>Agent Reach</small><strong className="text-metric">{state.integrations.agentReach.status === 'connected' ? '已连接' : '待处理'}</strong><span>{state.integrations.agentReach.message}</span></div></article><article><span className="metric-icon amber"><Sparkles size={19}/></span><div><small>分析引擎</small><strong className="text-metric">{state.integrations.llm.configured ? state.integrations.llm.model : '本地'}</strong><span>{state.integrations.llm.message}</span></div></article><article><span className="metric-icon violet"><ShieldCheck size={19}/></span><div><small>运行模式</small><strong className="text-metric">公开</strong><span>完全不启动 Codex</span></div></article></>}
      </section>

      <section className="dashboard-grid">
        <article className="panel"><div className="panel-head"><div><h3>本月重置趋势</h3><p>按去重后的确认事件累计</p></div><span className="live-pill"><i/>持续记录</span></div><MiniLineChart resets={resetEvents}/></article>
        <article className="panel"><div className="panel-head"><div><h3>{state.settings.signalChannel === 'xiaohongshu' ? '小红书最新证据' : 'Tibo 最新证据'}</h3><p>{state.settings.signalChannel === 'xiaohongshu' ? '多发布者社区证据链' : '仅来自 @thsottiaux'}</p></div><span>{state.signals.length} 条</span></div><div className="compact-signals">{state.signals.slice(0, 3).map((signal) => <SignalItem key={signal.id} signal={signal}/>)}</div></article>
      </section>
    </>
  );
}

function SignalsPage({ state }: { state: RadarState }) {
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const searchUrl = 'https://x.com/search?q=from%3Athsottiaux%20Codex%20%28reset%20OR%20limits%20OR%20quota%20OR%20credits%29&src=typed_query&f=live';
  const isXhs = state.settings.signalChannel === 'xiaohongshu';
  const importPost = async () => {
    if (!url.trim() || !window.radar) return;
    setImporting(true);
    setMessage('');
    try {
      await window.radar.importTiboPost(url.trim());
      setUrl('');
      setMessage('已导入并重新计算预测。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };
  return <><header className="page-header"><div><span className="eyebrow">证据中心</span><h1>{isXhs ? '小红书 · tibo重置' : '@thsottiaux 官方消息'}</h1><p>{isXhs ? 'OpenCLI 自动搜索并聚合多个发布者；社区转述不会直接写入确认日历。' : '按断点回读 Tibo 时间线，并识别 Codex、全订阅及 Astra 重置语境。'}</p></div>{!isXhs && <button className="secondary-button" onClick={() => window.radar?.openExternal(searchUrl)}><ExternalLink size={16}/>打开免费搜索</button>}</header><div className="connector-grid"><section className={`panel connector-card ${state.integrations.agentReach.status}`}><Radio/><div><b>{isXhs ? 'OpenCLI · 小红书' : 'Agent Reach · X'}</b><small>{state.integrations.agentReach.message}</small></div></section><section className={`panel connector-card ${state.integrations.llm.status}`}><Sparkles/><div><b>{state.integrations.llm.model}</b><small>{state.integrations.llm.message}</small></div></section></div>{!isXhs && <section className="panel tibo-import"><div><span className="source-icon source-X">X</span><div><b>Tibo · @thsottiaux</b><small>{state.sourceStatus.Tibo || '自动采集检查中'}</small></div><Wifi size={17}/></div><div className="import-row"><input value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && importPost()} placeholder="自动采集失败时，粘贴 https://x.com/thsottiaux/status/..."/><button className="run-button" onClick={importPost} disabled={importing || !url.trim()}>{importing ? '读取中…' : '手动导入'}</button></div>{message && <small className="import-message">{message}</small>}</section>}<section className="panel signal-list"><div className="panel-head"><div><h3>{isXhs ? '小红书证据链' : 'Tibo 全部证据'}</h3><p>按北京时间倒序排列</p></div><span>{state.signals.length} 条证据</span></div>{state.signals.length ? state.signals.map((signal) => <SignalItem key={signal.id} signal={signal}/>) : <div className="empty">当前渠道尚未发现相关证据</div>}</section></>;
}

function beijingDateTimeInput(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const item = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}T${item.hour}:${item.minute}`;
}

function HistoryPage({ state, update }: { state: RadarState; update: (value: RadarState) => void }) {
  const [manualAt, setManualAt] = useState(() => beijingDateTimeInput());
  const [manualSource, setManualSource] = useState('手动确认');
  const [editing, setEditing] = useState(false);
  const resetEvents = state.resetEvents || state.resets;
  const manualRecords = state.resets.filter((item) => item.id.startsWith('manual-')).sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  const add = async () => {
    if (!manualAt || !window.radar) return;
    setEditing(true);
    try {
      update(await window.radar.addReset({ at: new Date(`${manualAt}:00+08:00`).toISOString(), source: manualSource }));
    } finally { setEditing(false); }
  };
  const remove = async (id: string) => {
    if (!window.radar || !window.confirm('删除这条手动补记？自动采集的 Tibo 和 app-server 证据不会受到影响。')) return;
    setEditing(true);
    try { update(await window.radar.deleteReset(id)); } finally { setEditing(false); }
  };
  const history = state.history || { snapshots: [], events: [] };
  const now = beijingDateParts(new Date());
  const monthResetEvents = resetEvents.filter((item) => {
    const date = beijingDateParts(item.at);
    return date.year === now.year && date.month === now.month;
  });
  const eventIcon = (type: QuotaEvent['type']) => type === 'credit-grant' ? <Plus size={17}/> : type === 'credit-consumed' ? <Ticket size={17}/> : <RotateCcw size={17}/>;
  return <>
    <header className="page-header">
      <div><span className="eyebrow">历史分析</span><h1>重置证据与额度时间线</h1><p>公开证据与 app-server 实测均按北京时间归档，不保存账户凭证。</p></div>
      <button className="secondary-button" onClick={() => document.getElementById('manual-reset-time')?.focus()}><Plus size={16}/>补记一次重置</button>
    </header>
    <section className="history-metrics">
      <article><small>Tibo 重置证据</small><strong>{(state.tiboEvidence || []).filter((item) => item.evidenceKind === 'confirmed').length}</strong><span>@thsottiaux 公开确认帖</span></article>
      <article><small>本月确认重置</small><strong>{monthResetEvents.length}</strong><span>与折线图、日历使用同一去重口径</span></article>
      <article><small>{state.settings.dataMode === 'account' ? '当前剩余额度' : '分析引擎'}</small><strong>{state.settings.dataMode === 'account' ? `${state.account.remainingPercent}%` : (state.integrations.llm.configured ? state.integrations.llm.model : '本地')}</strong><span>{state.settings.dataMode === 'account' ? (state.account.connected ? 'Codex app-server' : '等待连接') : '公开模式不访问账户'}</span></article>
    </section>
    <ResetCalendar resets={resetEvents}/>
    <section className="panel manual-reset-editor"><div className="panel-head"><div><h3>手动补记管理</h3><p>时间按北京时间保存；同一分钟的重复提交不会重复计数</p></div><span>{manualRecords.length} 条原始补记</span></div><div className="manual-reset-form"><input id="manual-reset-time" type="datetime-local" value={manualAt} onChange={(event) => setManualAt(event.target.value)}/><input value={manualSource} maxLength={80} onChange={(event) => setManualSource(event.target.value)} placeholder="证据说明"/><button className="run-button" disabled={editing || !manualAt} onClick={add}><Plus size={15}/>{editing ? '处理中…' : '添加补记'}</button></div>{manualRecords.length ? <div className="manual-reset-list">{manualRecords.map((record) => <div key={record.id}><time>{dateLabel(record.at)}</time><span>{record.source}</span><button title="删除手动补记" disabled={editing} onClick={() => remove(record.id)}><Trash2 size={14}/></button></div>)}</div> : <div className="empty calendar-empty">暂无手动补记</div>}</section>
    {state.settings.dataMode === 'account' ? <><section className="panel history-chart"><div className="panel-head"><div><h3>真实剩余额度趋势</h3><p>优先展示周额度，最多绘制最近 120 个快照</p></div><span className="live-pill"><i/>{state.account.connected ? '自动采集' : '等待连接'}</span></div><QuotaHistoryChart snapshots={history.snapshots}/></section><section className="panel timeline"><div className="panel-head"><div><h3>额度事件</h3><p>证据不足的库存下降不会被误判为消费</p></div><span>{history.events.length} 条</span></div>{history.events.length ? [...history.events].reverse().map((event) => <div className={`timeline-row event-${event.type}`} key={event.id}><span>{eventIcon(event.type)}</span><div><b>{event.label}</b><small>{event.source} · {event.type}</small></div><time>{dateLabel(event.at)}</time></div>) : <div className="empty">继续后台采集后，这里会显示真实重置与重置卡事件</div>}</section></> : <section className="panel public-history-note"><ShieldCheck/><div><b>公开重置历史</b><p>当前日历只记录 Tibo 公开确认和手动补记，不读取任何 Codex 账户数据。切换到账户增强模式后才会增加账户实测事件。</p></div></section>}
  </>;
}

type LoginPhase = 'connecting' | 'logging-out' | 'logged-out' | 'starting-login' | 'waiting';
type LoginFlow = { status: 'confirm' | 'starting' | 'waiting' | 'success' | 'error'; type: 'chatgpt' | 'chatgptDeviceCode'; profileId: AccountProfile['id']; phase?: LoginPhase; authUrl?: string; verificationUrl?: string; userCode?: string; error?: string };
type ConsumeFlow = { creditId: string | null; label: string; expiresAt: string | null; idempotencyKey: string; status: 'confirm' | 'running' | 'done' | 'error'; outcome?: string; error?: string };

function AccountPage({ state, update }: { state: RadarState; update: (value: RadarState) => void }) {
  const [quota, setQuota] = useState(state.account.remainingPercent);
  const [login, setLogin] = useState<LoginFlow | null>(null);
  const [consume, setConsume] = useState<ConsumeFlow | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<AccountProfile['id']>(state.activeAccountProfileId);
  const [switching, setSwitching] = useState<AccountProfile['id'] | null>(null);
  const [modeSaving, setModeSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState('');
  const profiles = state.accountProfiles || fallback.accountProfiles;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || profiles[0];
  useEffect(() => setQuota(state.account.remainingPercent), [state.account.remainingPercent]);
  useEffect(() => window.radar?.onLoginUpdated((result) => {
    setLogin((current) => current && (!result.profileId || result.profileId === current.profileId)
      ? { ...current, status: result.success ? 'success' : 'error', error: result.error || undefined }
      : current);
  }), []);
  useEffect(() => window.radar?.onLoginProgress((result) => {
    setLogin((current) => current && result.profileId === current.profileId
      ? { ...current, phase: result.phase }
      : current);
  }), []);
  const save = async () => update(await window.radar!.saveAccount({ remainingPercent: quota }));
  const startLogin = async (type: LoginFlow['type'], profileId = selectedProfile.id) => {
    if (state.settings.accountSwitchMode === 'single-instance' && login?.status !== 'confirm') {
      setLogin({ status: 'confirm', type, profileId });
      return;
    }
    setLogin({ status: 'starting', type, profileId });
    try {
      const result = await window.radar!.startLogin(type, profileId);
      setLogin({ status: 'waiting', type, profileId, authUrl: result.authUrl, verificationUrl: result.verificationUrl, userCode: result.userCode });
      if (result.authUrl) await window.radar!.openExternal(result.authUrl);
    } catch (error) {
      setLogin({ status: 'error', type, profileId, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const openDesktop = async (profileId: AccountProfile['id']) => {
    setSwitching(profileId);
    setProfileStatus('');
    try {
      const result = await window.radar!.openAccountDesktop(profileId);
      setProfileStatus(profileId === 'secondary' && state.settings.accountSwitchMode === 'shared-projects'
        ? `账号 B 已启动：${result.sharedProjectCount} 个项目、${result.sharedChats.availableChatCount} 条接力聊天（本次新增 ${result.sharedChats.forkedChatCount} 条）${result.sharedChats.errors.length ? `，另有 ${result.sharedChats.errors.length} 条失败` : ''}。`
        : `${profiles.find((profile) => profile.id === profileId)?.label || '账号'}桌面端已启动；首次使用请在该独立窗口完成登录。`);
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : String(error));
    } finally { setSwitching(null); }
  };
  const switchProfile = async (profileId: AccountProfile['id']) => {
    if (state.settings.accountSwitchMode === 'single-instance') {
      setSelectedProfileId(profileId);
      setLogin({ status: 'confirm', type: 'chatgpt', profileId });
      return;
    }
    setSwitching(profileId);
    setProfileStatus('');
    try {
      const result = await window.radar!.switchAccountProfile(profileId);
      update(result.state);
      setSelectedProfileId(profileId);
      setProfileStatus(profileId === 'secondary' && state.settings.accountSwitchMode === 'shared-projects'
        ? `已切换至账号 B：可打开 ${result.sharedChats.availableChatCount} 条从 A 分叉的完整聊天继续工作（本次新增 ${result.sharedChats.forkedChatCount} 条）${result.sharedChats.errors.length ? `，${result.sharedChats.errors.length} 条接力失败` : ''}。`
        : `已切换至 ${profiles.find((profile) => profile.id === profileId)?.label || '目标账号'}，对应 ChatGPT/Codex 桌面窗口已唤醒。`);
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : String(error));
    } finally { setSwitching(null); }
  };
  const setAccountSwitchMode = async (accountSwitchMode: RadarState['settings']['accountSwitchMode']) => {
    setModeSaving(true);
    setProfileStatus('');
    try {
      const next = await window.radar!.saveSettings({ accountSwitchMode });
      update(next);
      setSelectedProfileId(next.activeAccountProfileId);
      setProfileStatus(accountSwitchMode === 'shared-projects'
        ? '已启用项目与聊天接力模式。下次打开账号 B 时会同步项目并为 A 的本地聊天创建 B 接力副本；若 B 已打开，请关闭该窗口后重新打开一次。'
        : accountSwitchMode === 'single-instance'
          ? '已启用单实例重新登录模式。当前回到系统账号 A；切换时会先退出当前账号，再在同一个 Codex 中登录目标账号。'
          : '已启用完全隔离模式，账号 B 保持独立项目清单与任务历史。');
    } catch (error) {
      setProfileStatus(error instanceof Error ? error.message : String(error));
    } finally { setModeSaving(false); }
  };
  const cancelLogin = async () => { await window.radar?.cancelLogin(); setLogin(null); };
  const prepareConsume = (creditId: string | null, label: string, expiresAt: string | null) => setConsume({ creditId, label, expiresAt, idempotencyKey: crypto.randomUUID(), status: 'confirm' });
  const confirmConsume = async () => {
    if (!consume) return;
    setConsume({ ...consume, status: 'running' });
    try {
      const result = await window.radar!.consumeResetCredit({ creditId: consume.creditId, idempotencyKey: consume.idempotencyKey });
      update(result.state);
      setConsume({ ...consume, status: 'done', outcome: result.outcome });
    } catch (error) {
      setConsume({ ...consume, status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  };
  const outcomeText: Record<string, string> = { reset: '重置成功，额度已重新读取。', alreadyRedeemed: '该操作此前已成功，额度已重新读取。', nothingToReset: '当前没有可重置的额度窗口，卡未被浪费。', noCredit: '账户当前没有可用重置卡。' };
  const loginPhaseText: Record<LoginPhase, string> = {
    connecting: '正在连接已预热的 Codex 认证服务…',
    'logging-out': '正在通过官方接口退出当前账号…',
    'logged-out': '当前账号已退出，正在准备目标账号登录…',
    'starting-login': '正在生成官方登录链接…',
    waiting: '登录页面已准备完成…',
  };
  if (state.settings.dataMode === 'public') return <><header className="page-header"><div><span className="eyebrow">额度中心</span><h1>公开雷达模式</h1><p>当前完全不启动 Codex，也不会访问账户额度、重置卡或登录状态。</p></div></header><section className="panel public-mode-gate"><ShieldCheck/><div><h3>账户功能已隔离</h3><p>公开渠道采集、大模型增强、预测和公开历史日历仍会正常运行。需要查看真实额度或重置卡时，可显式切换到账户增强模式。</p><button className="run-button" onClick={async () => update(await window.radar!.saveSettings({ dataMode: 'account' }))}>切换到账户增强模式</button></div></section></>;
  return <>
    <header className="page-header"><div><span className="eyebrow">额度中心</span><h1>双账号快速切换</h1><p>{state.settings.accountSwitchMode === 'single-instance' ? '退出当前账号后，在同一个 Codex 和同一个数据目录中登录目标账号。' : '登录凭据与额度始终隔离；账号 B 可接力账号 A 的本地项目和完整聊天上下文。'}</p></div></header>
    <section className="panel profile-switcher">
      <div className="panel-head"><div><h3><ArrowRightLeft size={15}/>Codex 账号槽位</h3><p>{state.settings.accountSwitchMode === 'single-instance' ? 'A/B 共享系统 Codex 数据目录；切换会终止当前登录态，请先结束正在运行的任务。' : '账号 A 使用当前系统登录；账号 B 使用独立认证目录。原账号任务不会被强制退出。'}</p></div><span>{state.activeAccountProfileId === 'primary' ? '账号 A 使用中' : '账号 B 使用中'}</span></div>
      <div className="account-switch-modes">
        <button disabled={modeSaving} className={state.settings.accountSwitchMode === 'isolated' ? 'selected' : ''} onClick={() => setAccountSwitchMode('isolated')}><ShieldCheck/><span><b>完全隔离</b><small>A/B 的项目清单、任务与登录均分开</small></span></button>
        <button disabled={modeSaving} className={state.settings.accountSwitchMode === 'shared-projects' ? 'selected' : ''} onClick={() => setAccountSwitchMode('shared-projects')}><MonitorUp/><span><b>项目与聊天接力</b><small>把 A 的本地聊天安全分叉给 B 并继续对话</small></span></button>
        <button disabled={modeSaving} className={state.settings.accountSwitchMode === 'single-instance' ? 'selected' : ''} onClick={() => setAccountSwitchMode('single-instance')}><ArrowRightLeft/><span><b>同一 Codex 重新登录</b><small>退出 A，再用 B 登录原来的 Codex</small></span></button>
      </div>
      {state.settings.accountSwitchMode === 'shared-projects' && <div className="shared-project-note"><ShieldCheck size={14}/><span>本地聊天会复制为新的 B 接力线程，保留完整上下文但使用独立线程 ID；不会复制 A 的 OAuth 凭据或重置卡，也不会让 B 写入 A 的原聊天。云端任务仍需切回 A。</span></div>}
      {state.settings.accountSwitchMode === 'single-instance' && <div className="shared-project-note"><ShieldCheck size={14}/><span>项目清单和本地聊天不会复制，因为始终使用同一个系统数据目录。切换必须重新完成官方 ChatGPT 登录；Radar 不保存第二份令牌。若登录中途取消，当前 Codex 会保持退出状态，可重新登录原账号恢复。</span></div>}
      <div className="profile-grid">{profiles.map((profile) => {
        const fiveHour = profile.usageWindows.find((item) => item.windowDurationMins === 300);
        const active = profile.id === state.activeAccountProfileId;
        return <article key={profile.id} className={`${selectedProfileId === profile.id ? 'selected' : ''} ${active ? 'active' : ''}`} onClick={() => setSelectedProfileId(profile.id)}>
          <div className="profile-title"><span className="avatar"><UserRound/></span><div><b>{profile.label}</b><small>{profile.email || profile.plan}</small></div>{active && <em>当前</em>}</div>
          <div className="profile-quota"><span>5 小时额度</span><strong>{profile.connected ? `${fiveHour?.remainingPercent ?? profile.remainingPercent}%` : '--'}</strong><small>{fiveHour?.resetsAt ? `${dateLabel(fiveHour.resetsAt)} 重置` : profile.connected ? '等待额度窗口' : '尚未登录'}</small></div>
          {profile.lastError && <p className="profile-error">{profile.lastError}</p>}
          <div className="profile-actions">
            {!active && state.settings.accountSwitchMode === 'single-instance' && <button className="run-button" disabled={switching !== null} onClick={() => switchProfile(profile.id)}><ArrowRightLeft size={14}/>退出并登录{profile.label}</button>}
            {profile.connected && !active && state.settings.accountSwitchMode !== 'single-instance' && <button className="run-button" disabled={switching !== null} onClick={() => switchProfile(profile.id)}><ArrowRightLeft size={14}/>{switching === profile.id ? '切换中…' : '切换并打开'}</button>}
            {profile.connected && active && <button className="secondary-button" disabled={switching !== null} onClick={() => openDesktop(profile.id)}><MonitorUp size={14}/>打开桌面端</button>}
            {!profile.connected && state.settings.accountSwitchMode !== 'single-instance' && <button className="secondary-button" onClick={() => setSelectedProfileId(profile.id)}><LogIn size={14}/>选择并登录</button>}
            {profile.kind === 'isolated' && state.settings.accountSwitchMode !== 'single-instance' && <button className="text-button profile-desktop" disabled={switching !== null} onClick={() => openDesktop(profile.id)}>首次桌面登录</button>}
          </div>
        </article>;
      })}</div>
      {profileStatus && <div className="profile-status">{profileStatus}</div>}
    </section>
    <section className="panel login-panel"><div className="login-copy"><span className={`account-state ${selectedProfile.connected ? 'connected' : ''}`}>{selectedProfile.connected ? <CheckCircle2 size={18}/> : <LogIn size={18}/>}<b>{selectedProfile.label} · {selectedProfile.connected ? `已记录 ${selectedProfile.plan}` : '连接 ChatGPT 账户'}</b></span><p>{state.settings.accountSwitchMode === 'single-instance' ? '使用系统 Codex 的官方登录流程；开始后会退出当前账号，并保留原项目和本地聊天。' : selectedProfile.kind === 'isolated' ? '该槽位使用独立 Codex 登录缓存，不会覆盖账号 A。首次还需打开独立桌面窗口登录同一账号。' : '使用当前系统 Codex/ChatGPT 登录态。'}</p></div><div className="login-actions"><button className="run-button" onClick={() => startLogin('chatgpt')}><ExternalLink size={15}/>{state.settings.accountSwitchMode === 'single-instance' ? `退出并登录${selectedProfile.label}` : selectedProfile.connected ? '重新 OAuth 登录' : '浏览器 OAuth 登录'}</button><button className="secondary-button" onClick={() => startLogin('chatgptDeviceCode')}><Copy size={15}/>{state.settings.accountSwitchMode === 'single-instance' ? '退出并用设备码登录' : '设备码登录'}</button></div></section>
    <div className="account-grid"><section className="panel account-card"><div className="account-top"><span className="avatar"><UserRound/></span><div><h3>{state.account.plan}</h3><p><span className={`status-dot ${state.account.connected ? '' : 'offline'}`}/>{state.account.connected ? `${state.activeAccountProfileId === 'primary' ? '账号 A' : '账号 B'} · 官方 Codex app-server` : '本地手动模式'}</p></div><ShieldCheck className="shield"/></div><label>剩余额度 <b>{quota}%</b></label><input type="range" min="0" max="100" value={quota} disabled={state.account.connected} onChange={(event) => setQuota(Number(event.target.value))}/><button className="run-button full" onClick={save} disabled={state.account.connected}>{state.account.connected ? '由 Codex 实时同步' : '保存本地快照'}</button><small className="privacy"><ShieldCheck size={14}/>{state.account.connected ? '认证凭据由官方 Codex 管理' : '数据仅保存在本机应用目录'}</small></section><section className="panel quota-details">{state.account.usageWindows.length ? state.account.usageWindows.map((window) => <div key={window.id}><span className="metric-icon blue"><CircleGauge/></span><small>{window.label}</small><strong>{window.remainingPercent}%</strong><small>{window.resetsAt ? `${dateLabel(window.resetsAt)} 重置` : '重置时间未知'}</small></div>) : <><div><span className="metric-icon blue"><CircleGauge/></span><small>剩余额度</small><strong>{state.account.remainingPercent}%</strong></div><div><span className="metric-icon amber"><Clock3/></span><small>下一次自然重置</small><strong>{state.account.nextNaturalReset ? dateLabel(state.account.nextNaturalReset) : '--'}</strong></div></>}</section></div>
    <section className="panel cards-panel"><div className="panel-head"><div><h3>手动重置卡</h3><p>只消费当前选中账号的卡片；应用永远不会后台自动使用</p></div><span>{state.account.resetCreditAvailableCount} 张</span></div>{state.account.cards.length ? state.account.cards.map((card) => <div className="reset-card" key={card.id}><span><Ticket/></span><div><b>{card.label}</b><small>{card.demo ? '演示卡片 · ' : ''}{card.expiresAt ? `${dateLabel(card.expiresAt)} 到期` : '官方未提供到期时间'}</small></div><div className="card-actions"><strong>{card.expiresAt ? `${daysLeft(card.expiresAt)} 天` : '可用'}</strong>{!card.demo && <button onClick={() => prepareConsume(card.id, card.label, card.expiresAt)}>使用</button>}</div></div>) : state.account.resetCreditAvailableCount ? <div className="empty empty-with-action"><span>有 {state.account.resetCreditAvailableCount} 张可用，后端未提供逐笔明细</span><button className="secondary-button" onClick={() => prepareConsume(null, '下一张可用重置卡', null)}>选择下一张使用</button></div> : <div className="empty">暂无重置卡</div>}</section>
    {login && <div className="modal-backdrop"><section className="modal"><button className="modal-close" onClick={cancelLogin}><X size={18}/></button><span className="modal-icon"><LogIn/></span><h2>{login.profileId === 'primary' ? '账号 A' : '账号 B'} · {login.type === 'chatgpt' ? 'ChatGPT OAuth 登录' : 'Codex 设备码登录'}</h2>{login.status === 'confirm' && <><div className="warning-box"><AlertTriangle/><div><b>将退出当前账号，再登录{login.profileId === 'primary' ? '账号 A' : '账号 B'}</b><span>同一个 Codex、项目目录和本地聊天都会保留。请先结束当前正在运行的任务；若中途取消，需要重新登录原账号。</span></div></div><button className="danger-button" onClick={() => startLogin(login.type, login.profileId)}>确认退出并继续登录</button><button className="text-button" onClick={() => setLogin(null)}>取消</button></>}{login.status === 'starting' && <div className="modal-status"><LoaderCircle className="spin"/>{login.phase ? loginPhaseText[login.phase] : '正在准备官方 Codex 登录流程…'}</div>}{login.status === 'waiting' && login.type === 'chatgpt' && <><p>登录页面已在系统浏览器打开。请确认选择目标账号；完成授权后会唤醒原来的 Codex。</p><button className="run-button full" onClick={() => login.authUrl && window.radar!.openExternal(login.authUrl)}><ExternalLink size={15}/>重新打开登录页面</button></>}{login.status === 'waiting' && login.type === 'chatgptDeviceCode' && <><p>打开官方验证页面并输入以下一次性设备码：</p><button className="device-code" onClick={() => login.userCode && navigator.clipboard.writeText(login.userCode)}>{login.userCode}<Copy size={17}/></button><button className="run-button full" onClick={() => login.verificationUrl && window.radar!.openExternal(login.verificationUrl)}><ExternalLink size={15}/>打开官方验证页面</button></>}{login.status === 'success' && <div className="result-box success"><CheckCircle2/>登录成功，原 Codex 已唤醒，真实额度正在同步。</div>}{login.status === 'error' && <div className="result-box error"><AlertTriangle/><span>{login.error || '登录失败，请重试。'}</span></div>}<small className="privacy"><ShieldCheck size={14}/>密码和令牌不会经过 Radar</small></section></div>}
    {consume && <div className="modal-backdrop"><section className="modal danger-modal"><button className="modal-close" disabled={consume.status === 'running'} onClick={() => setConsume(null)}><X size={18}/></button><span className="modal-icon danger"><Ticket/></span><h2>确认使用重置卡</h2>{consume.status === 'confirm' && <><div className="warning-box"><AlertTriangle/><div><b>此操作会立即消费一张卡，无法撤销</b><span>官方将重置当前符合条件的 Codex 额度窗口。</span></div></div><dl><div><dt>卡片</dt><dd>{consume.label}</dd></div><div><dt>到期时间</dt><dd>{consume.expiresAt ? dateLabel(consume.expiresAt) : '官方未提供'}</dd></div></dl><button className="danger-button" onClick={confirmConsume}>确认消费并重置额度</button><button className="text-button" onClick={() => setConsume(null)}>暂不使用</button></>}{consume.status === 'running' && <div className="modal-status"><LoaderCircle className="spin"/>正在提交幂等请求并重新读取额度…</div>}{consume.status === 'done' && <div className="result-box success"><CheckCircle2/><span>{outcomeText[consume.outcome || ''] || `操作结果：${consume.outcome}`}</span></div>}{consume.status === 'error' && <><div className="result-box error"><AlertTriangle/><span>{consume.error}</span></div><button className="danger-button" onClick={confirmConsume}>使用同一幂等键重试</button></>}</section></div>}
  </>;
}

function SettingsPage({ state, update }: { state: RadarState; update: (value: RadarState) => void }) {
  const [form, setForm] = useState(state.settings);
  const [key, setKey] = useState('');
  const [keyStatus, setKeyStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState<Array<{ id: string; label: string; models: string[]; keyOptional: boolean }>>([]);
  const [openCliProfiles, setOpenCliProfiles] = useState<string[]>([]);
  useEffect(() => { window.radar?.getLlmProviders().then(setProviders); window.radar?.getOpenCliProfiles().then(setOpenCliProfiles); }, []);
  const selectedProvider = providers.find((item) => item.id === form.llmProvider);
  const save = async () => {
    setSaving(true);
    try { update(await window.radar!.saveSettings(form)); } finally { setSaving(false); }
  };
  const saveKey = async () => {
    if (!key.trim()) return;
    setSaving(true);
    setKeyStatus('');
    try {
      update(await window.radar!.saveLlmKey({ provider: form.llmProvider, model: form.llmModel, key: key.trim() }));
      setKey('');
      setKeyStatus(`${form.llmModel} 已连接，密钥已使用系统安全存储。`);
    } catch (error) {
      setKeyStatus(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };
  const clearKey = async () => {
    update(await window.radar!.clearLlmKey(form.llmProvider));
    setKeyStatus('大模型密钥已移除，将使用本地确定性规则。');
  };
  return <>
    <header className="page-header"><div><span className="eyebrow">偏好设置</span><h1>雷达设置</h1><p>选择运行模式，并配置自动采集与分析引擎。</p></div></header>
    <section className="panel mode-panel">
      <div className="panel-head"><div><h3>运行模式</h3><p>公开模式完全不启动 Codex；账户模式在公开雷达基础上增加真实额度能力</p></div></div>
      <div className="mode-options">
        <button className={form.dataMode === 'public' ? 'selected' : ''} onClick={() => setForm({...form, dataMode: 'public'})}><Radio/><b>公开雷达模式</b><span>公开渠道 + 可选大模型 · 不依赖 Codex</span></button>
        <button className={form.dataMode === 'account' ? 'selected' : ''} onClick={() => setForm({...form, dataMode: 'account'})}><UserRound/><b>账户增强模式</b><span>增加真实额度、重置卡与账户实测历史</span></button>
      </div>
    </section>
    <section className="panel settings-panel">
      <div className="setting-row"><div><b>预测信息渠道</b><small>X 为官方一手证据；小红书为多来源社区预警</small></div><select value={form.signalChannel} onChange={(event) => setForm({...form, signalChannel: event.target.value as 'x' | 'xiaohongshu'})}><option value="x">X · Tibo 官方账号</option><option value="xiaohongshu">小红书 · tibo重置</option></select></div>
      {form.signalChannel === 'xiaohongshu' && openCliProfiles.length > 1 && <div className="setting-row"><div><b>小红书浏览器 Profile</b><small>检测到多个 OpenCLI Chrome 会话，请指定采集使用哪一个</small></div><select value={form.xhsProfile} onChange={(event) => setForm({...form, xhsProfile: event.target.value})}><option value="">请选择</option>{openCliProfiles.map((profile) => <option key={profile} value={profile}>{profile}</option>)}</select></div>}
      <div className="setting-row"><div><b>自动预测间隔</b><small>自动读取 Tibo 时间线；托盘后台仍会运行</small></div><select value={form.intervalMinutes} onChange={(event) => setForm({...form, intervalMinutes: Number(event.target.value)})}><option value="10">每 10 分钟</option><option value="30">每 30 分钟</option><option value="60">每 1 小时</option><option value="180">每 3 小时</option></select></div>
      <div className="setting-row"><div><b>高概率通知阈值</b><small>达到阈值时发送系统通知，6 小时内不重复</small></div><select value={form.notifyThreshold} onChange={(event) => setForm({...form, notifyThreshold: Number(event.target.value)})}><option value="60">60%</option><option value="70">70%</option><option value="80">80%</option><option value="90">90%</option></select></div>
      <div className="setting-row"><div><b>登录系统时启动</b><small>应用会安静地驻留在系统托盘</small></div><button className={`toggle ${form.launchAtLogin ? 'on' : ''}`} onClick={() => setForm({...form, launchAtLogin: !form.launchAtLogin})}><i/></button></div>
      <button className="run-button save-settings" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存并应用模式'}</button>
    </section>
    <section className="panel integration-panel">
      <div className="panel-head"><div><h3>自动采集</h3><p>按上方选择启用单一渠道；两边证据历史独立保留</p></div></div>
      <code>Agent Reach</code><span className={`integration-state ${state.integrations.agentReach.status}`}>{state.integrations.agentReach.message}</span>
      <code>{form.signalChannel === 'xiaohongshu' ? 'OpenCLI' : 'twitter-cli'}</code><span>{form.signalChannel === 'xiaohongshu' ? '复用用户明确登录的 Chrome 小红书会话' : 'user-posts 断点回读，不依赖付费 X API'}</span>
    </section>
    <section className="panel minimax-panel">
      <div className="panel-head"><div><h3>大模型增强分析</h3><p>选择服务商和具体模型；不配置时继续使用本地确定性规则</p></div><span className={`integration-state ${state.integrations.llm.status}`}>{state.integrations.llm.configured ? '已配置' : '未配置'}</span></div>
      <div className="model-select-row"><select value={form.llmProvider} onChange={(event) => { const next = providers.find((item) => item.id === event.target.value); setForm({...form, llmProvider: event.target.value, llmModel: next?.models[0] || ''}); setKeyStatus(''); }}><option value="" disabled>选择服务商</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><select value={form.llmModel} onChange={(event) => setForm({...form, llmModel: event.target.value})}>{(selectedProvider?.models || [form.llmModel]).map((model) => <option key={model} value={model}>{model}</option>)}</select></div>
      <div className="key-row"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={selectedProvider?.keyOptional ? 'Ollama 本机模式无需 API Key' : state.integrations.llm.configured ? '输入新 Key 可替换当前服务商密钥' : '粘贴所选服务商 API Key'}/><button className="run-button" disabled={saving || (!key.trim() && !selectedProvider?.keyOptional)} onClick={saveKey}>{saving ? '验证中…' : '验证并保存'}</button>{state.integrations.llm.configured && <button className="text-button" onClick={clearKey}>移除密钥</button>}</div>
      <small className="key-message">{keyStatus || state.integrations.llm.message}</small>
    </section>
  </>;
}

function countdownLabel(value: string | null, now: number) {
  if (!value) return '--:--:--';
  const seconds = Math.max(0, Math.floor((new Date(value).getTime() - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${days ? `${days}天 ` : ''}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function HudCalendar({ resets }: { resets: Reset[] }) {
  const today = beijingDateParts(new Date());
  const firstWeekday = new Date(Date.UTC(today.year, today.month - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
  const resetDays = new Set(resets.filter((item) => {
    const date = beijingDateParts(item.at);
    return date.year === today.year && date.month === today.month;
  }).map((item) => beijingDateParts(item.at).day));
  const cells = Array.from({ length: firstWeekday + dayCount }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  return <div className="hud-calendar"><div className="hud-calendar-title"><span>历史重置日历</span><b>{today.year}.{String(today.month).padStart(2, '0')}</b></div><div className="hud-weekdays">{['日','一','二','三','四','五','六'].map((day) => <span key={day}>{day}</span>)}</div><div className="hud-days">{cells.map((day, index) => <span key={day || `blank-${index}`} className={`${day === today.day ? 'today' : ''} ${day && resetDays.has(day) ? 'reset' : ''}`}>{day || ''}</span>)}</div></div>;
}

function HudTrend({ resets }: { resets: Reset[] }) {
  const now = Date.now();
  const points = Array.from({ length: 30 }, (_, index) => {
    const cutoff = now - (29 - index) * 864e5;
    const count = resets.filter((item) => new Date(item.at).getTime() <= cutoff).length;
    return { x: index * (300 / 29), count };
  });
  const min = Math.min(...points.map((point) => point.count));
  const max = Math.max(...points.map((point) => point.count));
  const span = Math.max(1, max - min);
  const line = points.map((point) => `${point.x},${42 - ((point.count - min) / span) * 34}`).join(' ');
  return <svg className="hud-trend" viewBox="0 0 300 48" preserveAspectRatio="none" aria-label="最近30天累计重置趋势"><polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg>;
}

function HudApp() {
  const [state, setState] = useState<RadarState>(fallback);
  const [now, setNow] = useState(Date.now());
  const [running, setRunning] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  useEffect(() => {
    document.body.classList.add('hud-mode');
    window.radar?.getState().then(setState);
    const remove = window.radar?.onUpdated(setState);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { document.body.classList.remove('hud-mode'); remove?.(); window.clearInterval(timer); };
  }, []);
  const fiveHourWindow = state.account.usageWindows.find((item) => item.windowDurationMins === 300);
  const weeklyWindow = state.account.usageWindows.find((item) => item.windowDurationMins === 10080);
  const naturalReset = fiveHourWindow?.resetsAt || null;
  const resetEvents = state.resetEvents || state.resets;
  const month = beijingDateParts(new Date());
  const monthCount = resetEvents.filter((item) => { const date = beijingDateParts(item.at); return date.year === month.year && date.month === month.month; }).length;
  const refresh = async () => {
    setRunning(true);
    try { setState(await window.radar!.run()); } finally { setRunning(false); }
  };
  const otherProfile = state.accountProfiles?.find((profile) => profile.id !== state.activeAccountProfileId);
  const switchAccount = async () => {
    if (!otherProfile?.connected || !window.radar) return;
    if (state.settings.accountSwitchMode === 'single-instance') {
      await window.radar.showMain();
      return;
    }
    setSwitchingAccount(true);
    try {
      const result = await window.radar.switchAccountProfile(otherProfile.id);
      setState(result.state);
    } finally { setSwitchingAccount(false); }
  };
  return <div className="hud-shell">
    <header className="hud-header"><div><span className="hud-live"><i/>RESET RADAR</span><small>{relativeTime(state.lastRunAt)}更新</small></div><nav><button title="立即刷新" className={running ? 'spin' : ''} onClick={refresh}><RotateCcw/></button><button title="打开完整雷达" onClick={() => window.radar?.showMain()}><Maximize2/></button><button title="隐藏 HUD" onClick={() => window.radar?.hideHud()}><X/></button></nav></header>
    <section className="hud-probability"><div><small>实时重置趋势</small><strong>{state.prediction?.probability || 0}<em>%</em></strong><span title={state.prediction?.reason}>{state.prediction?.level || '等待预测'} · {state.prediction?.window || '正在建立信号基线'}</span></div><HudTrend resets={resetEvents}/><b>{monthCount} 次<small>本月确认</small></b></section>
    <section className="hud-metrics">
      <article className="five-hour"><CircleGauge/><span>5 小时限额</span><strong>{state.settings.dataMode === 'account' && state.account.connected && fiveHourWindow ? `${fiveHourWindow.remainingPercent}%` : '--'}</strong><div className="hud-quota-bar"><i style={{ width: `${fiveHourWindow?.remainingPercent || 0}%` }}/></div><small>{fiveHourWindow ? `已用 ${fiveHourWindow.usedPercent}%` : state.settings.dataMode === 'account' ? '服务端未返回' : '公开雷达模式'}</small></article>
      <article><Activity/><span>每周额度</span><strong>{state.settings.dataMode === 'account' && state.account.connected && weeklyWindow ? `${weeklyWindow.remainingPercent}%` : '--'}</strong><div className="hud-quota-bar weekly"><i style={{ width: `${weeklyWindow?.remainingPercent || 0}%` }}/></div><small>{weeklyWindow ? `已用 ${weeklyWindow.usedPercent}%` : '服务端未返回'}</small></article>
      <article><Clock3/><span>5 小时窗口重置</span><strong className="countdown">{countdownLabel(naturalReset, now)}</strong><small>{naturalReset ? dateLabel(naturalReset) : '服务端尚未返回 300 分钟窗口'}</small></article>
      <article><Ticket/><span>可用重置卡</span><strong>{state.settings.dataMode === 'account' ? state.account.resetCreditAvailableCount : '--'}<em>{state.settings.dataMode === 'account' ? ' 张' : ''}</em></strong><small>{state.account.cards[0]?.expiresAt ? `${daysLeft(state.account.cards[0].expiresAt)} 天后到期` : '暂无到期卡片'}</small></article>
    </section>
    <HudCalendar resets={resetEvents}/>
    <footer><span><i className={state.integrations.agentReach.status === 'connected' ? 'ok' : ''}/>{state.integrations.agentReach.status === 'connected' ? (state.settings.signalChannel === 'xiaohongshu' ? '小红书在线' : 'Tibo 在线') : '采集待恢复'}</span>{state.settings.dataMode === 'account' && state.settings.accountSwitchMode === 'single-instance' ? <button onClick={() => window.radar?.showMain()}><ArrowRightLeft/>前往完整雷达换号</button> : state.settings.dataMode === 'account' && otherProfile?.connected ? <button disabled={switchingAccount} onClick={switchAccount}><ArrowRightLeft/>{switchingAccount ? '切换中' : `切换到${otherProfile.label}`}</button> : <span>{state.settings.dataMode === 'account' ? (state.activeAccountProfileId === 'primary' ? '账号 A' : '账号 B') : '公开雷达'}</span>}</footer>
  </div>;
}

function DashboardApp() {
  const [page, setPage] = useState<Page>('overview');
  const [state, setState] = useState<RadarState>(fallback);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    window.radar?.getState().then(setState);
    return window.radar?.onUpdated(setState);
  }, []);
  const run = async () => {
    if (!window.radar) return;
    setRunning(true);
    try { setState(await window.radar.run()); } finally { setRunning(false); }
  };
  const nav = [
    ['overview', LayoutDashboard, '雷达总览'], ['signals', Radio, '信号中心'], ['history', History, '历史分析'], ['account', UserRound, '额度中心'], ['settings', Settings, '设置'],
  ] as const;
  const liveClass = state.integrations.agentReach.status === 'connected' || state.mode === 'live' ? 'live' : 'demo';
  const channelLabel = state.settings.signalChannel === 'xiaohongshu' ? '小红书证据链' : 'Tibo 官方';
  const dataLabel = state.settings.dataMode === 'public'
    ? `公开雷达 · ${state.integrations.agentReach.status === 'connected' ? channelLabel : '等待采集'} · ${state.integrations.llm.configured ? state.integrations.llm.model : '本地分析'}`
    : `${state.account.connected ? '账户实时' : '账户待连接'} · ${state.integrations.agentReach.status === 'connected' ? channelLabel : '手动兜底'}`;
  const appParams = new URLSearchParams(window.location.search);
  const windows = appParams.get('platform') === 'win32';
  const appVersion = appParams.get('version') || 'dev';
  return <div className={`app-shell ${windows ? 'platform-win32' : ''}`}><aside><div className="brand"><span><Activity/></span><div><b>RESET RADAR</b><small>CODEX INTELLIGENCE</small></div></div><nav>{nav.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={18}/>{label}{id === 'signals' && <em>{state.signals.length}</em>}</button>)}</nav><div className="sidebar-bottom"><div className="monitor-card"><span><Cloud size={16}/><i/></span><b>后台监测中</b><small>下次运行约 {state.settings.intervalMinutes} 分钟内</small></div><div className="version"><ShieldCheck size={15}/><span>本地优先 · v{appVersion}</span></div></div></aside><main><div className="topbar"><span className={`connection ${liveClass}`}><i/>{dataLabel}</span><button title="打开 HUD 极简模式" onClick={() => window.radar?.toggleHud()}><Maximize2 size={17}/></button><button title="通知规则"><Bell size={18}/><i/></button></div><div className="content">{page === 'overview' && <Overview state={state} running={running} run={run}/>} {page === 'signals' && <SignalsPage state={state}/>} {page === 'history' && <HistoryPage state={state} update={setState}/>} {page === 'account' && <AccountPage state={state} update={setState}/>} {page === 'settings' && <SettingsPage state={state} update={setState}/>}</div></main></div>;
}

export default function App() {
  return new URLSearchParams(window.location.search).get('view') === 'hud' ? <HudApp/> : <DashboardApp/>;
}

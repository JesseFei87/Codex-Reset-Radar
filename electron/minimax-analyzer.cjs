const LLM_PROVIDERS = {
  minimax: { label: 'MiniMax', models: ['MiniMax-M3', 'MiniMax-M2.7'], endpoints: ['https://api.minimax.io/v1/chat/completions', 'https://api.minimaxi.com/v1/chat/completions'], protocol: 'openai' },
  openai: { label: 'OpenAI', models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex'], endpoints: ['https://api.openai.com/v1/chat/completions'], protocol: 'openai' },
  anthropic: { label: 'Anthropic Claude', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'], endpoints: ['https://api.anthropic.com/v1/messages'], protocol: 'anthropic' },
  gemini: { label: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-2.5-flash'], endpoints: ['https://generativelanguage.googleapis.com/v1beta'], protocol: 'gemini' },
  deepseek: { label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'], endpoints: ['https://api.deepseek.com/chat/completions'], protocol: 'openai' },
  qwen: { label: '阿里云通义千问', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'], endpoints: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'], protocol: 'openai' },
  kimi: { label: 'Moonshot Kimi', models: ['kimi-k2-turbo-preview', 'moonshot-v1-32k'], endpoints: ['https://api.moonshot.cn/v1/chat/completions'], protocol: 'openai' },
  openrouter: { label: 'OpenRouter', models: ['openai/gpt-5.4-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-pro'], endpoints: ['https://openrouter.ai/api/v1/chat/completions'], protocol: 'openai' },
  ollama: { label: 'Ollama（本机）', models: ['qwen3:8b', 'llama3.3', 'deepseek-r1:8b'], endpoints: ['http://127.0.0.1:11434/v1/chat/completions'], protocol: 'openai', keyOptional: true },
};
const MINIMAX_MODEL = 'MiniMax-M3';
const MINIMAX_ENDPOINTS = { global: LLM_PROVIDERS.minimax.endpoints[0], cn: LLM_PROVIDERS.minimax.endpoints[1] };
const MINIMAX_ENDPOINT = MINIMAX_ENDPOINTS.global;

function extractJsonArray(content) {
  const text = String(content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('大模型未返回 JSON 数组');
  return JSON.parse(fenced.slice(start, end + 1));
}

function normalizeAnalysis(item, source, model = MINIMAX_MODEL) {
  if (!item || item.id !== source.id) return null;
  const modelKind = ['confirmed', 'scheduled', 'context'].includes(item.evidenceKind) ? item.evidenceKind : source.evidenceKind;
  const kind = source.evidenceKind === 'confirmed' ? 'confirmed' : modelKind;
  const expected = item.expectedResetAt && Number.isFinite(new Date(item.expectedResetAt).getTime()) ? new Date(item.expectedResetAt).toISOString() : source.expectedResetAt;
  return { ...source, evidenceKind: kind, title: String(modelKind === kind ? item.title || source.title : source.title).slice(0, 120), summary: String(item.summary || source.summary).slice(0, 3000), expectedResetAt: kind === 'scheduled' ? expected : null, confidence: Math.min(source.authority === 'community' ? 0.88 : 1, Math.max(0.5, Number(item.confidence) || source.confidence)), scope: String(item.scope || source.scope || 'unknown').slice(0, 120), analysisProvider: model };
}

async function safeError(response) {
  let detail = '';
  try { const body = await response.clone().json(); detail = body?.error?.message || body?.message || ''; } catch { try { detail = await response.text(); } catch {} }
  return String(detail).replace(/(?:sk-|AIza)[A-Za-z0-9_.-]+/g, '[已隐藏密钥]').trim().slice(0, 220);
}

async function providerRequest({ provider, model, apiKey, messages, maxTokens = 2200, fetchImpl = fetch }) {
  const config = LLM_PROVIDERS[provider];
  if (!config) throw new Error('不支持的大模型服务商');
  const attempts = [];
  for (const endpoint of config.endpoints) {
    let url = endpoint;
    let headers = { 'Content-Type': 'application/json' };
    let body;
    if (config.protocol === 'anthropic') {
      headers = { ...headers, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      body = { model, max_tokens: maxTokens, system: messages.find((item) => item.role === 'system')?.content || '', messages: messages.filter((item) => item.role !== 'system') };
    } else if (config.protocol === 'gemini') {
      url = `${endpoint}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      body = { systemInstruction: { parts: [{ text: messages.find((item) => item.role === 'system')?.content || '' }] }, contents: [{ role: 'user', parts: [{ text: messages.filter((item) => item.role !== 'system').map((item) => item.content).join('\n') }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1 } };
    } else {
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const tokenLimit = ['openai', 'minimax'].includes(provider) ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };
      body = { model, temperature: 0.1, ...tokenLimit, messages };
    }
    const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (response.ok) return { response, endpoint };
    const detail = await safeError(response);
    attempts.push(`${new URL(endpoint).host} ${response.status}${detail ? `：${detail}` : ''}`);
    if (provider !== 'minimax' || ![401, 403].includes(response.status)) break;
  }
  throw new Error(`${config.label} 连接失败：${attempts.join('；')}`);
}

async function responseContent(response, protocol) {
  const payload = await response.json();
  if (protocol === 'anthropic') return payload.content?.map((item) => item.text || '').join('') || '';
  if (protocol === 'gemini') return payload.candidates?.[0]?.content?.parts?.map((item) => item.text || '').join('') || '';
  return payload.choices?.[0]?.message?.content || '';
}

async function enhanceSignals(signals, { provider, model, apiKey, fetchImpl = fetch } = {}) {
  if (!signals.length) return signals;
  const config = LLM_PROVIDERS[provider];
  if (!config || (!apiKey && !config.keyOptional)) return signals;
  const input = signals.map((signal) => ({ id: signal.id, source: signal.source, authority: signal.authority, text: signal.summary, publishedAt: signal.publishedAt, deterministicKind: signal.evidenceKind, deterministicExpectedResetAt: signal.expectedResetAt }));
  const messages = [
    { role: 'system', content: 'Analyze evidence about Codex usage resets. Return only a JSON array. Preserve every id. evidenceKind must be confirmed, scheduled, or context. Convert explicit times to ISO UTC using the stated timezone; Chinese social posts use Asia/Shanghai. Never invent a time. Community reposts are not official confirmation and confidence must stay below 0.88.' },
    { role: 'user', content: `Analyze these records:\n${JSON.stringify(input)}\nReturn: id, evidenceKind, title, summary, expectedResetAt, confidence, scope.` },
  ];
  const { response } = await providerRequest({ provider, model, apiKey, messages, fetchImpl });
  const records = extractJsonArray(await responseContent(response, config.protocol));
  const byId = new Map(records.map((item) => [item?.id, item]));
  return signals.map((signal) => normalizeAnalysis(byId.get(signal.id), signal, model) || signal);
}

async function testLlmConnection({ provider, model, apiKey, fetchImpl = fetch }) {
  const config = LLM_PROVIDERS[provider];
  if (!config) throw new Error('请选择有效的大模型服务商');
  if (!apiKey && !config.keyOptional) throw new Error(`${config.label} 需要 API Key`);
  await providerRequest({ provider, model, apiKey, messages: [{ role: 'user', content: 'Reply OK.' }], maxTokens: 16, fetchImpl });
  return { provider, model };
}

async function enhanceSignalsWithMiniMax(signals, { apiKey, fetchImpl = fetch } = {}) { return enhanceSignals(signals, { provider: 'minimax', model: MINIMAX_MODEL, apiKey, fetchImpl }); }
async function testMiniMaxKey(apiKey, fetchImpl = fetch) {
  try {
    const { endpoint } = await providerRequest({ provider: 'minimax', model: MINIMAX_MODEL, apiKey, messages: [{ role: 'user', content: 'Reply OK.' }], maxTokens: 16, fetchImpl });
    return { region: endpoint.includes('minimaxi.com') ? 'cn' : 'global' };
  } catch (error) {
    throw new Error(`MiniMax 鉴权失败（已自动尝试国际站和中国大陆站）：${error.message}。请确认 Key 来自当前有效的 Token Plan，并已分配套餐席位或 Credits。`);
  }
}

module.exports = { LLM_PROVIDERS, MINIMAX_ENDPOINT, MINIMAX_ENDPOINTS, MINIMAX_MODEL, enhanceSignals, enhanceSignalsWithMiniMax, extractJsonArray, normalizeAnalysis, providerRequest, testLlmConnection, testMiniMaxKey };

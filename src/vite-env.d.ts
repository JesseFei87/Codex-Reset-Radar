/// <reference types="vite/client" />

type Signal = {
  id: string; source: string; author: string; title: string; summary: string;
  confidence: number; publishedAt: string; url: string; demo?: boolean;
  authority?: 'codex-lead' | 'community'; evidenceKind?: 'confirmed' | 'scheduled' | 'context'; expectedResetAt?: string | null;
  scope?: string; analysisProvider?: string; supportingPostIds?: string[];
};
type Reset = { id: string; at: string; source: string; kind?: 'tibo-reset' | 'credit-grant'; label?: string; count?: number; sources?: string[]; evidenceIds?: string[]; manualIds?: string[]; demo?: boolean; evidenceSignalId?: string; url?: string };
type Card = { id: string; label: string; expiresAt: string | null; description?: string; status?: string; demo?: boolean };
type UsageWindow = { id: string; label: string; usedPercent: number; remainingPercent: number; windowDurationMins: number | null; resetsAt: string | null };
type AccountProfile = {
  id: 'primary' | 'secondary'; label: string; kind: 'system' | 'isolated'; connected: boolean;
  plan: string; email?: string | null; accountId?: string | null; remainingPercent: number;
  nextNaturalReset: string | null; cards: Card[]; usageWindows: UsageWindow[]; resetCreditAvailableCount: number;
  lastCheckedAt?: string | null; lastDesktopLaunchAt?: string | null; lastError?: string | null;
};
type SharedChatResult = { discoveredChatCount: number; forkedChatCount: number; availableChatCount: number; errors: Array<{ threadId: string; message: string }> };
type QuotaSnapshot = { observedAt: string; plan: string | null; remainingPercent: number; nextNaturalReset: string | null; resetCreditAvailableCount: number; windows: UsageWindow[]; cards: Array<{ id: string; label: string; expiresAt: string | null }> };
type QuotaEvent = { id: string; type: 'window-reset' | 'credit-grant' | 'credit-consumed' | 'credit-expired' | 'credit-decrease-unknown'; at: string; label: string; source: string; count?: number };
type Prediction = {
  probability: number; level: string; window: string; deadline: string;
  evidenceCount: number; averageInterval: number;
  factors: { socialSignals: number; historicalCycle: number; sourceCoverage: number };
  reason?: string; calculation?: string[];
};
type RadarState = {
  signals: Signal[];
  resets: Reset[];
  resetEvents?: Reset[];
  account: { connected: boolean; source?: string; plan: string; remainingPercent: number; nextNaturalReset: string | null; cards: Card[]; usageWindows: UsageWindow[]; resetCreditAvailableCount: number };
  accountProfiles: AccountProfile[];
  activeAccountProfileId: 'primary' | 'secondary';
  settings: { dataMode: 'public' | 'account'; accountSwitchMode: 'isolated' | 'shared-projects' | 'single-instance'; signalChannel: 'x' | 'xiaohongshu'; xhsProfile: string; llmProvider: string; llmModel: string; intervalMinutes: number; notifyThreshold: number; launchAtLogin: boolean };
  tiboEvidence?: Signal[];
  xhsEvidence?: Signal[];
  sourceState?: { tiboLastSeenId: string | null };
  integrations: {
    agentReach: { status: string; message: string };
    llm: { configured: boolean; status: string; message: string; provider: string; model: string };
    minimax: { configured: boolean; status: string; message: string; model: string; region?: 'global' | 'cn' | null };
  };
  prediction: Prediction | null;
  history: { snapshots: QuotaSnapshot[]; events: QuotaEvent[] };
  lastRunAt: string | null;
  lastErrors?: string[];
  mode: 'demo' | 'live';
  sourceStatus: Record<string, string>;
};

interface Window {
  radar?: {
    getState: () => Promise<RadarState>;
    run: () => Promise<RadarState>;
    toggleHud: () => Promise<void>;
    showMain: () => Promise<void>;
    hideHud: () => Promise<void>;
    startLogin: (type: 'chatgpt' | 'chatgptDeviceCode', profileId?: AccountProfile['id']) => Promise<{ type: string; loginId: string; profileId: AccountProfile['id']; authUrl?: string; verificationUrl?: string; userCode?: string }>;
    cancelLogin: () => Promise<{ cancelled: boolean }>;
    switchAccountProfile: (profileId: AccountProfile['id']) => Promise<{ state: RadarState; previousId: AccountProfile['id']; activeId: AccountProfile['id']; sharedProjectCount: number; sharedChats: SharedChatResult }>;
    openAccountDesktop: (profileId: AccountProfile['id']) => Promise<{ launched: boolean; pid?: number; sharedProjectCount: number; sharedChats: SharedChatResult }>;
    consumeResetCredit: (args: { creditId: string | null; idempotencyKey: string }) => Promise<{ outcome: string; state: RadarState }>;
    saveSettings: (settings: Partial<RadarState['settings']>) => Promise<RadarState>;
    saveAccount: (account: Partial<RadarState['account']>) => Promise<RadarState>;
    addReset: (record: { at?: string; source?: string }) => Promise<RadarState>;
    deleteReset: (id: string) => Promise<RadarState>;
    importTiboPost: (url: string) => Promise<RadarState>;
    saveMiniMaxKey: (value: string) => Promise<RadarState>;
    clearMiniMaxKey: () => Promise<RadarState>;
    getLlmProviders: () => Promise<Array<{ id: string; label: string; models: string[]; keyOptional: boolean }>>;
    getOpenCliProfiles: () => Promise<string[]>;
    saveLlmKey: (args: { provider: string; model: string; key: string }) => Promise<RadarState>;
    clearLlmKey: (provider: string) => Promise<RadarState>;
    openExternal: (url: string) => Promise<void>;
    onUpdated: (callback: (state: RadarState) => void) => () => void;
    onLoginUpdated: (callback: (result: { loginId?: string; profileId?: AccountProfile['id']; success: boolean; error?: string | null }) => void) => () => void;
    onLoginProgress: (callback: (result: { profileId: AccountProfile['id']; phase: 'connecting' | 'logging-out' | 'logged-out' | 'starting-login' | 'waiting' }) => void) => () => void;
  };
}

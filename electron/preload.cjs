const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radar', {
  getState: () => ipcRenderer.invoke('radar:get-state'),
  run: () => ipcRenderer.invoke('radar:run'),
  toggleHud: () => ipcRenderer.invoke('radar:toggle-hud'),
  showMain: () => ipcRenderer.invoke('radar:show-main'),
  hideHud: () => ipcRenderer.invoke('radar:hide-hud'),
  startLogin: (type, profileId) => ipcRenderer.invoke('radar:start-login', type, profileId),
  cancelLogin: () => ipcRenderer.invoke('radar:cancel-login'),
  switchAccountProfile: (profileId) => ipcRenderer.invoke('radar:switch-account-profile', profileId),
  openAccountDesktop: (profileId) => ipcRenderer.invoke('radar:open-account-desktop', profileId),
  consumeResetCredit: (args) => ipcRenderer.invoke('radar:consume-reset-credit', args),
  saveSettings: (settings) => ipcRenderer.invoke('radar:save-settings', settings),
  saveAccount: (account) => ipcRenderer.invoke('radar:save-account', account),
  addReset: (record) => ipcRenderer.invoke('radar:add-reset', record),
  deleteReset: (id) => ipcRenderer.invoke('radar:delete-reset', id),
  importTiboPost: (url) => ipcRenderer.invoke('radar:import-tibo-post', url),
  saveMiniMaxKey: (value) => ipcRenderer.invoke('radar:save-minimax-key', value),
  clearMiniMaxKey: () => ipcRenderer.invoke('radar:clear-minimax-key'),
  getLlmProviders: () => ipcRenderer.invoke('radar:get-llm-providers'),
  getOpenCliProfiles: () => ipcRenderer.invoke('radar:get-opencli-profiles'),
  saveLlmKey: (args) => ipcRenderer.invoke('radar:save-llm-key', args),
  clearLlmKey: (provider) => ipcRenderer.invoke('radar:clear-llm-key', provider),
  openExternal: (url) => ipcRenderer.invoke('radar:open-external', url),
  onUpdated: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('radar:updated', listener);
    return () => ipcRenderer.removeListener('radar:updated', listener);
  },
  onLoginUpdated: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('radar:login-updated', listener);
    return () => ipcRenderer.removeListener('radar:login-updated', listener);
  },
  onLoginProgress: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('radar:login-progress', listener);
    return () => ipcRenderer.removeListener('radar:login-progress', listener);
  },
});

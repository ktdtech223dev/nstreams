const { contextBridge, ipcRenderer } = require('electron');

// Pull port from query string synchronously so the renderer can build
// the API base before any fetch fires.
const qs = new URLSearchParams(window.location.search);
const apiPort = parseInt(qs.get('apiPort')) || 57832;
const appVersion = qs.get('version') || '';

contextBridge.exposeInMainWorld('electron', {
  apiPort,
  appVersion,
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: (opts) => ipcRenderer.invoke('install-update', opts),
  onUpdateProgress: (cb) => {
    const h = (_, data) => cb(data);
    ipcRenderer.on('update-progress', h);
    return () => ipcRenderer.removeListener('update-progress', h);
  },
  openUserDataFolder: () => ipcRenderer.invoke('open-user-data-folder'),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  minimize: () => ipcRenderer.invoke('minimize'),
  maximize: () => ipcRenderer.invoke('maximize'),
  close: () => ipcRenderer.invoke('close'),
  getStore: (key) => ipcRenderer.invoke('get-store', key),
  setStore: (key, val) => ipcRenderer.invoke('set-store', key, val),
  getActiveUser: () => ipcRenderer.invoke('get-active-user'),
  setActiveUser: (id) => ipcRenderer.invoke('set-active-user', id),
  onOAuthCallback: (cb) => {
    ipcRenderer.on('oauth-callback', (_, url) => cb(url));
  },
  // Embedded Player (BrowserView inside main window)
  player: {
    open: (opts) => ipcRenderer.invoke('player:open', opts),
    close: () => ipcRenderer.invoke('player:close'),
    reload: () => ipcRenderer.invoke('player:reload'),
    setBounds: (bounds) => ipcRenderer.invoke('player:set-bounds', bounds),
    getState: () => ipcRenderer.invoke('player:get-state'),
    onSourceBlocked: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('player:source-blocked', handler);
      return () => ipcRenderer.removeListener('player:source-blocked', handler);
    }
  },
  onRedirectBlocked: (cb) => ipcRenderer.on('viewer-redirect-blocked', (_, data) => cb(data)),
  // Legacy pop-out window (fallback; not used by default anymore)
  watchInApp: (opts) => ipcRenderer.invoke('watch-in-app', opts),
  clearViewerSession: () => ipcRenderer.invoke('clear-viewer-session'),
  clearViewerDomain: (domain) => ipcRenderer.invoke('clear-viewer-domain', domain),
  viewerLinkedDomains: (domains) => ipcRenderer.invoke('viewer-linked-domains', domains),
  onViewerClosed: (cb) => ipcRenderer.on('viewer-closed', (_, data) => cb(data)),
  onPopupBlocked: (cb) => ipcRenderer.on('viewer-popup-blocked', (_, data) => cb(data)),
  onViewerEscaped: (cb) => ipcRenderer.on('viewer-escaped', (_, data) => cb(data)),
  adblockStatus: () => ipcRenderer.invoke('adblock-status'),
  adblockToggle: (on) => ipcRenderer.invoke('adblock-toggle', on),
  viewerProxy: {
    get: (userId) => ipcRenderer.invoke('viewer-proxy:get', userId),
    set: (userId, enabled) => ipcRenderer.invoke('viewer-proxy:set', { userId, enabled }),
  },
  vpn: {
    get: (userId) => ipcRenderer.invoke('vpn:get', userId),
    set: (userId, enabled) => ipcRenderer.invoke('vpn:set', { userId, enabled }),
  },

  // Watch Party
  party: {
    setRelay: (url) => ipcRenderer.invoke('party:set-relay', url),
    getState: () => ipcRenderer.invoke('party:get-state'),
    create: (opts) => ipcRenderer.invoke('party:create', opts),
    join: (opts) => ipcRenderer.invoke('party:join', opts),
    leave: () => ipcRenderer.invoke('party:leave'),
    chat: (text) => ipcRenderer.invoke('party:chat', text),
    reaction: (emoji) => ipcRenderer.invoke('party:reaction', emoji),
    control: (action, current_time) => ipcRenderer.invoke('party:control', { action, current_time }),
    // Host: push a specific URL to all party members
    loadVideo: (opts) => ipcRenderer.invoke('party:load-video', opts),
    on: (event, cb) => {
      const channel = `party:${event}`;
      const handler = (_, payload) => cb(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  }
});

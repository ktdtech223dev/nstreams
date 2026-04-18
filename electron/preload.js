const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
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
  // In-app viewer
  watchInApp: (opts) => ipcRenderer.invoke('watch-in-app', opts),
  clearViewerSession: () => ipcRenderer.invoke('clear-viewer-session'),
  clearViewerDomain: (domain) => ipcRenderer.invoke('clear-viewer-domain', domain),
  viewerLinkedDomains: (domains) => ipcRenderer.invoke('viewer-linked-domains', domains),
  onViewerClosed: (cb) => ipcRenderer.on('viewer-closed', (_, data) => cb(data)),

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
    on: (event, cb) => {
      const channel = `party:${event}`;
      const handler = (_, payload) => cb(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    }
  }
});

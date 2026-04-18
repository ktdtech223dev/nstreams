const { app, BrowserWindow, shell, ipcMain, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const store = new Store();
const { startServer } = require('./server/index');
const party = require('./party');

let mainWindow;
const viewerWindows = new Map(); // sessionId → BrowserWindow
let currentPartyViewer = null;   // The viewer window currently bound to a party

// Enable media playback features. Widevine DRM is NOT available in
// unsigned dev builds — free/ad-supported services work; premium
// services will load and sign in, but hit an error on play.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#080810',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Deep link protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('nstreams', process.execPath, [
      path.resolve(process.argv[1])
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('nstreams');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const url = argv.find(a => a.startsWith('nstreams://'));
      if (url) mainWindow.webContents.send('oauth-callback', url);
    }
  });
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) mainWindow.webContents.send('oauth-callback', url);
});

// IPC
ipcMain.handle('open-url', (_, url) => shell.openExternal(url));
ipcMain.handle('minimize', () => mainWindow?.minimize());
ipcMain.handle('maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('close', () => mainWindow?.close());
ipcMain.handle('get-store', (_, key) => store.get(key));
ipcMain.handle('set-store', (_, key, val) => store.set(key, val));
ipcMain.handle('get-active-user', () => store.get('active_user_id', 1));
ipcMain.handle('set-active-user', (_, id) => store.set('active_user_id', id));

// ───────── In-app streaming viewer ─────────
// Opens the given URL inside a persistent Electron window.
// Cookies are shared across all viewer windows via a single
// partition, so users sign in once per service.
ipcMain.handle('watch-in-app', async (_, { url, title, sessionId, partyId }) => {
  const partition = 'persist:nstreams-viewer';

  // Ensure we have a user-agent that looks like Chrome so services
  // don't reject the session as unsupported.
  const viewerSession = session.fromPartition(partition);
  try {
    viewerSession.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
  } catch (_) {}

  const viewer = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    title: title || 'N Streams Viewer',
    autoHideMenuBar: true,
    webPreferences: {
      partition,
      contextIsolation: false,     // preload uses ipcRenderer directly to hook <video>
      nodeIntegration: false,
      preload: path.join(__dirname, 'viewer-preload.js'),
      webSecurity: true,
      sandbox: false,              // preload needs `require('electron')`
      plugins: true
    }
  });

  viewer.loadURL(url);

  if (sessionId) viewerWindows.set(String(sessionId), viewer);

  // If this window is for a party, register it so party.js can talk to it.
  if (partyId) {
    currentPartyViewer = viewer;
    party.setWindows(mainWindow, viewer);
  }

  viewer.on('closed', () => {
    if (sessionId) {
      viewerWindows.delete(String(sessionId));
    }
    if (currentPartyViewer === viewer) {
      currentPartyViewer = null;
      party.setWindows(mainWindow, null);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.focus();
      if (sessionId) mainWindow.webContents.send('viewer-closed', { sessionId });
    }
  });

  return { ok: true };
});

// Clear saved cookies / login for the viewer partition
ipcMain.handle('clear-viewer-session', async () => {
  const s = session.fromPartition('persist:nstreams-viewer');
  await s.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
  });
  return { ok: true };
});

// Clear cookies for a specific domain only (per-service unlink)
ipcMain.handle('clear-viewer-domain', async (_, domain) => {
  const s = session.fromPartition('persist:nstreams-viewer');
  const cookies = await s.cookies.get({ domain });
  for (const c of cookies) {
    const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`;
    try { await s.cookies.remove(url, c.name); } catch (_) {}
  }
  return { ok: true, cleared: cookies.length };
});

// Check which domains have cookies (crude "is linked?" indicator)
ipcMain.handle('viewer-linked-domains', async (_, domains) => {
  const s = session.fromPartition('persist:nstreams-viewer');
  const result = {};
  for (const d of domains) {
    try {
      const cookies = await s.cookies.get({ domain: d });
      result[d] = cookies.length > 0;
    } catch (_) { result[d] = false; }
  }
  return result;
});

// Wire party IPC
party.registerIpc({
  getRelayUrl: () => store.get('relay_url'),
  getViewerWindow: () => currentPartyViewer,
  getMainWindow: () => mainWindow
});

app.whenReady().then(async () => {
  await createWindow();
  party.setWindows(mainWindow, null);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

const { app, BrowserWindow, shell, ipcMain, session, dialog } = require('electron');
const path = require('path');
const https = require('https');
const Store = require('electron-store');
const store = new Store();
const { startServer, getResolvedPort } = require('./server/index');
const party = require('./party');

// Lock to a single running instance BEFORE anything else touches the port.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
  process.exit(0);
}

let mainWindow;
const viewerWindows = new Map(); // sessionId → BrowserWindow
let currentPartyViewer = null;   // The viewer window currently bound to a party

// Enable media playback features. Widevine DRM is NOT available in
// unsigned dev builds — free/ad-supported services work; premium
// services will load and sign in, but hit an error on play.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

async function createWindow() {
  let apiPort;
  try {
    apiPort = await startServer();
  } catch (err) {
    dialog.showErrorBox(
      'N Streams — failed to start',
      `The local API server couldn't start.\n\n${err.message}\n\n` +
      `If you have another copy of N Streams running, please close it and try again. ` +
      `If the issue persists, restart your computer to free the port.`
    );
    app.quit();
    return;
  }

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
  // Pass the resolved API port to the renderer via query so api.js can find it.
  const query = `?apiPort=${apiPort}&version=${encodeURIComponent(app.getVersion())}`;

  if (isDev) {
    mainWindow.loadURL(`http://localhost:5173/${query}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      search: query.replace(/^\?/, '')
    });
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

app.on('second-instance', (event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const url = argv.find(a => a.startsWith('nstreams://'));
    if (url) mainWindow.webContents.send('oauth-callback', url);
  }
});

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

// ───────── App info + updater ─────────
ipcMain.handle('get-app-info', () => ({
  version: app.getVersion(),
  apiPort: getResolvedPort(),
  userDataPath: app.getPath('userData'),
  platform: process.platform,
  arch: process.arch
}));

// Simple updater: queries GitHub Releases, compares tag against current version.
// Doesn't auto-install (portable exe can't safely replace itself while running).
// Surfaces a download link if there's a newer release.
ipcMain.handle('check-for-updates', async () => {
  return new Promise((resolve) => {
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/ktdtech223dev/nstreams/releases/latest',
      method: 'GET',
      headers: { 'User-Agent': `NStreams/${app.getVersion()}`, 'Accept': 'application/vnd.github+json' }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const rel = JSON.parse(body);
          if (!rel || !rel.tag_name) {
            resolve({ error: 'Unable to read latest release' });
            return;
          }
          const latest = String(rel.tag_name).replace(/^v/, '');
          const current = app.getVersion();
          const hasUpdate = cmpSemver(latest, current) > 0;
          const asset = (rel.assets || []).find(a => /\.exe$/i.test(a.name) && /portable/i.test(a.name));
          resolve({
            current,
            latest,
            hasUpdate,
            name: rel.name,
            notes: rel.body,
            publishedAt: rel.published_at,
            downloadUrl: asset?.browser_download_url || rel.html_url,
            htmlUrl: rel.html_url
          });
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
});

function cmpSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n) || 0);
  const pb = String(b).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

ipcMain.handle('open-user-data-folder', () => {
  shell.openPath(app.getPath('userData'));
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

// The crew's shared Watch Party relay — hardcoded default so the app
// works out of the box. Users can still override in Settings.
const DEFAULT_RELAY_URL = 'https://nstreams-production.up.railway.app';
if (!store.get('relay_url')) store.set('relay_url', DEFAULT_RELAY_URL);

// Wire party IPC
party.registerIpc({
  getRelayUrl: () => store.get('relay_url') || DEFAULT_RELAY_URL,
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

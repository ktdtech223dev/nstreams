// Polyfill File for Node < 20 (Electron 28 ships Node 18.18).
// Some cheerio/undici/fetch-blob code paths reference globalThis.File
// at module load and crash without it.
if (typeof globalThis.File === 'undefined') {
  try {
    const { File } = require('node:buffer');
    if (File) globalThis.File = File;
    else throw new Error('no-File');
  } catch {
    globalThis.File = class File {
      constructor(parts, name, options = {}) {
        this.name = name;
        this.lastModified = options.lastModified || Date.now();
        this.type = options.type || '';
        this._parts = parts || [];
      }
    };
  }
}
if (typeof globalThis.Blob === 'undefined') {
  try { globalThis.Blob = require('node:buffer').Blob; } catch {}
}

const { app, BrowserWindow, BrowserView, shell, ipcMain, session, dialog } = require('electron');
const path = require('path');
const https = require('https');
const Store = require('electron-store');
const store = new Store();
const { startServer, getResolvedPort } = require('./server/index');
const party = require('./party');
const adblocker = require('./adblocker');

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
// Remove navigator.webdriver=true so Cloudflare/anti-bot doesn't detect us as automated.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

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
    backgroundColor: '#050510',
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

  // Premium services (Amazon/Netflix/Disney/etc.) depend on tracker
  // domains that the adblocker would otherwise kill. Toggle the shared
  // viewer partition's blocker based on the current URL.
  if (store.get('adblock_enabled', true) && adblocker.isEnabled()) {
    if (adblocker.isPremiumUrl(url)) {
      adblocker.disable();
      console.log('[viewer] adblock disabled for premium service:', new URL(url).hostname);
    } else {
      adblocker.enable();
    }
  }

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

  // Nuke every popup attempt from scraper-site ads. For premium services
  // (Amazon sign-in captcha, Netflix 2FA etc.), allow popups that stay
  // on the same top-level domain as what we loaded.
  const viewerHost = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const premiumHost = adblocker.isPremiumUrl(url);

  viewer.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl === 'about:blank') return { action: 'allow' };

    // For premium services: allow popups on the same parent domain
    if (premiumHost) {
      try {
        const t = new URL(targetUrl).hostname;
        const sameRoot = t === viewerHost ||
          t.endsWith('.' + viewerHost.split('.').slice(-2).join('.')) ||
          viewerHost.endsWith('.' + t.split('.').slice(-2).join('.'));
        if (sameRoot) return { action: 'allow' };
      } catch {}
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('viewer-popup-blocked', { url: targetUrl });
    }
    return { action: 'deny' };
  });

  // Block navigation to known-bad domains at the webRequest level too
  viewer.webContents.on('will-navigate', (e, navUrl) => {
    const bad = /(?:\.ads?\.|doubleclick\.net|googleadservices|popads|popcash|adsterra|propellerads|exoclick|trafficjunky|clickadu|hilltopads)/i;
    if (bad.test(navUrl)) {
      e.preventDefault();
      console.log('[viewer] blocked nav to', navUrl);
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

// ───────── Embedded Player (BrowserView inside main window) ─────────
// Replaces the pop-out BrowserWindow viewer. The renderer tells us the
// screen rect of the player slot; we stretch a BrowserView to match.
let playerView = null;
let playerState = {
  url: null, title: null, partyId: null,
  contentId: null, userId: null, watchlistId: null,
  season: null, episode: null, provider: null,
  position: 0, duration: 0
};
let positionSaveTimer = null;

// ─── Per-user CDN proxy (routes blocked CDN requests through relay) ──────────
// When enabled for a user, the viewer session's requests to known video CDN
// domains are intercepted and redirected to our relay's /proxy endpoint,
// which fetches them with the relay server's IP (bypassing IP/geo blocks).

// When proxy is enabled for a user, ALL sub-resource requests from the viewer
// session are routed through the relay — no domain list to maintain.
// mainFrame (the embed page itself) loads normally so relative URLs resolve
// correctly; everything the page then requests goes through the relay.
const CDN_PROXY_PATTERNS = ['<all_urls>'];

function isViewerProxyEnabled(userId) {
  const users = store.get('viewer_proxy_users', []);
  return users.includes(String(userId));
}

function applyViewerProxy() {
  const viewerSession = session.fromPartition('persist:nstreams-viewer');
  const uid = playerState?.userId;
  const relayBase = party.getRelayUrl?.();

  if (!uid || !relayBase || !isViewerProxyEnabled(uid)) {
    // Remove interceptors if proxy is off for this user
    try { viewerSession.webRequest.onBeforeRequest({ urls: CDN_PROXY_PATTERNS }, null); } catch {}
    try { viewerSession.webRequest.onBeforeSendHeaders(null); } catch {}
    return;
  }

  const relay = relayBase.replace(/\/$/, '');
  const PROXY_TOKEN = 'nstreams-crew-proxy-2026';

  // We can't send custom headers with redirectURL, so we use onBeforeSendHeaders
  // to inject the auth token into requests that land on our relay /proxy endpoint.
  viewerSession.webRequest.onBeforeSendHeaders(
    { urls: [`${relay}/proxy*`] },
    (details, callback) => {
      const headers = { ...details.requestHeaders, 'x-nstreams-proxy': PROXY_TOKEN };
      callback({ requestHeaders: headers });
    }
  );

  viewerSession.webRequest.onBeforeRequest({ urls: CDN_PROXY_PATTERNS }, (details, callback) => {
    // Double-check at call time (toggle may have changed while player is open)
    if (!isViewerProxyEnabled(playerState?.userId)) return callback({});
    // Let the main embed page load directly — it's the CDN sub-requests we care about.
    // Proxying the main frame breaks relative URL resolution inside the page.
    if (details.resourceType === 'mainFrame') return callback({});
    // Skip non-HTTP(S) (WebSockets, data:, blob:, etc.) — redirect doesn't apply
    if (!details.url.startsWith('http')) return callback({});
    // Skip requests already going to our relay (avoid infinite loop)
    if (details.url.startsWith(relay)) return callback({});
    const proxyUrl = `${relay}/proxy?url=${encodeURIComponent(details.url)}`;
    callback({ redirectURL: proxyUrl });
  });
  console.log('[proxy] CDN proxy active for userId', uid);
}

ipcMain.handle('viewer-proxy:get', (_, userId) => ({
  enabled: isViewerProxyEnabled(userId)
}));

ipcMain.handle('viewer-proxy:set', (_, { userId, enabled }) => {
  const users = store.get('viewer_proxy_users', []);
  const updated = enabled
    ? [...new Set([...users, String(userId)])]
    : users.filter(id => id !== String(userId));
  store.set('viewer_proxy_users', updated);
  applyViewerProxy(); // re-apply for whoever is in the player right now
  return { ok: true, enabled };
});

// Known video-delivery CDN domains. A 403 on any of these means the CDN
// is geo-blocking or IP-blocking this machine — not a transient error.
const VIDEO_CDN_DOMAINS = new Set([
  'cloudnestra.com', 'filemoon.sx', 'filemoon.to', 'filemoon.in',
  'voe.sx', 'voe.bar', 'voe.monster',
  'doodstream.com', 'dood.watch', 'dood.la', 'dood.wf',
  'streamtape.com', 'streamtape.net', 'streamta.pe',
  'upstream.to', 'rabbitstream.net', 'rapid-cloud.co',
  'vidplay.online', 'vidplay.site', 'vidplay.lol',
  'megacloud.tv', 'megacloud.ru',
]);

function isVideoCdn(hostname) {
  const h = (hostname || '').toLowerCase();
  for (const d of VIDEO_CDN_DOMAINS) {
    if (h === d || h.endsWith('.' + d)) return true;
  }
  return false;
}

function watchForCdnBlocks() {
  try {
    const viewerSession = session.fromPartition('persist:nstreams-viewer');
    viewerSession.webRequest.onCompleted((details) => {
      if (!playerView) return;
      if (details.statusCode !== 403 && details.statusCode !== 451) return;
      if (details.resourceType === 'mainFrame') return; // ignore top-level page 403s
      try {
        const host = new URL(details.url).hostname;
        if (isVideoCdn(host)) {
          toRenderer('player:source-blocked', { host, statusCode: details.statusCode });
        }
      } catch {}
    });
  } catch (e) { console.warn('[player] webRequest watch failed:', e.message); }
}

function clearCdnBlockWatch() {
  try {
    session.fromPartition('persist:nstreams-viewer').webRequest.onCompleted(null);
  } catch {}
}

function destroyPlayerView(savePosition = true) {
  if (!playerView) return;
  if (savePosition) savePlayerPosition(true);

  // End any open watching_session so history appears in crew profiles
  // even if the user just closes the player without marking an episode done.
  if (playerState.userId && playerState.contentId) {
    try {
      const db = require('./server/database').getDB();
      db.prepare(`
        UPDATE watching_sessions SET ended_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND content_id = ? AND ended_at IS NULL
      `).run(playerState.userId, playerState.contentId);
    } catch (e) { console.warn('[player] session end error:', e.message); }
  }

  clearCdnBlockWatch();

  try {
    if (playerState.partyId && party.setWindows) party.setWindows(mainWindow, null);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeBrowserView(playerView);
    if (playerView.webContents && !playerView.webContents.isDestroyed()) {
      playerView.webContents.removeAllListeners();
      playerView.webContents.destroy();
    }
  } catch (e) { console.warn('[player] destroy error:', e.message); }
  playerView = null;
  playerState = { url: null, title: null, partyId: null, contentId: null,
                  userId: null, watchlistId: null, position: 0, duration: 0 };
  clearInterval(positionSaveTimer);
  positionSaveTimer = null;
}

function savePlayerPosition(immediate = false) {
  const { watchlistId, position, duration, url, userId, contentId, season, episode, provider } = playerState;
  if (!position) return;
  const db = require('./server/database').getDB();
  try {
    if (watchlistId) {
      // Keep show-level last site url for the Hero billboard + Continue Watching card
      db.prepare(`
        UPDATE watchlist SET
          last_position_seconds = ?,
          last_duration_seconds = ?,
          last_site_url = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(position, duration || 0, url || null, watchlistId);
    }
    // Per-episode progress when we know the S/E
    if (userId && contentId && season && episode) {
      db.prepare(`
        INSERT INTO episode_progress
          (user_id, content_id, season_number, episode_number,
           last_site_url, last_provider,
           last_position_seconds, last_duration_seconds, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, content_id, season_number, episode_number)
        DO UPDATE SET
          last_site_url = excluded.last_site_url,
          last_provider = excluded.last_provider,
          last_position_seconds = excluded.last_position_seconds,
          last_duration_seconds = excluded.last_duration_seconds,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        userId, contentId, season, episode,
        url || null, provider || null,
        position, duration || 0
      );
    }
  } catch (e) { if (immediate) console.warn('[player] position save failed:', e.message); }
}

ipcMain.handle('player:open', async (_, opts) => {
  const {
    url, title, partyId = null,
    contentId = null, userId = null, watchlistId = null,
    season = null, episode = null, provider = null,
    bounds, resumeAt = 0
  } = opts;

  // If a player is already open, reuse it (just load new URL)
  if (!playerView) {
    const partition = 'persist:nstreams-viewer';
    try {
      session.fromPartition(partition).setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
    } catch {}

    playerView = new BrowserView({
      webPreferences: {
        partition,
        preload: path.join(__dirname, 'viewer-preload.js'),
        contextIsolation: false,
        nodeIntegration: false,
        // Inject viewer-preload into nested iframes so embed-aggregator
        // videos (VidSrc/Embed.su/2Embed load the <video> in a child
        // frame) still get resume tracking + party sync hooks.
        nodeIntegrationInSubFrames: true,
        sandbox: false,
        plugins: true,
        webSecurity: true
      }
    });
    mainWindow.addBrowserView(playerView);

    // Adblock toggle per-URL
    if (store.get('adblock_enabled', true) && adblocker.isEnabled()) {
      if (adblocker.isPremiumUrl(url)) adblocker.disable();
      else adblocker.enable();
    }

    // Host guardrails — scraper/embed sites love to hijack the top
    // frame and redirect us to ad pages (Stake.us, sports-betting
    // landers, etc). Pin playback to the initial URL's root domain +
    // a handful of known video-CDN hosts the embeds legitimately use.
    const viewerHost = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
    const viewerRoot = viewerHost.split('.').slice(-2).join('.');
    const STREAMING_CDN_ROOTS = new Set([
      // VidSrc fronts + CDNs
      'vidsrc.to', 'vidsrc.me', 'vidsrc.net', 'vidsrc.xyz', 'vidsrc.stream', 'vidsrc.pro',
      'cloudnestra.com', 'rcp.me', '2embed.skin', 'rapidcloud.co', 'superembed.stream',
      // Embed.su + common sources
      'embed.su', 'vidlink.pro', 'smashystream.com', 'smashy.stream',
      // 2Embed fronts
      '2embed.cc', '2embed.org', '2embed.to',
      // Media source CDNs
      'megacloud.tv', 'megacloud.ru', 'akamaihd.net', 'cloudfront.net',
      // Anime aggregators' known CDN hosts
      'miruro.tv', 'anify.eltik.cc', 'allanime.to', 'aniplaynow.live',
      // FlixHQ / SFlix bundles
      'flixhq.to', 'sflix.to'
    ]);

    function isAllowedHost(hostname) {
      if (!hostname) return false;
      if (hostname === viewerHost) return true;
      if (viewerRoot && (hostname === viewerRoot || hostname.endsWith('.' + viewerRoot))) return true;
      for (const root of STREAMING_CDN_ROOTS) {
        if (hostname === root || hostname.endsWith('.' + root)) return true;
      }
      return false;
    }

    const premium = adblocker.isPremiumUrl(url);

    playerView.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (targetUrl === 'about:blank') return { action: 'allow' };
      if (premium) {
        try {
          const t = new URL(targetUrl).hostname;
          const sameRoot = t === viewerHost || t.endsWith('.' + viewerRoot);
          if (sameRoot) return { action: 'allow' };
        } catch {}
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('viewer-popup-blocked', { url: targetUrl });
      }
      return { action: 'deny' };
    });

    // Block top-frame navigations to other domains. Allow the initial
    // load through by flipping a flag after did-finish-load.
    let navGuardArmed = false;
    playerView.webContents.on('did-finish-load', () => { navGuardArmed = true; });

    const guard = (event, targetUrl) => {
      if (!navGuardArmed) return;
      try {
        const t = new URL(targetUrl).hostname;
        if (isAllowedHost(t)) return;
        event.preventDefault();
        console.log('[player] blocked redirect →', t);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('viewer-redirect-blocked', {
            from: playerView.webContents.getURL(),
            to: targetUrl,
            host: t
          });
        }
      } catch {}
    };
    playerView.webContents.on('will-navigate', guard);
    playerView.webContents.on('will-redirect', guard);

    // Position + duration heartbeat from viewer-preload
    ipcMain.removeAllListeners('player:heartbeat');
    ipcMain.on('player:heartbeat', (ev, payload) => {
      if (ev.sender.id !== playerView?.webContents.id) return;
      playerState.position = payload.current_time || 0;
      playerState.duration = payload.duration || playerState.duration;
    });
  }

  if (bounds) playerView.setBounds(bounds);

  playerState = {
    url, title, partyId,
    contentId, userId, watchlistId,
    season, episode, provider,
    position: resumeAt, duration: 0
  };

  // Periodic save every 10s
  if (positionSaveTimer) clearInterval(positionSaveTimer);
  positionSaveTimer = setInterval(() => savePlayerPosition(), 10000);

  await playerView.webContents.loadURL(url);

  // Apply CDN proxy if enabled for this user, then watch for any remaining blocks
  applyViewerProxy();
  watchForCdnBlocks();

  // If we're in a watch party as host, tell all members to open this URL.
  party.announceVideo(url, title, contentId);

  // Once loaded + video discovered, seek to resume position if we have one
  if (resumeAt && resumeAt > 5) {
    playerView.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        try {
          playerView.webContents.send('party:apply', { action: 'play', current_time: resumeAt });
        } catch {}
      }, 2500);
    });
  }

  // Wire party binding
  if (partyId) party.setWindows(mainWindow, playerView);

  return { ok: true };
});

ipcMain.handle('player:set-bounds', (_, bounds) => {
  if (playerView && bounds) playerView.setBounds(bounds);
});

ipcMain.handle('player:close', () => {
  destroyPlayerView(true);
  return { ok: true };
});

ipcMain.handle('player:get-state', () => ({
  open: !!playerView,
  ...playerState
}));

ipcMain.handle('player:reload', () => {
  if (!playerView || !playerState.url) return { ok: false };
  try { playerView.webContents.loadURL(playerState.url); } catch {}
  return { ok: true };
});

// Legacy viewer-close escape button from preload
ipcMain.on('viewer:open-externally', (event) => {
  if (playerView && event.sender === playerView.webContents) {
    const currentUrl = playerView.webContents.getURL();
    shell.openExternal(currentUrl);
    destroyPlayerView(true);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('viewer-escaped', { url: currentUrl });
    }
    return;
  }
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const currentUrl = win.webContents.getURL();
  shell.openExternal(currentUrl);
  win.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('viewer-escaped', { url: currentUrl });
  }
});

ipcMain.handle('adblock-status', () => ({
  enabled: adblocker.isEnabled(),
  setting: store.get('adblock_enabled', true)
}));
ipcMain.handle('adblock-toggle', async (_, on) => {
  store.set('adblock_enabled', !!on);
  if (on) {
    if (!adblocker.isEnabled()) {
      await adblocker.init(app.getPath('userData'));
      adblocker.enableFor(session.defaultSession);
      adblocker.enableFor(session.fromPartition('persist:nstreams-viewer'));
    } else {
      adblocker.enable();
    }
  } else {
    adblocker.disable();
  }
  return { enabled: adblocker.isEnabled() };
});

// Download and install an update in-place.
// Strategy for portable Windows exe:
//   1. Download new exe next to current as "<name>.update.exe"
//   2. Write a tiny .bat that waits for us to quit, swaps files, relaunches
//   3. Spawn the batch detached, quit the app
ipcMain.handle('install-update', async (_, { downloadUrl }) => {
  if (!downloadUrl) throw new Error('No download URL provided');
  if (process.platform !== 'win32') {
    shell.openExternal(downloadUrl);
    return { opened: true };
  }

  const fs = require('fs');
  const { spawn } = require('child_process');

  // For electron-builder portable target, process.execPath points to a
  // temp-extracted copy that gets deleted on quit. The real exe the user
  // launched is exposed via PORTABLE_EXECUTABLE_FILE. Fall back to
  // execPath when running from a proper install (not portable).
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const dir = path.dirname(exePath);
  const name = path.basename(exePath);
  const updatePath = path.join(dir, `${name}.update.exe`);
  const batPath = path.join(dir, 'nstreams-updater.bat');
  const logPath = path.join(dir, 'nstreams-updater.log');

  // Send progress events to renderer
  const send = (event, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-progress', { event, ...payload });
    }
  };

  // 1. Download
  await new Promise((resolve, reject) => {
    const follow = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const { get } = url.startsWith('https:') ? require('https') : require('http');
      get(url, { headers: { 'User-Agent': `NStreams/${app.getVersion()}` } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length']) || 0;
        let loaded = 0;
        const out = fs.createWriteStream(updatePath);
        res.on('data', (chunk) => {
          loaded += chunk.length;
          send('progress', { loaded, total, percent: total ? Math.round(loaded * 100 / total) : 0 });
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(downloadUrl);
  });

  send('downloaded', { path: updatePath });

  // 2. Write updater batch
  // Logs every step to nstreams-updater.log next to the exe so failures
  // are debuggable. "ping -n" gives us a portable sleep.
  const bat = `@echo off
setlocal enableextensions
chcp 65001 >NUL
set "LOG=${logPath}"
> "%LOG%" echo [%DATE% %TIME%] N Streams updater starting
echo   exePath   = ${exePath} >> "%LOG%"
echo   updatePath = ${updatePath} >> "%LOG%"
echo Waiting for app to exit... >> "%LOG%"

:: Wait up to 20s for the running app to release the file
set /a tries=0
:wait_loop
ping -n 2 127.0.0.1 >NUL
del "${exePath}" 2>NUL
if not exist "${exePath}" goto swap
set /a tries=tries+1
if %tries% LSS 10 goto wait_loop
echo WARNING: exe still locked after 20s — trying move anyway >> "%LOG%"

:swap
echo Moving update into place... >> "%LOG%"
move /y "${updatePath}" "${exePath}" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo ERROR: move failed. Update exe left at ${updatePath} >> "%LOG%"
  echo Open the log: %LOG% > "${updatePath}.INSTALL_FAILED.txt"
  exit /b 1
)

echo Launching new version: ${exePath} >> "%LOG%"
start "" "${exePath}"
echo Done. >> "%LOG%"

:: Self-delete
(goto) 2>NUL & del "%~f0"
`;
  fs.writeFileSync(batPath, bat, 'utf8');

  // 3. Spawn detached + quit. Show the cmd window so users see activity
  // (and can read error text if swap fails).
  const child = spawn('cmd.exe', ['/c', batPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,   // show window so it's obvious something is happening
    cwd: dir
  });
  child.unref();

  send('installing', {});

  // Give the child a moment to start before we exit
  setTimeout(() => app.quit(), 800);
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
  // Initialize ad/tracker blocker — applied only to the viewer partition
  // (the main window doesn't need it, it serves our own UI). Per-window
  // URL is inspected at watchInApp time to auto-disable for premium
  // streaming services whose auth flows depend on the blocked domains.
  const adblockEnabled = store.get('adblock_enabled', true);
  if (adblockEnabled) {
    adblocker.init(app.getPath('userData')).then(() => {
      adblocker.enableFor(session.fromPartition('persist:nstreams-viewer'));
    });
  }

  await createWindow();
  party.setWindows(mainWindow, null);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Party controller (main process).
// - Keeps one WebSocket connection to the Railway relay
// - Bridges viewer-window IPC ↔ relay WS
// - Exposes IPC handlers for the renderer (create / join / leave / chat / reaction)

const WebSocket = require('ws');
const { ipcMain } = require('electron');

let ws = null;
let party = null;           // current party object from relay
let user = null;            // { id, name, color }
let relayUrl = null;        // e.g. https://nstreams-relay-production.up.railway.app
let viewerWin = null;       // BrowserWindow currently showing the party video
let mainWin = null;         // main N Streams window (for UI events)
let pingInterval = null;

// viewerWin may be a BrowserWindow (legacy popout) OR a BrowserView (the
// embedded player). BrowserView has no isDestroyed() of its own — only its
// webContents does. Normalize by always going through webContents.
function aliveContents(winOrView) {
  const wc = winOrView && winOrView.webContents;
  if (!wc) return null;
  if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return null;
  return wc;
}

function setWindows(main, viewer) {
  mainWin = main;
  viewerWin = viewer;
  const wc = aliveContents(viewer);
  if (wc) wc.send('party:active', !!party);
}

function toRenderer(channel, payload) {
  const wc = aliveContents(mainWin);
  if (wc) wc.send(channel, payload);
}
function toViewer(channel, payload) {
  const wc = aliveContents(viewerWin);
  if (wc) wc.send(channel, payload);
}

function wsUrl(base) {
  return base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
}
function restUrl(base) {
  return base.replace(/\/$/, '');
}

async function createParty({ host_id, host_name, host_color, content, site }) {
  if (!relayUrl) throw new Error('No relay URL configured');
  const res = await fetch(`${restUrl(relayUrl)}/parties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host_id, host_name, host_color, content, site })
  });
  if (!res.ok) throw new Error(`Relay error ${res.status}`);
  const p = await res.json();
  return p;
}

async function fetchParty(idOrCode) {
  if (!relayUrl) throw new Error('No relay URL configured');
  const res = await fetch(`${restUrl(relayUrl)}/parties/${encodeURIComponent(idOrCode)}`);
  if (!res.ok) throw new Error('Party not found');
  return res.json();
}

function connect(partyData, me) {
  disconnect();
  party = partyData;
  user = me;

  ws = new WebSocket(wsUrl(relayUrl));
  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'join',
      party_id: party.id,
      user_id: user.id,
      name: user.name,
      color: user.color
    }));
    // Ask for current playback state so we can sync on join
    setTimeout(() => {
      try { ws.send(JSON.stringify({ type: 'request_sync' })); } catch {}
    }, 500);
    pingInterval = setInterval(() => {
      try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
    }, 20000);
    toRenderer('party:connected', { party, user });
    toViewer('party:active', true);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    switch (msg.type) {
      case 'joined':
        party = msg.party;
        toRenderer('party:state', party);
        break;
      case 'presence':
        if (party) party.members = msg.members;
        toRenderer('party:presence', msg.members);
        break;
      case 'chat':
        toRenderer('party:chat', msg.message);
        break;
      case 'system':
        toRenderer('party:system', msg);
        break;
      case 'reaction':
        toRenderer('party:reaction', msg);
        toViewer('party:reaction', msg);
        break;
      case 'load_video':
        // Host switched to a different video — open it on this client.
        toRenderer('party:load_video', {
          url: msg.url,
          title: msg.title,
          contentId: msg.contentId || null
        });
        break;
      case 'playback':
        // Someone else controlled playback — apply to our video.
        toViewer('party:apply', {
          action: msg.action,
          current_time: msg.current_time
        });
        toRenderer('party:playback', msg);
        break;
      case 'heartbeat':
        toRenderer('party:heartbeat', msg);
        break;
      case 'sync_request':
        // Another client wants our current state; answer.
        toViewer('party:request-state');
        break;
      case 'party_ended':
        toRenderer('party:ended');
        disconnect();
        break;
    }
  });

  ws.on('close', () => {
    clearInterval(pingInterval);
    toRenderer('party:disconnected');
    toViewer('party:active', false);
  });
  ws.on('error', (e) => {
    toRenderer('party:error', { error: String(e.message || e) });
  });
}

function disconnect() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = null;
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  const had = !!party;
  party = null;
  if (had) toViewer('party:active', false);
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/**
 * Broadcast the video the host just opened to all party members.
 * Only works when we're in a party and we are the host.
 */
function announceVideo(url, title, contentId) {
  if (!party || !user) return;
  if (user.id !== String(party.host_id)) return;
  send({ type: 'load_video', url, title: title || '', contentId: contentId || null });
}

// ─── IPC wiring ───────────────────────────────────────────────
function registerIpc({ getRelayUrl, getViewerWindow, getMainWindow }) {
  ipcMain.handle('party:set-relay', (_, url) => {
    relayUrl = url;
    return { ok: true };
  });
  ipcMain.handle('party:get-state', () => ({ party, user, relay: relayUrl }));

  ipcMain.handle('party:create', async (_, opts) => {
    relayUrl = opts.relay || relayUrl || getRelayUrl?.();
    if (!relayUrl) throw new Error('Set a Relay URL in Settings first');
    const p = await createParty(opts);
    connect(p, { id: String(opts.host_id), name: opts.host_name, color: opts.host_color });
    return p;
  });

  ipcMain.handle('party:join', async (_, opts) => {
    relayUrl = opts.relay || relayUrl || getRelayUrl?.();
    if (!relayUrl) throw new Error('Set a Relay URL in Settings first');
    const p = await fetchParty(opts.party_code_or_id);
    connect(p, { id: String(opts.user_id), name: opts.name, color: opts.color });
    return p;
  });

  ipcMain.handle('party:leave', () => {
    disconnect();
    return { ok: true };
  });

  ipcMain.handle('party:chat', (_, text) => {
    send({ type: 'chat', text });
    return { ok: true };
  });

  ipcMain.handle('party:reaction', (_, emoji) => {
    send({ type: 'reaction', emoji });
    return { ok: true };
  });

  ipcMain.handle('party:control', (_, { action, current_time }) => {
    // Renderer-initiated manual control (pause all / resume all)
    send({ type: 'playback', action, current_time });
    toViewer('party:apply', { action, current_time });
    return { ok: true };
  });

  ipcMain.handle('party:load-video', (_, { url, title, contentId }) => {
    announceVideo(url, title, contentId);
    return { ok: true };
  });

  ipcMain.handle('party:register-viewer', (event) => {
    // Called from viewer-preload when it loads; allows main to find the viewer window
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    viewerWin = win;
    if (party) event.sender.send('party:active', true);
    return { ok: true };
  });

  // From viewer-preload
  ipcMain.on('party:playback', (event, payload) => {
    send({ type: 'playback', action: payload.action, current_time: payload.current_time });
  });
  ipcMain.on('party:heartbeat', (event, payload) => {
    send({ type: 'heartbeat', ...payload });
  });
  ipcMain.on('party:video-ready', (event, payload) => {
    toRenderer('party:video-ready', payload);
  });
  ipcMain.on('party:state', (event, payload) => {
    if (payload) send({ type: 'playback', action: payload.playing ? 'play' : 'pause', current_time: payload.current_time });
  });
}

module.exports = { registerIpc, setWindows, disconnect, announceVideo, getRelayUrl: () => relayUrl };

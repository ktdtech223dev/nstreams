// WebSocket connection to the Launcher server.
// Mirrors the reconnect pattern from E:/NiggaGames/Launcher/ngames.js.
// The server broadcasts to ALL clients (targetIds=null), so no identify needed.
const WebSocket = require('ws');

const RETRY_BASE = 2_000;
const RETRY_MAX  = 30_000;

let ws = null;
let retryMs = RETRY_BASE;
let retryTimer = null;
const handlers = {}; // eventType → [fn, ...]

function on(type, fn) {
  if (!handlers[type]) handlers[type] = [];
  handlers[type].push(fn);
}

function emit(type, payload) {
  (handlers[type]   || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(`[ws] handler error (${type}):`, e.message); } });
  (handlers['*']    || []).forEach(fn => { try { fn(payload); } catch {} });
}

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  const url = (process.env.LAUNCHER_WS || 'wss://ngames-server-production.up.railway.app');
  console.log('[ws] connecting to', url);

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[ws] connected');
    retryMs = RETRY_BASE;
    clearTimeout(retryTimer);
    // Keep-alive ping every 30s
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 30_000);
    ws.once('close', () => clearInterval(ping));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'pong') return; // ignore pongs
      emit(msg.type, msg);
    } catch {}
  });

  ws.on('close', () => {
    console.log(`[ws] closed — retry in ${retryMs}ms`);
    retryTimer = setTimeout(() => {
      retryMs = Math.min(retryMs * 2, RETRY_MAX);
      connect();
    }, retryMs);
  });

  ws.on('error', () => {}); // 'close' fires after error
}

module.exports = { connect, on };

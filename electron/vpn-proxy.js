/**
 * N Streams built-in VPN — local SOCKS5 proxy + WebSocket tunnel
 *
 * Creates a SOCKS5 server on 127.0.0.1 that tunnels every TCP connection
 * through the N Games Launcher server via WebSocket. When enabled, Electron
 * sessions are pointed at this proxy so ALL traffic (metadata, player,
 * everything) routes through the crew's server and out with its IP.
 *
 * No external VPN app or subscription needed.
 *
 * API:
 *   const { start, stop } = require('./vpn-proxy');
 *   const port = await start();   // starts local SOCKS5, returns port number
 *   await stop();                 // shuts down
 */

'use strict';

const net = require('net');
const { WebSocket } = require('ws');

const VPN_WS   = 'wss://ngames-server-production.up.railway.app/vpn';
const VPN_TOKEN = 'ngames-crew-vpn-7x4k';

let proxyServer = null;
let listenPort  = null;

// ── SOCKS5 helpers ─────────────────────────────────────────────────────────────

const SOCKS5_NO_AUTH_REPLY  = Buffer.from([0x05, 0x00]);
// "succeeded" response — we fill BND.ADDR and BND.PORT with zeros (allowed by spec)
const SOCKS5_SUCCESS        = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
const SOCKS5_CONN_REFUSED   = Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);

/**
 * Parse a SOCKS5 CONNECT request (after the auth phase).
 * Returns { host, port } or null if the buffer is incomplete.
 */
function parseSocks5Connect(buf) {
  // Minimum: VER CMD RSV ATYP + 4-byte IPv4 + 2-byte port = 10 bytes
  if (buf.length < 10) return null;
  if (buf[0] !== 0x05 || buf[1] !== 0x01 || buf[2] !== 0x00) return null;

  const atype = buf[3];

  if (atype === 0x01) {
    // IPv4 — 4 bytes
    if (buf.length < 10) return null;
    const host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
    const port = buf.readUInt16BE(8);
    return { host, port };
  }

  if (atype === 0x03) {
    // Domain — 1 byte length prefix
    const domLen = buf[4];
    if (buf.length < 5 + domLen + 2) return null;
    const host = buf.slice(5, 5 + domLen).toString('utf8');
    const port = buf.readUInt16BE(5 + domLen);
    return { host, port };
  }

  if (atype === 0x04) {
    // IPv6 — 16 bytes
    if (buf.length < 22) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
    const host = parts.join(':');
    const port = buf.readUInt16BE(20);
    return { host, port };
  }

  return null; // unknown address type
}

// ── Per-connection handler ─────────────────────────────────────────────────────

function handleSocks5Client(socket) {
  socket.on('error', () => {});

  let phase     = 'greeting'; // greeting → connect → tunnel
  let recvBuf   = Buffer.alloc(0);
  let ws        = null;
  let wsReady   = false;
  let pendingData = []; // data received before WS tunnel is fully open

  socket.on('data', (chunk) => {
    if (phase === 'tunnel') {
      // Fast path — tunnel is open, push straight to WebSocket
      if (wsReady && ws?.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      } else {
        pendingData.push(chunk); // buffer until WS confirms ready
      }
      return;
    }

    recvBuf = Buffer.concat([recvBuf, chunk]);

    if (phase === 'greeting') {
      // Wait for: VER NMETHODS METHODS...
      if (recvBuf.length < 2) return;
      const nmethods = recvBuf[1];
      if (recvBuf.length < 2 + nmethods) return;

      socket.write(SOCKS5_NO_AUTH_REPLY);
      recvBuf = recvBuf.slice(2 + nmethods);
      phase   = 'connect';
    }

    if (phase === 'connect') {
      const target = parseSocks5Connect(recvBuf);
      if (!target) return; // wait for more bytes

      recvBuf = Buffer.alloc(0);
      phase   = 'tunnel';

      // Open the WebSocket tunnel to the server
      ws = new WebSocket(VPN_WS, { handshakeTimeout: 15_000 });

      ws.on('open', () => {
        ws.send(JSON.stringify({ token: VPN_TOKEN, host: target.host, port: target.port }));
      });

      ws.on('message', (data, isBinary) => {
        if (!wsReady) {
          // First message is the server's { ok: true } confirmation
          try {
            const msg = JSON.parse(data.toString());
            if (msg.ok) {
              wsReady = true;
              socket.write(SOCKS5_SUCCESS);
              // Flush anything that arrived while we were connecting
              for (const d of pendingData) {
                if (ws.readyState === WebSocket.OPEN) ws.send(d);
              }
              pendingData = [];
            } else {
              socket.write(SOCKS5_CONN_REFUSED);
              socket.destroy();
              ws.close();
            }
          } catch {
            socket.write(SOCKS5_CONN_REFUSED);
            socket.destroy();
          }
          return;
        }

        // Relay server data back to the local client
        if (!socket.destroyed) socket.write(data);
      });

      ws.on('close', () => {
        if (!socket.destroyed) socket.destroy();
      });

      ws.on('error', () => {
        if (!socket.destroyed) {
          if (!wsReady) socket.write(SOCKS5_CONN_REFUSED);
          socket.destroy();
        }
      });
    }
  });

  socket.on('close', () => {
    ws?.close();
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

function start() {
  if (proxyServer) return Promise.resolve(listenPort);

  return new Promise((resolve, reject) => {
    proxyServer = net.createServer(handleSocks5Client);
    // Port 0 → OS picks a free port
    proxyServer.listen(0, '127.0.0.1', () => {
      listenPort = proxyServer.address().port;
      console.log(`[vpn] SOCKS5 proxy listening on 127.0.0.1:${listenPort}`);
      resolve(listenPort);
    });
    proxyServer.on('error', (err) => {
      proxyServer = null;
      listenPort  = null;
      reject(err);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!proxyServer) return resolve();
    proxyServer.close(() => {
      proxyServer = null;
      listenPort  = null;
      resolve();
    });
  });
}

module.exports = { start, stop };

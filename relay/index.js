// N Streams Watch Party relay
// WebSocket fan-out + in-memory party state.
// Deploy to Railway: just push this folder as a service, set PORT.

const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const { nanoid } = require('nanoid');

const PORT = process.env.PORT || 8787;
const app = express();
app.use(cors());
app.use(express.json());

// ─── In-memory state ─────────────────────────────────────────
// parties: { id, code, host_id, content, site, created_at,
//            members:{uid:{name,color,joined_at}},
//            state:{playing,current_time,updated_at,updater_id},
//            messages:[{id,user_id,name,color,text,ts}] }
const parties = new Map();
const clients = new Map(); // ws → { party_id, user }

function makeCode() {
  // 6-char friendly code
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

function publicParty(p) {
  return {
    id: p.id,
    code: p.code,
    host_id: p.host_id,
    content: p.content,
    site: p.site,
    created_at: p.created_at,
    members: Object.values(p.members),
    state: p.state,
    messages: p.messages.slice(-100)
  };
}

// ─── REST ─────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({ ok: true, service: 'nstreams-relay', parties: parties.size }));

app.post('/parties', (req, res) => {
  const { host_id, host_name, host_color, content, site } = req.body || {};
  if (!host_id || !host_name) return res.status(400).json({ error: 'host_id + host_name required' });

  const id = nanoid(10);
  const code = makeCode();
  const party = {
    id,
    code,
    host_id: String(host_id),
    content: content || null,
    site: site || null,
    created_at: Date.now(),
    members: {},
    state: { playing: false, current_time: 0, updated_at: Date.now(), updater_id: null },
    messages: []
  };
  parties.set(id, party);
  // Also index by code
  parties.set(`code:${code}`, party);
  res.json(publicParty(party));
});

app.get('/parties/:idOrCode', (req, res) => {
  const key = req.params.idOrCode;
  const p = parties.get(key) || parties.get(`code:${key.toUpperCase()}`);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(publicParty(p));
});

app.get('/parties', (_, res) => {
  const list = [...parties.values()]
    .filter((p, i, arr) => arr.indexOf(p) === i) // dedupe (we double-index by code)
    .map(publicParty);
  res.json(list);
});

app.delete('/parties/:id', (req, res) => {
  const p = parties.get(req.params.id);
  if (!p) return res.json({ ok: true });
  parties.delete(p.id);
  parties.delete(`code:${p.code}`);
  broadcast(p.id, { type: 'party_ended' });
  res.json({ ok: true });
});

// ─── WebSocket ───────────────────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(partyId, msg, except) {
  const data = JSON.stringify(msg);
  for (const [ws, meta] of clients.entries()) {
    if (meta.party_id !== partyId) continue;
    if (except && ws === except) continue;
    if (ws.readyState === 1) ws.send(data);
  }
}

function presenceUpdate(partyId) {
  const p = parties.get(partyId);
  if (!p) return;
  broadcast(partyId, { type: 'presence', members: Object.values(p.members) });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const meta = clients.get(ws) || {};

    switch (msg.type) {
      case 'join': {
        const p = parties.get(msg.party_id);
        if (!p) {
          ws.send(JSON.stringify({ type: 'error', error: 'party_not_found' }));
          return;
        }
        const user = {
          id: String(msg.user_id),
          name: msg.name,
          color: msg.color || '#6366f1',
          joined_at: Date.now()
        };
        p.members[user.id] = user;
        clients.set(ws, { party_id: p.id, user });
        ws.send(JSON.stringify({ type: 'joined', party: publicParty(p) }));
        presenceUpdate(p.id);
        broadcast(p.id, { type: 'system', text: `${user.name} joined` }, ws);
        break;
      }

      case 'chat': {
        if (!meta.party_id) return;
        const p = parties.get(meta.party_id);
        if (!p) return;
        const message = {
          id: nanoid(8),
          user_id: meta.user.id,
          name: meta.user.name,
          color: meta.user.color,
          text: String(msg.text || '').slice(0, 1000),
          ts: Date.now()
        };
        p.messages.push(message);
        if (p.messages.length > 500) p.messages.shift();
        broadcast(p.id, { type: 'chat', message });
        break;
      }

      case 'reaction': {
        if (!meta.party_id) return;
        broadcast(meta.party_id, {
          type: 'reaction',
          user: meta.user,
          emoji: String(msg.emoji || '🔥').slice(0, 8),
          ts: Date.now()
        });
        break;
      }

      case 'playback': {
        // { action: 'play'|'pause'|'seek', current_time, ts }
        if (!meta.party_id) return;
        const p = parties.get(meta.party_id);
        if (!p) return;
        p.state = {
          playing: msg.action === 'play' ? true : (msg.action === 'pause' ? false : p.state.playing),
          current_time: typeof msg.current_time === 'number' ? msg.current_time : p.state.current_time,
          updated_at: Date.now(),
          updater_id: meta.user.id
        };
        broadcast(p.id, {
          type: 'playback',
          action: msg.action,
          current_time: p.state.current_time,
          updater: meta.user,
          ts: Date.now()
        }, ws);
        break;
      }

      case 'heartbeat': {
        // Client reports its current playback time periodically for drift correction.
        if (!meta.party_id) return;
        broadcast(meta.party_id, {
          type: 'heartbeat',
          user_id: meta.user.id,
          current_time: msg.current_time,
          playing: msg.playing,
          ts: Date.now()
        }, ws);
        break;
      }

      case 'request_sync': {
        // Newly joined client asks "where is everyone?"
        if (!meta.party_id) return;
        broadcast(meta.party_id, {
          type: 'sync_request',
          from: meta.user
        }, ws);
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        break;
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    if (!meta) return;
    const p = parties.get(meta.party_id);
    if (p) {
      delete p.members[meta.user.id];
      presenceUpdate(p.id);
      broadcast(p.id, { type: 'system', text: `${meta.user.name} left` });
      // Auto-clean empty parties after 30s
      setTimeout(() => {
        const cur = parties.get(meta.party_id);
        if (cur && Object.keys(cur.members).length === 0) {
          parties.delete(cur.id);
          parties.delete(`code:${cur.code}`);
        }
      }, 30000);
    }
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`N Streams relay on :${PORT}`);
});

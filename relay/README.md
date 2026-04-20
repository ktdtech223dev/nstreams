# N Streams Relay

WebSocket + REST relay for Watch Parties. Runs in-memory by default; opts into SQLite persistence when a volume is mounted.

## Deploy to Railway

1. Push this folder as a new Railway service (`railway init` in `relay/`, or GitHub repo → Railway → New Service)
2. Railway auto-detects Node (via `nixpacks`) and runs `npm install && node index.js`
3. Railway assigns a public URL like `https://nstreams-relay-production.up.railway.app`
4. Open N Streams → Settings → set **Relay URL** to that URL

That's it. Free tier Railway is more than enough for a 4-person crew.

### Optional: persistent party history (Railway Volume)

By default party state lives in memory — restart the service and history's gone. To persist chat logs, party records, and member history across restarts:

1. In Railway → your relay service → **Volumes** tab → **New Volume**
2. **Mount path:** `/data`
3. Variables → add: `DATA_DIR=/data`
4. Redeploy

The relay auto-detects the mount and switches on SQLite at `/data/relay.db`. `GET /` now reports `"persistent": true`, and `GET /history` returns the last 50 parties.

Volume is free up to 5 GB on Railway's developer plan, which is enough for *years* of party chat at your crew's scale.

## Local dev

```bash
npm install
npm run dev   # watches and restarts
```

Listens on `http://localhost:8787` by default. WebSocket path: `/ws`.

## REST endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Health check |
| GET | `/parties` | List active parties |
| POST | `/parties` | Create party. Body: `{ host_id, host_name, host_color, content, site }` |
| GET | `/parties/:idOrCode` | Get party by id or code |
| DELETE | `/parties/:id` | End party |

## WebSocket protocol

Connect to `wss://<relay>/ws`, send `{type: 'join', party_id, user_id, name, color}`, then:

| Client → server | Purpose |
|---|---|
| `chat` `{text}` | Send chat message |
| `reaction` `{emoji}` | Send floating reaction |
| `playback` `{action:'play'/'pause'/'seek', current_time}` | Broadcast a playback control |
| `heartbeat` `{current_time, playing}` | Periodic state for drift correction |
| `request_sync` | Ask party for current state |

| Server → client | Meaning |
|---|---|
| `joined` `{party}` | Acknowledge join with initial state |
| `presence` `{members}` | Member list changed |
| `chat` `{message}` | New chat message |
| `reaction` `{user, emoji}` | Show floating reaction |
| `playback` `{action, current_time, updater}` | Apply to local `<video>` |
| `heartbeat` `{user_id, current_time, playing}` | Other member's state |
| `system` `{text}` | Join/leave notices |
| `party_ended` | Host ended party |

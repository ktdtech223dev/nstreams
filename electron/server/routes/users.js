const express  = require('express');
const https    = require('https');
const http     = require('http');
const { getDB } = require('../database');
const { pushCrewStats } = require('../discord');

const router = express.Router();

const NGAMES_API = 'https://ngames-server-production.up.railway.app';

// ── Fetch the shared crew snapshot from N Games server ─────────────────────────
// Returns a Map<username, snapshot> or empty Map on failure.
function fetchCrewSnapshots() {
  return new Promise((resolve) => {
    const url = new URL(`${NGAMES_API}/nstreams/crew`);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: url.hostname, path: url.pathname, method: 'GET',
        headers: { 'User-Agent': 'NStreams/1.0' } },
      (res) => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          try {
            const arr = JSON.parse(body);
            const map = new Map();
            arr.forEach(s => map.set(s.username, s));
            resolve(map);
          } catch { resolve(new Map()); }
        });
      }
    );
    req.on('error', () => resolve(new Map()));
    req.setTimeout(4000, () => { req.destroy(); resolve(new Map()); });
    req.end();
  });
}

function fetchCrewSnapshot(username) {
  return new Promise((resolve) => {
    const url = new URL(`${NGAMES_API}/nstreams/crew/${encodeURIComponent(username)}`);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      { hostname: url.hostname, path: url.pathname, method: 'GET',
        headers: { 'User-Agent': 'NStreams/1.0' } },
      (res) => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(4000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── GET /api/users — all crew with cloud-merged stats ─────────────────────────
router.get('/users', async (req, res) => {
  try {
    const db = getDB();
    const users = db.prepare('SELECT * FROM users ORDER BY id').all();

    // Fetch shared snapshots from N Games server (best-effort; no timeout risk since async)
    const snapshots = await fetchCrewSnapshots();

    const withStats = users.map(u => {
      const snap = snapshots.get(u.username);

      // For the local user, always compute fresh from local DB
      // For others, prefer the cloud snapshot (which is their own machine's data)
      const localStats = (() => {
        const rows = db.prepare(
          'SELECT watch_status, COUNT(*) as c FROM watchlist WHERE user_id = ? GROUP BY watch_status'
        ).all(u.id);
        const s = { watching: 0, completed: 0, plan_to_watch: 0 };
        rows.forEach(r => {
          if (r.watch_status === 'watching')       s.watching      = r.c;
          else if (r.watch_status === 'completed') s.completed     = r.c;
          else if (r.watch_status === 'plan_to_watch') s.plan_to_watch = r.c;
        });
        return s;
      })();

      // If the cloud snapshot has MORE data than local, prefer cloud
      // (cloud = data pushed from the user's own device)
      const stats = snap && (snap.watching + snap.completed + snap.plan_to_watch)
                            >= (localStats.watching + localStats.completed + localStats.plan_to_watch)
        ? { watching: snap.watching, completed: snap.completed, plan_to_watch: snap.plan_to_watch }
        : localStats;

      return { ...u, stats };
    });

    res.json(withStats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/users/:id — single user with cloud-merged detail ─────────────────
router.get('/users/:id', async (req, res) => {
  try {
    const db   = getDB();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    // Fetch this user's cloud snapshot in parallel with local queries
    const [snap, localRows, localCompleted, localThisWeek] = await Promise.all([
      fetchCrewSnapshot(user.username),
      Promise.resolve(db.prepare(
        'SELECT watch_status, COUNT(*) as c FROM watchlist WHERE user_id = ? GROUP BY watch_status'
      ).all(user.id)),
      Promise.resolve(db.prepare(`
        SELECT w.id, w.content_id, c.title, c.poster_path, w.user_rating
        FROM watchlist w JOIN content c ON w.content_id = c.id
        WHERE w.user_id = ? AND w.watch_status = 'completed'
        ORDER BY w.updated_at DESC LIMIT 3
      `).all(user.id)),
      Promise.resolve(db.prepare(`
        SELECT ws.content_id, ws.content_id AS id,
               c.title, c.poster_path,
               w.current_episode, w.current_season,
               MAX(ws.started_at) as last_watched
        FROM watching_sessions ws
        JOIN content c ON ws.content_id = c.id
        LEFT JOIN watchlist w ON w.user_id = ws.user_id AND w.content_id = ws.content_id
        WHERE ws.user_id = ? AND ws.started_at > datetime('now', '-7 days')
        GROUP BY ws.content_id
        ORDER BY last_watched DESC LIMIT 5
      `).all(user.id)),
    ]);

    // Build local stats
    const localStats = { watching: 0, completed: 0, plan_to_watch: 0 };
    localRows.forEach(r => {
      if (r.watch_status === 'watching')           localStats.watching      = r.c;
      else if (r.watch_status === 'completed')     localStats.completed     = r.c;
      else if (r.watch_status === 'plan_to_watch') localStats.plan_to_watch = r.c;
    });

    // Prefer cloud data when it has more entries (= the user's own machine data)
    const localTotal = localStats.watching + localStats.completed + localStats.plan_to_watch;
    const cloudTotal = snap ? (snap.watching + snap.completed + snap.plan_to_watch) : 0;

    const useCloud = snap && cloudTotal >= localTotal;

    const stats = useCloud
      ? { watching: snap.watching, completed: snap.completed, plan_to_watch: snap.plan_to_watch }
      : localStats;

    const recentCompleted = (useCloud && snap.recent_completed?.length)
      ? snap.recent_completed
      : localCompleted;

    const thisWeek = (useCloud && snap.this_week?.length)
      ? snap.this_week
      : localThisWeek;

    res.json({ ...user, stats, recentCompleted, thisWeek });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/users/:id/push-crew-stats — manual relay push ───────────────────
router.post('/users/:id/push-crew-stats', (req, res) => {
  try {
    const db   = getDB();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    pushCrewStats(db, user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

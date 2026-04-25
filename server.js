/**
 * N Streams — standalone API server (Railway / cloud deployment)
 *
 * Run:  node server.js
 * Env:  PORT            (default 8080)
 *       DATABASE_PATH   (default ./nstreams.db)
 *       TMDB_API_KEY    (optional — falls back to baked-in default)
 *       ALLOWED_ORIGIN  (optional CORS origin whitelist, comma-separated)
 */

const express = require('express');
const cors    = require('cors');

const PORT = process.env.PORT || 8080;

// ─── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? process.env.ALLOWED_ORIGIN.split(',').map(s => s.trim())
  : null; // null = allow all

const app = express();
app.use(cors({
  origin: allowedOrigins
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error('Not allowed by CORS'));
      }
    : true,
}));
app.use(express.json({ limit: '10mb' }));

// ─── Routes ────────────────────────────────────────────────────────────────────
const { getDB }  = require('./electron/server/database');
const mal        = require('./electron/server/mal');
const anilist    = require('./electron/server/anilist');

getDB(); // initialise DB + run migrations

app.use('/api', require('./electron/server/routes/content'));
app.use('/api', require('./electron/server/routes/watchlist'));
app.use('/api', require('./electron/server/routes/users'));
app.use('/api', require('./electron/server/routes/sites'));
app.use('/api', require('./electron/server/routes/activity'));
app.use('/api', require('./electron/server/routes/sessions'));
app.use('/api', require('./electron/server/routes/sync'));
app.use('/api', require('./electron/server/routes/sports'));
app.use('/api', require('./electron/server/routes/cable'));

app.get('/api/health', (req, res) =>
  res.json({ ok: true, mode: 'cloud', version: require('./package.json').version })
);

// ─── Auto-sync MAL / AniList every 6 hours ────────────────────────────────────
setInterval(async () => {
  try {
    const db = getDB();
    for (const user of db.prepare('SELECT * FROM users WHERE mal_access_token IS NOT NULL').all()) {
      try { await mal.syncMALList(user.id); } catch (e) { console.warn('MAL sync', user.username, e.message); }
    }
    for (const user of db.prepare('SELECT * FROM users WHERE anilist_access_token IS NOT NULL').all()) {
      try { await anilist.syncAniListList(user.id); } catch (e) { console.warn('AniList sync', user.username, e.message); }
    }
  } catch (e) { console.warn('Auto-sync error:', e.message); }
}, 6 * 60 * 60 * 1000);

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`N Streams API running on port ${PORT}`);
  console.log(`DB: ${process.env.DATABASE_PATH || './nstreams.db'}`);
});

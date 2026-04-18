const express = require('express');
const cors = require('cors');
const { getDB } = require('./database');
const mal = require('./mal');
const anilist = require('./anilist');

const PORT = 57832;

function startServer() {
  return new Promise((resolve) => {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));

    // Initialize DB
    getDB();

    app.use('/api', require('./routes/content'));
    app.use('/api', require('./routes/watchlist'));
    app.use('/api', require('./routes/users'));
    app.use('/api', require('./routes/sites'));
    app.use('/api', require('./routes/activity'));
    app.use('/api', require('./routes/sessions'));
    app.use('/api', require('./routes/sync'));

    app.get('/api/health', (req, res) => res.json({ ok: true }));

    app.listen(PORT, () => {
      console.log(`N Streams server running on http://localhost:${PORT}`);
      resolve();
    });

    // Auto-sync every 6 hours
    setInterval(async () => {
      try {
        const db = getDB();
        const malUsers = db.prepare(
          'SELECT * FROM users WHERE mal_access_token IS NOT NULL'
        ).all();
        for (const user of malUsers) {
          try {
            await mal.syncMALList(user.id);
            console.log(`MAL sync OK for ${user.username}`);
          } catch (e) {
            console.log(`MAL sync failed for ${user.username}:`, e.message);
          }
        }
        const alUsers = db.prepare(
          'SELECT * FROM users WHERE anilist_access_token IS NOT NULL'
        ).all();
        for (const user of alUsers) {
          try {
            await anilist.syncAniListList(user.id);
            console.log(`AniList sync OK for ${user.username}`);
          } catch (e) {
            console.log(`AniList sync failed for ${user.username}:`, e.message);
          }
        }
      } catch (e) {
        console.log('Auto-sync error:', e.message);
      }
    }, 6 * 60 * 60 * 1000);
  });
}

module.exports = { startServer, PORT };

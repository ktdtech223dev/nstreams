const express = require('express');
const cors = require('cors');
const { getDB } = require('./database');
const mal = require('./mal');
const anilist = require('./anilist');

const PREFERRED_PORT = 57832;
const PORT_RANGE = 20;
let resolvedPort = null;

function getResolvedPort() { return resolvedPort; }

function startServer() {
  return new Promise((resolve, reject) => {
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
    app.use('/api', require('./routes/sports'));
    app.use('/api', require('./routes/cable'));
    app.use('/api', require('./routes/migrate'));

    app.get('/api/health', (req, res) => res.json({ ok: true, version: process.env.npm_package_version }));

    // Try preferred port first, step up if busy.
    let attempt = 0;
    const tryListen = () => {
      const port = PREFERRED_PORT + attempt;
      const server = app.listen(port, '127.0.0.1');
      server.once('listening', () => {
        resolvedPort = port;
        console.log(`N Streams server running on http://localhost:${port}`);
        resolve(port);
      });
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempt < PORT_RANGE) {
          attempt++;
          tryListen();
        } else {
          reject(err);
        }
      });
    };
    tryListen();

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

module.exports = { startServer, getResolvedPort, PREFERRED_PORT };

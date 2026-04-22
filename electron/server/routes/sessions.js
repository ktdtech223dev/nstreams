const express = require('express');
const { getDB } = require('../database');
const { maybeFireDiscord } = require('../discord');

const router = express.Router();

// POST /api/sessions/start
// Also ensures the user has a watchlist row (creates with status='watching'
// if missing, bumps plan_to_watch→watching if present), and saves the
// URL they're watching as the last source so we can default to it next time.
router.post('/sessions/start', (req, res) => {
  try {
    const { user_id, content_id, site_id, site_url } = req.body;
    const db = getDB();

    let w = db.prepare(
      'SELECT * FROM watchlist WHERE user_id = ? AND content_id = ?'
    ).get(user_id, content_id);

    if (!w) {
      // Insert a fresh watchlist row and mark as watching
      const wlInfo = db.prepare(`
        INSERT INTO watchlist
          (user_id, content_id, watch_status, current_season, current_episode,
           source, last_site_url, updated_at)
        VALUES (?, ?, 'watching', 1, 0, 'manual', ?, CURRENT_TIMESTAMP)
      `).run(user_id, content_id, site_url || null);
      w = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(wlInfo.lastInsertRowid);
      // Log the implicit add
      db.prepare(`
        INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
        VALUES (?, ?, 'added_to_watchlist', ?)
      `).run(user_id, content_id, JSON.stringify({ watch_status: 'watching', implicit: true }));
    } else {
      // Bump status to 'watching' if it was plan_to_watch or null.
      // Leave 'completed', 'on_hold', 'dropped' alone — those are deliberate.
      const bumpStatus = (!w.watch_status || w.watch_status === 'plan_to_watch');
      db.prepare(`
        UPDATE watchlist SET
          ${bumpStatus ? "watch_status = 'watching'," : ''}
          last_site_url = COALESCE(?, last_site_url),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(site_url || null, w.id);
      w = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(w.id);
    }

    const info = db.prepare(`
      INSERT INTO watching_sessions
        (user_id, content_id, site_id, episode_before, season_before)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      user_id, content_id, site_id || null,
      w.current_episode || 0,
      w.current_season || 1
    );

    db.prepare(`
      INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
      VALUES (?, ?, 'started_watching', ?)
    `).run(user_id, content_id, JSON.stringify({ site_id }));

    // Discord: announce first-ever watch of this content
    maybeFireDiscord(db, 'started_watching', user_id, content_id, {});

    res.json({
      session_id: info.lastInsertRowid,
      watchlist_id: w.id,
      watch_status: w.watch_status,
      last_site_url: w.last_site_url
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sessions/:id/end
router.post('/sessions/:id/end', (req, res) => {
  try {
    const { id } = req.params;
    const { finished_episode = false } = req.body;
    const db = getDB();

    const session = db.prepare('SELECT * FROM watching_sessions WHERE id = ?').get(id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (session.ended_at) return res.json({ ok: true, already_ended: true });

    db.prepare(`
      UPDATE watching_sessions SET ended_at = CURRENT_TIMESTAMP, finished_episode = ?
      WHERE id = ?
    `).run(finished_episode ? 1 : 0, id);

    if (finished_episode) {
      const w = db.prepare(`
        SELECT w.*, c.total_episodes, c.title
        FROM watchlist w JOIN content c ON w.content_id = c.id
        WHERE w.user_id = ? AND w.content_id = ?
      `).get(session.user_id, session.content_id);

      if (w) {
        const newEp = (w.current_episode || 0) + 1;
        const total = (w.total_watched_episodes || 0) + 1;
        let newStatus = w.watch_status;
        let completed = false;
        if (w.total_episodes && total >= w.total_episodes) {
          newStatus = 'completed';
          completed = true;
        } else if (w.watch_status === 'plan_to_watch') {
          newStatus = 'watching';
        }

        db.prepare(`
          UPDATE watchlist SET
            current_episode = ?, total_watched_episodes = ?,
            watch_status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newEp, total, newStatus, w.id);

        db.prepare(`
          INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
          VALUES (?, ?, 'finished_episode', ?)
        `).run(session.user_id, session.content_id,
               JSON.stringify({ episode: newEp, completed }));

        // Discord: announce season finales
        maybeFireDiscord(db, 'finished_episode', session.user_id, session.content_id, {
          episode: newEp,
          season:  w.current_season,
        });

        if (completed) {
          db.prepare(`
            INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
            VALUES (?, ?, 'completed', ?)
          `).run(session.user_id, session.content_id,
                 JSON.stringify({ title: w.title }));

          // Discord: announce series completion
          maybeFireDiscord(db, 'completed', session.user_id, session.content_id, {
            title: w.title,
          });
        }

        return res.json({ ok: true, advanced: true, completed, current_episode: newEp });
      }
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sessions/active/:userId
router.get('/sessions/active/:userId', (req, res) => {
  const rows = getDB().prepare(`
    SELECT ws.*, c.title, c.poster_path, c.total_episodes,
           s.name as site_name, s.url as site_url,
           w.current_episode, w.current_season, w.watch_status
    FROM watching_sessions ws
    JOIN content c ON ws.content_id = c.id
    LEFT JOIN sites s ON ws.site_id = s.id
    LEFT JOIN watchlist w ON w.user_id = ws.user_id AND w.content_id = ws.content_id
    WHERE ws.user_id = ? AND ws.ended_at IS NULL
    ORDER BY ws.started_at DESC
  `).all(req.params.userId);
  res.json(rows);
});

module.exports = router;

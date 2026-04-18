const express = require('express');
const { getDB } = require('../database');

const router = express.Router();

// POST /api/sessions/start
router.post('/sessions/start', (req, res) => {
  try {
    const { user_id, content_id, site_id } = req.body;
    const db = getDB();

    const w = db.prepare(
      'SELECT * FROM watchlist WHERE user_id = ? AND content_id = ?'
    ).get(user_id, content_id);

    const info = db.prepare(`
      INSERT INTO watching_sessions
        (user_id, content_id, site_id, episode_before, season_before)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      user_id, content_id, site_id || null,
      w ? w.current_episode : 0,
      w ? w.current_season : 1
    );

    db.prepare(`
      INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
      VALUES (?, ?, 'started_watching', ?)
    `).run(user_id, content_id, JSON.stringify({ site_id }));

    res.json({ session_id: info.lastInsertRowid });
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

        if (completed) {
          db.prepare(`
            INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
            VALUES (?, ?, 'completed', ?)
          `).run(session.user_id, session.content_id,
                 JSON.stringify({ title: w.title }));
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

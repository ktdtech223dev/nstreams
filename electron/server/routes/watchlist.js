const express = require('express');
const { getDB } = require('../database');
const { maybeFireDiscord } = require('../discord');

const router = express.Router();

// GET /api/watchlist/:userId
router.get('/watchlist/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const { status, sort = 'updated', q } = req.query;
    const db = getDB();

    let sql = `
      SELECT w.*, c.title, c.type, c.poster_path, c.backdrop_path,
             c.total_episodes, c.total_seasons, c.release_year,
             c.is_anime, c.overview
      FROM watchlist w
      JOIN content c ON w.content_id = c.id
      WHERE w.user_id = ?
    `;
    const params = [userId];

    if (status && status !== 'all') {
      sql += ' AND w.watch_status = ?';
      params.push(status);
    }
    if (q) {
      sql += ' AND c.title LIKE ?';
      params.push(`%${q}%`);
    }

    const sortMap = {
      updated: 'w.updated_at DESC',
      title: 'c.title ASC',
      rating: 'w.user_rating DESC',
      added: 'w.added_at DESC'
    };
    sql += ` ORDER BY ${sortMap[sort] || sortMap.updated}`;

    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/watchlist
router.post('/watchlist', (req, res) => {
  try {
    const {
      user_id, content_id, watch_status = 'plan_to_watch',
      current_season = 1, current_episode = 0, source = 'manual'
    } = req.body;
    const db = getDB();

    const info = db.prepare(`
      INSERT OR REPLACE INTO watchlist
        (user_id, content_id, watch_status, current_season,
         current_episode, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(user_id, content_id, watch_status, current_season, current_episode, source);

    db.prepare(`
      INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
      VALUES (?, ?, 'added_to_watchlist', ?)
    `).run(user_id, content_id, JSON.stringify({ watch_status }));

    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/watchlist/:id
router.put('/watchlist/:id', (req, res) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const db = getDB();

    const allowed = ['watch_status', 'current_season', 'current_episode',
      'total_watched_episodes', 'user_rating', 'notes',
      'start_date', 'finish_date'];
    const sets = [];
    const vals = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        sets.push(`${k} = ?`);
        vals.push(fields[k]);
      }
    }
    if (!sets.length) return res.json({ ok: true });
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);

    db.prepare(`UPDATE watchlist SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

    const w = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(id);

    if (fields.watch_status) {
      db.prepare(`
        INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
        VALUES (?, ?, 'status_changed', ?)
      `).run(w.user_id, w.content_id, JSON.stringify({ status: fields.watch_status }));
    }
    if (fields.user_rating) {
      db.prepare(`
        INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
        VALUES (?, ?, 'rated', ?)
      `).run(w.user_id, w.content_id, JSON.stringify({ rating: fields.user_rating }));

      // Discord: announce rating
      maybeFireDiscord(db, 'rated', w.user_id, w.content_id, { rating: fields.user_rating });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/watchlist/:id
router.delete('/watchlist/:id', (req, res) => {
  try {
    getDB().prepare('DELETE FROM watchlist WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/watchlist/:id/advance
router.post('/watchlist/:id/advance', (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();
    const w = db.prepare(`
      SELECT w.*, c.total_episodes, c.total_seasons, c.title
      FROM watchlist w JOIN content c ON w.content_id = c.id
      WHERE w.id = ?
    `).get(id);
    if (!w) return res.status(404).json({ error: 'Not found' });

    let newEp = (w.current_episode || 0) + 1;
    let newSeason = w.current_season || 1;
    let total = (w.total_watched_episodes || 0) + 1;
    let newStatus = w.watch_status;

    // Series completion
    if (w.total_episodes && total >= w.total_episodes) {
      newStatus = 'completed';
    } else if (w.watch_status === 'plan_to_watch') {
      newStatus = 'watching';
    }

    db.prepare(`
      UPDATE watchlist SET
        current_episode = ?,
        current_season = ?,
        total_watched_episodes = ?,
        watch_status = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newEp, newSeason, total, newStatus, id);

    db.prepare(`
      INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
      VALUES (?, ?, 'advanced_episode', ?)
    `).run(w.user_id, w.content_id, JSON.stringify({ season: newSeason, episode: newEp }));

    if (newStatus === 'completed' && w.watch_status !== 'completed') {
      db.prepare(`
        INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
        VALUES (?, ?, 'completed', ?)
      `).run(w.user_id, w.content_id, JSON.stringify({ title: w.title }));

      // Discord: announce series completion via manual advance
      maybeFireDiscord(db, 'completed', w.user_id, w.content_id, { title: w.title });
    }

    res.json({ ok: true, current_episode: newEp, current_season: newSeason, watch_status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

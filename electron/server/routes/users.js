const express = require('express');
const { getDB } = require('../database');

const router = express.Router();

// GET /api/users — all crew
router.get('/users', (req, res) => {
  const db = getDB();
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();

  const withStats = users.map(u => {
    const stats = db.prepare(`
      SELECT watch_status, COUNT(*) as c
      FROM watchlist WHERE user_id = ? GROUP BY watch_status
    `).all(u.id);
    const s = { watching: 0, completed: 0, plan_to_watch: 0, on_hold: 0, dropped: 0 };
    stats.forEach(r => { s[r.watch_status] = r.c; });
    return { ...u, stats: s };
  });

  res.json(withStats);
});

// GET /api/users/:id
router.get('/users/:id', (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  const stats = db.prepare(`
    SELECT watch_status, COUNT(*) as c
    FROM watchlist WHERE user_id = ? GROUP BY watch_status
  `).all(user.id);
  const s = { watching: 0, completed: 0, plan_to_watch: 0, on_hold: 0, dropped: 0 };
  stats.forEach(r => { s[r.watch_status] = r.c; });

  const recentCompleted = db.prepare(`
    SELECT w.*, c.title, c.poster_path
    FROM watchlist w JOIN content c ON w.content_id = c.id
    WHERE w.user_id = ? AND w.watch_status = 'completed'
    ORDER BY w.updated_at DESC LIMIT 3
  `).all(user.id);

  const thisWeek = db.prepare(`
    SELECT w.*, c.title, c.poster_path
    FROM watchlist w JOIN content c ON w.content_id = c.id
    WHERE w.user_id = ? AND w.updated_at > datetime('now', '-7 days')
    ORDER BY w.updated_at DESC LIMIT 3
  `).all(user.id);

  res.json({ ...user, stats: s, recentCompleted, thisWeek });
});

module.exports = router;

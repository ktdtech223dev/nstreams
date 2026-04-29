const express = require('express');
const { getDB } = require('../database');
const { pushCrewStats } = require('../discord');

const router = express.Router();

// GET /api/activity/crew
router.get('/activity/crew', (req, res) => {
  const rows = getDB().prepare(`
    SELECT a.*, u.display_name, u.username, u.avatar_color,
           c.title, c.poster_path
    FROM activity_feed a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN content c ON a.content_id = c.id
    ORDER BY a.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

// GET /api/activity/:userId
router.get('/activity/:userId', (req, res) => {
  const rows = getDB().prepare(`
    SELECT a.*, u.display_name, u.username, u.avatar_color,
           c.title, c.poster_path
    FROM activity_feed a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN content c ON a.content_id = c.id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC LIMIT 100
  `).all(req.params.userId);
  res.json(rows);
});

module.exports = router;

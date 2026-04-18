const express = require('express');
const { getDB } = require('../database');
const mal = require('../mal');
const anilist = require('../anilist');

const router = express.Router();

// ───────────── MAL ─────────────
router.get('/sync/mal/auth-url', (req, res) => {
  try {
    const { userId } = req.query;
    res.json({ url: mal.getAuthUrl(userId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sync/mal/callback', async (req, res) => {
  try {
    const { code, userId } = req.body;
    const profile = await mal.exchangeCode(code, userId);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sync/mal/:userId', async (req, res) => {
  try {
    const result = await mal.syncMALList(req.params.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────── AniList ───────────
router.get('/sync/anilist/auth-url', (req, res) => {
  try {
    res.json({ url: anilist.getAuthUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sync/anilist/callback', async (req, res) => {
  try {
    const { token, userId } = req.body;
    const profile = await anilist.fetchAniListUser(token);
    getDB().prepare(`
      UPDATE users SET anilist_user_id = ?, anilist_access_token = ? WHERE id = ?
    `).run(profile.id, token, userId);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/sync/anilist/:userId', async (req, res) => {
  try {
    const result = await anilist.syncAniListList(req.params.userId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ───────── Status ─────────
router.get('/sync/status/:userId', (req, res) => {
  const u = getDB().prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({
    mal: {
      connected: !!u.mal_access_token,
      username: u.mal_username,
      last_sync: u.last_mal_sync
    },
    anilist: {
      connected: !!u.anilist_access_token,
      user_id: u.anilist_user_id,
      last_sync: u.last_anilist_sync
    }
  });
});

module.exports = router;

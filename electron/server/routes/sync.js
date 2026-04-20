const express = require('express');
const { shell } = require('electron');
const { getDB } = require('../database');
const mal = require('../mal');
const anilist = require('../anilist');
const { waitForCallback, MAL_REDIRECT, ANILIST_REDIRECT, malRedirectUri, anilistRedirectUri } = require('../../oauth');

const router = express.Router();

// Expose the exact redirect URIs we'll use — renderer shows these
// with copy-to-clipboard so users can't typo them into MAL/AniList.
router.get('/sync/redirect-uris', (req, res) => {
  res.json({
    mal: malRedirectUri(),
    anilist: anilistRedirectUri()
  });
});

// ───────────── MAL ─────────────
// One-shot: opens MAL auth URL in browser, starts a loopback server on
// 127.0.0.1:57835 to catch the redirect, exchanges the code for a token.
router.post('/sync/mal/connect', async (req, res) => {
  try {
    const { userId } = req.body;
    const authUrl = mal.getAuthUrl(userId);

    // Start the callback listener BEFORE opening the browser.
    const callbackPromise = waitForCallback(MAL_REDIRECT);
    await shell.openExternal(authUrl);

    const params = await callbackPromise;
    if (!params.code) throw new Error('No authorization code received');

    const profile = await mal.exchangeCode(params.code, userId);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Retained for backwards compat / manual use
router.get('/sync/mal/auth-url', (req, res) => {
  try {
    res.json({ url: mal.getAuthUrl(req.query.userId) });
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
router.post('/sync/anilist/connect', async (req, res) => {
  try {
    const { userId } = req.body;
    const authUrl = anilist.getAuthUrl();
    const callbackPromise = waitForCallback(ANILIST_REDIRECT);
    await shell.openExternal(authUrl);
    const params = await callbackPromise;
    const token = params.access_token;
    if (!token) throw new Error('No access_token received');
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

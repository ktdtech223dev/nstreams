const express = require('express');
const { getDB } = require('../database');
const { loginUrlFor, requiresDrm, SERVICE_LOGIN } = require('../deeplinks');

const router = express.Router();

// GET /api/sites/linkable — services we know how to sign in to
router.get('/sites/linkable', (req, res) => {
  const db = getDB();
  const sites = db.prepare(`SELECT * FROM sites ORDER BY name ASC`).all();
  const linkable = sites.map(s => ({
    ...s,
    login_url: loginUrlFor(s.name, s.url),
    requires_drm: requiresDrm(s.name),
    supported: !!Object.keys(SERVICE_LOGIN).find(
      k => s.name.toLowerCase().includes(k) || k.includes(s.name.toLowerCase())
    )
  }));
  res.json(linkable);
});

// GET /api/sites — grouped by category
router.get('/sites', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT s.*, u.display_name as added_by_name, u.avatar_color
    FROM sites s LEFT JOIN users u ON s.added_by = u.id
    ORDER BY s.upvotes DESC, s.name ASC
  `).all();

  const grouped = {};
  rows.forEach(s => {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  });
  res.json({ all: rows, grouped });
});

// GET /api/sites/search
router.get('/sites/search', (req, res) => {
  const { q = '' } = req.query;
  const rows = getDB().prepare(`
    SELECT * FROM sites WHERE name LIKE ? OR url LIKE ? ORDER BY upvotes DESC
  `).all(`%${q}%`, `%${q}%`);
  res.json(rows);
});

// POST /api/sites
router.post('/sites', (req, res) => {
  try {
    const {
      name, url, category, description,
      is_free = 1, requires_vpn = 0, quality = 'HD', user_id
    } = req.body;
    const db = getDB();

    const domain = url.replace(/https?:\/\//, '').split('/')[0];
    const logo_url = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

    const info = db.prepare(`
      INSERT INTO sites
        (name, url, category, description, is_free, requires_vpn,
         quality, logo_url, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, url, category, description, is_free ? 1 : 0,
           requires_vpn ? 1 : 0, quality, logo_url, user_id);

    db.prepare(`
      INSERT INTO activity_feed (user_id, activity_type, metadata)
      VALUES (?, 'added_site', ?)
    `).run(user_id, JSON.stringify({ site_id: info.lastInsertRowid, name }));

    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(info.lastInsertRowid);
    res.json(site);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/sites/:id/upvote
router.put('/sites/:id/upvote', (req, res) => {
  try {
    getDB().prepare('UPDATE sites SET upvotes = upvotes + 1 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/sites/:id
router.delete('/sites/:id', (req, res) => {
  try {
    const { user_id } = req.query;
    const db = getDB();
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(req.params.id);
    if (!site) return res.status(404).json({ error: 'Not found' });
    if (site.added_by && String(site.added_by) !== String(user_id)) {
      return res.status(403).json({ error: 'Only the user who added this site can delete it' });
    }
    db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

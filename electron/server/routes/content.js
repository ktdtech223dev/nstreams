const express = require('express');
const { getDB } = require('../database');
const tmdb = require('../tmdb');
const scrapers = require('../scrapers');
const { deepLinkFor, loginUrlFor, requiresDrm } = require('../deeplinks');

const router = express.Router();

// GET /api/search?q=&type=
router.get('/search', async (req, res) => {
  try {
    const { q, type = 'multi' } = req.query;
    if (!q) return res.json([]);
    const results = await tmdb.search(q, type);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content — add from TMDB
router.post('/content', async (req, res) => {
  try {
    const { tmdb_id, type, user_id } = req.body;
    const db = getDB();

    let content = db.prepare('SELECT * FROM content WHERE tmdb_id = ?').get(tmdb_id);
    if (content) return res.json(content);

    const details = await tmdb.getDetails(tmdb_id, type === 'movie' ? 'movie' : 'tv');

    const info = db.prepare(`
      INSERT INTO content
        (tmdb_id, mal_id, title, type, poster_path, backdrop_path,
         overview, release_year, rating, genres, cast_list,
         total_seasons, total_episodes, status, is_anime, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      details.tmdb_id, details.mal_id, details.title, details.type,
      details.poster_path, details.backdrop_path, details.overview,
      details.release_year, details.rating, details.genres,
      details.cast_list, details.total_seasons, details.total_episodes,
      details.status, details.is_anime, user_id
    );

    content = db.prepare('SELECT * FROM content WHERE id = ?').get(info.lastInsertRowid);
    res.json({ ...content, providers: details.providers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content/manual
router.post('/content/manual', (req, res) => {
  try {
    const {
      title, type, description, poster_url,
      total_episodes, total_seasons, user_id
    } = req.body;
    const db = getDB();

    const info = db.prepare(`
      INSERT INTO content
        (title, type, poster_path, overview, total_episodes, total_seasons, added_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(title, type, poster_url, description, total_episodes, total_seasons, user_id);

    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(info.lastInsertRowid);
    res.json(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/content/:id
router.get('/content/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    const db = getDB();

    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(id);
    if (!content) return res.status(404).json({ error: 'Not found' });

    let watchlist = null;
    if (user_id) {
      watchlist = db.prepare(
        'SELECT * FROM watchlist WHERE user_id = ? AND content_id = ?'
      ).get(user_id, id);
    }

    const services = db.prepare(`
      SELECT cs.*, s.name, s.url, s.logo_url, s.category, s.quality,
             u.display_name as added_by_name, u.avatar_color
      FROM content_services cs
      JOIN sites s ON cs.site_id = s.id
      LEFT JOIN users u ON cs.added_by = u.id
      WHERE cs.content_id = ?
    `).all(id);

    res.json({ ...content, watchlist, services });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/content/:id/where-to-watch
router.get('/content/:id/where-to-watch', async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDB();
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(id);
    if (!content) return res.status(404).json({ error: 'Not found' });

    let tmdb_providers = [];
    if (content.tmdb_id) {
      try {
        const details = await tmdb.getDetails(
          content.tmdb_id,
          content.type === 'movie' ? 'movie' : 'tv'
        );
        tmdb_providers = (details.providers || []).map(p => {
          const site = db.prepare(
            'SELECT * FROM sites WHERE LOWER(name) LIKE ?'
          ).get(`%${p.provider_name.toLowerCase()}%`);
          return { ...p, site_in_catalog: site || null };
        });
      } catch (_) {}
    }

    const crew_links = db.prepare(`
      SELECT cs.*, s.name, s.url, s.logo_url, s.category, s.quality,
             u.display_name as added_by_name, u.avatar_color
      FROM content_services cs
      JOIN sites s ON cs.site_id = s.id
      LEFT JOIN users u ON cs.added_by = u.id
      WHERE cs.content_id = ?
    `).all(id);

    // Enrich each provider/link with a deep-link search URL + DRM flag
    tmdb_providers = tmdb_providers.map(p => {
      const site = p.site_in_catalog;
      const name = p.provider_name;
      const homepage = site?.url || null;
      return {
        ...p,
        deep_link: deepLinkFor(name, homepage, content.title),
        requires_drm: requiresDrm(name)
      };
    });
    const crew_links_enriched = crew_links.map(l => ({
      ...l,
      deep_link: l.direct_url || deepLinkFor(l.name, l.url, content.title),
      requires_drm: requiresDrm(l.name)
    }));

    // Build a "search these sites for this title" list —
    // every catalog site with a search_url_template that isn't already
    // represented in TMDB providers or crew links.
    const allSites = db.prepare(`
      SELECT * FROM sites WHERE search_url_template IS NOT NULL
      ORDER BY upvotes DESC, name ASC
    `).all();
    const coveredSiteIds = new Set([
      ...tmdb_providers.map(p => p.site_in_catalog?.id).filter(Boolean),
      ...crew_links_enriched.map(l => l.site_id)
    ]);
    const searchable = allSites
      .filter(s => !coveredSiteIds.has(s.id))
      .map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        logo_url: s.logo_url,
        category: s.category,
        quality: s.quality,
        is_free: s.is_free,
        requires_vpn: s.requires_vpn,
        search_url: (s.search_url_template || '').replace('{title}', encodeURIComponent(content.title)),
        requires_drm: requiresDrm(s.name)
      }));

    res.json({
      tmdb_providers,
      crew_links: crew_links_enriched,
      search_sites: searchable,
      title: content.title
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/content/:id/link-service
router.post('/content/:id/link-service', (req, res) => {
  try {
    const { id } = req.params;
    const { site_id, direct_url, user_id } = req.body;
    const db = getDB();

    const info = db.prepare(`
      INSERT OR REPLACE INTO content_services
        (content_id, site_id, direct_url, added_by)
      VALUES (?, ?, ?, ?)
    `).run(id, site_id, direct_url || null, user_id);

    db.prepare(`
      INSERT INTO activity_feed (user_id, content_id, activity_type, metadata)
      VALUES (?, ?, 'linked_service', ?)
    `).run(user_id, id, JSON.stringify({ site_id }));

    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/content/:id/season/:n — episodes list from TMDB
const SEASON_CACHE = new Map();
const SEASON_TTL = 6 * 60 * 60 * 1000;
router.get('/content/:id/season/:n', async (req, res) => {
  try {
    const { id, n } = req.params;
    const db = getDB();
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(id);
    if (!content) return res.status(404).json({ error: 'Content not found' });
    if (!content.tmdb_id) return res.status(400).json({ error: 'No TMDB id on this content' });

    const key = `${content.tmdb_id}:${n}`;
    const cached = SEASON_CACHE.get(key);
    if (cached && Date.now() - cached.ts < SEASON_TTL) return res.json(cached.data);

    const season = await tmdb.getSeason(content.tmdb_id, parseInt(n));
    SEASON_CACHE.set(key, { ts: Date.now(), data: season });
    res.json(season);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discover/trending?type=all|tv|movie
router.get('/discover/trending', async (req, res) => {
  try {
    const { type = 'all' } = req.query;
    const results = await tmdb.trending('week', type);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discover/service/:siteId?type=tv|movie
router.get('/discover/service/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { type = 'tv' } = req.query;
    const db = getDB();
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const providerId = tmdb.getProviderIdForSite(site.name);
    if (!providerId) {
      return res.json({ site, provider_id: null, results: [], unsupported: true });
    }
    const results = await tmdb.discoverByProvider(providerId, type);
    res.json({ site, provider_id: providerId, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discover/all?type=tv|movie
// Bulk: fetches popular for every catalog site that has a TMDB provider mapping.
router.get('/discover/all', async (req, res) => {
  try {
    const { type = 'tv' } = req.query;
    const sites = getDB().prepare(
      `SELECT * FROM sites WHERE category IN ('streaming','anime') ORDER BY upvotes DESC, name ASC`
    ).all();

    const rows = [];
    for (const site of sites) {
      const providerId = tmdb.getProviderIdForSite(site.name);
      if (!providerId) continue;
      try {
        const results = await tmdb.discoverByProvider(providerId, type);
        if (results.length) rows.push({ site, provider_id: providerId, results: results.slice(0, 20) });
      } catch (_) { /* skip failed provider */ }
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Simple in-memory cache. 24h TTL — availability doesn't churn hourly.
const SCRAPE_CACHE = new Map();
const SCRAPE_TTL = 24 * 60 * 60 * 1000;

// GET /api/scrape/availability/:contentId
// Local resolver — runs in-app per user. Anime uses AniList IDs to
// build direct URLs on Miruro/Anify. Movies + TV scrape FlixHQ + SFlix
// search pages. Cached for 1h per content.
router.get('/scrape/availability/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    const { user_id, season, episode } = req.query;
    const cacheKey = `${contentId}:${user_id || 'anon'}:${season || ''}:${episode || ''}`;
    const cached = SCRAPE_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.ts < SCRAPE_TTL) {
      return res.json({ ...cached.data, cached: true });
    }
    const payload = await scrapers.resolveAvailability(contentId, {
      userId: user_id ? parseInt(user_id) : undefined,
      season: season ? parseInt(season) : undefined,
      episode: episode ? parseInt(episode) : undefined
    });
    SCRAPE_CACHE.set(cacheKey, { ts: Date.now(), data: payload });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/scrape/clear-cache', (req, res) => {
  SCRAPE_CACHE.clear();
  res.json({ ok: true });
});

// POST /api/scrape/hide — hide a bad result for a specific show
router.post('/scrape/hide', (req, res) => {
  try {
    const { content_id, provider, site_url, user_id } = req.body;
    if (!content_id || !site_url) return res.status(400).json({ error: 'content_id and site_url required' });
    getDB().prepare(`
      INSERT OR IGNORE INTO scrape_blacklist (content_id, provider, site_url, user_id)
      VALUES (?, ?, ?, ?)
    `).run(content_id, provider || '', site_url, user_id || null);
    SCRAPE_CACHE.delete(String(content_id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/scrape/unhide', (req, res) => {
  try {
    const { content_id, site_url } = req.body;
    getDB().prepare('DELETE FROM scrape_blacklist WHERE content_id = ? AND site_url = ?').run(content_id, site_url);
    SCRAPE_CACHE.delete(String(content_id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resume position endpoints
router.post('/watchlist/:id/position', (req, res) => {
  try {
    const { id } = req.params;
    const { position, duration, site_url } = req.body;
    getDB().prepare(`
      UPDATE watchlist SET
        last_position_seconds = ?,
        last_duration_seconds = ?,
        last_site_url = COALESCE(?, last_site_url),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(position || 0, duration || 0, site_url || null, id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Position by (user, content) — what the Player queries on open
router.get('/watchlist/position/:userId/:contentId', (req, res) => {
  const row = getDB().prepare(
    'SELECT last_position_seconds, last_duration_seconds, last_site_url FROM watchlist WHERE user_id = ? AND content_id = ?'
  ).get(req.params.userId, req.params.contentId);
  res.json(row || { last_position_seconds: 0, last_duration_seconds: 0, last_site_url: null });
});

module.exports = router;

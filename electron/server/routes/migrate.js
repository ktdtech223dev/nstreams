/**
 * Data migration endpoints — export local DB, import into cloud DB.
 *
 * GET  /api/migrate/export  — dump all content + watchlist + progress + activity
 * POST /api/migrate/import  — upsert that dump into this DB (cloud or local)
 *
 * Content is keyed by tmdb_id, mal_id, OR anilist_id — whichever is available.
 * This ensures MAL-imported anime (no tmdb_id) migrate correctly.
 */
const { Router } = require('express');
const { getDB }  = require('../database');

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

// Returns the canonical lookup key for a content row using whichever ID is set.
function contentKey(row) {
  if (row.tmdb_id)    return `tmdb:${row.tmdb_id}:${row.type}`;
  if (row.mal_id)     return `mal:${row.mal_id}:${row.type}`;
  if (row.anilist_id) return `anilist:${row.anilist_id}:${row.type}`;
  return null;
}

// Build a map of { key → local_id } from all content already in a DB.
function buildContentMap(db) {
  const map = {};
  for (const c of db.prepare('SELECT id, tmdb_id, mal_id, anilist_id, type FROM content').all()) {
    const k = contentKey(c);
    if (k) map[k] = c.id;
  }
  return map;
}

// ── Export ─────────────────────────────────────────────────────────────────────
router.get('/migrate/export', (req, res) => {
  try {
    const db = getDB();
    const users = db.prepare('SELECT * FROM users').all();
    const content = db.prepare('SELECT * FROM content').all();
    const watchlist = db.prepare(`
      SELECT w.*, u.username FROM watchlist w
      JOIN users u ON u.id = w.user_id
    `).all();
    const episodeProgress = db.prepare(`
      SELECT ep.*, u.username FROM episode_progress ep
      JOIN users u ON u.id = ep.user_id
    `).all();
    const activityFeed = db.prepare(`
      SELECT af.*, u.username FROM activity_feed af
      JOIN users u ON u.id = af.user_id
      WHERE af.created_at > datetime('now', '-90 days')
      ORDER BY af.created_at DESC
    `).all();

    res.json({ users, content, watchlist, episodeProgress, activityFeed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Import ─────────────────────────────────────────────────────────────────────
router.post('/migrate/import', (req, res) => {
  try {
    const db  = getDB();
    const { content = [], watchlist = [], episodeProgress = [], activityFeed = [] } = req.body;

    let importedContent = 0, importedWatchlist = 0, importedProgress = 0, importedActivity = 0;

    // username → id map for THIS database
    const userMap = {};
    for (const u of db.prepare('SELECT id, username FROM users').all()) {
      userMap[u.username] = u.id;
    }

    // ── Content ────────────────────────────────────────────────────────────────
    // Map of source content_id → target content_id
    // (IDs differ between local and cloud DBs — we translate via the content key)
    const srcToTargetId = {};

    const insertContent = db.prepare(`
      INSERT INTO content (
        tmdb_id, mal_id, anilist_id, title, type, poster_path, backdrop_path,
        overview, release_year, rating, genres, cast_list, total_seasons,
        total_episodes, status, is_anime, seasons
      ) VALUES (
        @tmdb_id, @mal_id, @anilist_id, @title, @type, @poster_path, @backdrop_path,
        @overview, @release_year, @rating, @genres, @cast_list, @total_seasons,
        @total_episodes, @status, @is_anime, @seasons
      )
    `);

    // Build the target DB's content map once up-front so we detect existing rows
    const targetMap = buildContentMap(db);

    // Build a quick lookup from source content.id → source row
    const srcById = {};
    for (const c of content) srcById[c.id] = c;

    const insertContentTx = db.transaction(() => {
      for (const c of content) {
        const key = contentKey(c);
        if (!key) continue; // no usable ID — skip

        if (targetMap[key] !== undefined) {
          // Already exists in target DB — just record the mapping
          srcToTargetId[c.id] = targetMap[key];
          continue;
        }

        // Insert new content row
        const info = insertContent.run({
          tmdb_id:        c.tmdb_id    || null,
          mal_id:         c.mal_id     || null,
          anilist_id:     c.anilist_id || null,
          title:          c.title,
          type:           c.type,
          poster_path:    c.poster_path    || null,
          backdrop_path:  c.backdrop_path  || null,
          overview:       c.overview       || null,
          release_year:   c.release_year   || null,
          rating:         c.rating         || null,
          genres:         c.genres         || null,
          cast_list:      c.cast_list      || null,
          total_seasons:  c.total_seasons  || null,
          total_episodes: c.total_episodes || null,
          status:         c.status         || null,
          is_anime:       c.is_anime       || 0,
          seasons:        c.seasons        || null,
        });

        const newId = info.lastInsertRowid;
        targetMap[key]   = newId;
        srcToTargetId[c.id] = newId;
        importedContent++;
      }
    });
    insertContentTx();

    // ── Watchlist ──────────────────────────────────────────────────────────────
    const upsertWatchlist = db.prepare(`
      INSERT INTO watchlist (
        user_id, content_id, watch_status, current_season, current_episode,
        total_watched_episodes, user_rating, notes, start_date, finish_date,
        source, added_at, updated_at, last_position_seconds, last_duration_seconds, last_site_url
      ) VALUES (
        @user_id, @content_id, @watch_status, @current_season, @current_episode,
        @total_watched_episodes, @user_rating, @notes, @start_date, @finish_date,
        @source, @added_at, @updated_at, @last_position_seconds, @last_duration_seconds, @last_site_url
      )
      ON CONFLICT(user_id, content_id) DO UPDATE SET
        watch_status           = excluded.watch_status,
        current_season         = excluded.current_season,
        current_episode        = excluded.current_episode,
        total_watched_episodes = excluded.total_watched_episodes,
        user_rating            = excluded.user_rating,
        notes                  = excluded.notes,
        start_date             = excluded.start_date,
        finish_date            = excluded.finish_date,
        updated_at             = excluded.updated_at,
        last_position_seconds  = excluded.last_position_seconds,
        last_duration_seconds  = excluded.last_duration_seconds,
        last_site_url          = excluded.last_site_url
    `);

    const insertWlTx = db.transaction(() => {
      for (const w of watchlist) {
        const userId    = userMap[w.username];
        if (!userId) continue;
        const contentId = srcToTargetId[w.content_id];
        if (!contentId) continue; // content had no usable ID — skip

        const info = upsertWatchlist.run({
          user_id:               userId,
          content_id:            contentId,
          watch_status:          w.watch_status          || 'plan_to_watch',
          current_season:        w.current_season        || 1,
          current_episode:       w.current_episode       || 0,
          total_watched_episodes:w.total_watched_episodes|| 0,
          user_rating:           w.user_rating           || null,
          notes:                 w.notes                 || null,
          start_date:            w.start_date            || null,
          finish_date:           w.finish_date           || null,
          source:                w.source                || 'migrate',
          added_at:              w.added_at,
          updated_at:            w.updated_at,
          last_position_seconds: w.last_position_seconds || 0,
          last_duration_seconds: w.last_duration_seconds || 0,
          last_site_url:         w.last_site_url         || null,
        });
        if (info.changes) importedWatchlist++;
      }
    });
    insertWlTx();

    // ── Episode progress ───────────────────────────────────────────────────────
    const upsertProgress = db.prepare(`
      INSERT INTO episode_progress (
        user_id, content_id, season_number, episode_number,
        last_site_url, last_provider, last_position_seconds, last_duration_seconds,
        completed, updated_at
      ) VALUES (
        @user_id, @content_id, @season_number, @episode_number,
        @last_site_url, @last_provider, @last_position_seconds, @last_duration_seconds,
        @completed, @updated_at
      )
      ON CONFLICT(user_id, content_id, season_number, episode_number) DO UPDATE SET
        last_position_seconds = excluded.last_position_seconds,
        last_duration_seconds = excluded.last_duration_seconds,
        completed             = excluded.completed,
        updated_at            = excluded.updated_at
    `);

    const insertProgressTx = db.transaction(() => {
      for (const ep of episodeProgress) {
        const userId    = userMap[ep.username];
        if (!userId) continue;
        const contentId = srcToTargetId[ep.content_id];
        if (!contentId) continue;

        const info = upsertProgress.run({
          user_id:              userId,
          content_id:           contentId,
          season_number:        ep.season_number,
          episode_number:       ep.episode_number,
          last_site_url:        ep.last_site_url   || null,
          last_provider:        ep.last_provider   || null,
          last_position_seconds:ep.last_position_seconds || 0,
          last_duration_seconds:ep.last_duration_seconds || 0,
          completed:            ep.completed        || 0,
          updated_at:           ep.updated_at,
        });
        if (info.changes) importedProgress++;
      }
    });
    insertProgressTx();

    // ── Activity feed ──────────────────────────────────────────────────────────
    const insertActivity = db.prepare(`
      INSERT OR IGNORE INTO activity_feed (user_id, content_id, activity_type, metadata, created_at)
      VALUES (@user_id, @content_id, @activity_type, @metadata, @created_at)
    `);

    const insertActivityTx = db.transaction(() => {
      for (const af of activityFeed) {
        const userId    = userMap[af.username];
        if (!userId) continue;
        const contentId = af.content_id ? srcToTargetId[af.content_id] : null;

        const info = insertActivity.run({
          user_id:       userId,
          content_id:    contentId || null,
          activity_type: af.activity_type,
          metadata:      af.metadata || null,
          created_at:    af.created_at,
        });
        if (info.changes) importedActivity++;
      }
    });
    insertActivityTx();

    res.json({
      ok: true,
      imported: {
        content:        importedContent,
        watchlist:      importedWatchlist,
        episodeProgress:importedProgress,
        activity:       importedActivity,
      },
    });
  } catch (e) {
    console.error('Migration import error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

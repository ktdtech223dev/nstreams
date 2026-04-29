/**
 * N Streams → N Games Launcher bridge
 *
 * Reports viewing milestones to the Launcher server, which broadcasts a
 * `nstreams_activity` WS event to all connected clients — including the
 * Discord bot, which then posts it to the crew's Discord channel.
 *
 * Fire-and-forget: none of this ever blocks the app or throws to callers.
 * No user configuration needed — the Launcher URL is hardcoded below.
 */

const https = require('https');
const http  = require('http');

const LAUNCHER_API = 'https://ngames-server-production.up.railway.app';

// ── Low-level POST ─────────────────────────────────────────────────────────────
function postToLauncher(path, payload) {
  try {
    const body = JSON.stringify(payload);
    const url  = new URL(`${LAUNCHER_API}${path}`);
    const mod  = url.protocol === 'https:' ? https : http;
    const req  = mod.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'NStreams/1.0',
      },
    });
    req.on('error', () => {}); // genuinely fire-and-forget
    req.write(body);
    req.end();
  } catch {
    // Malformed URL or other sync error — swallow silently
  }
}

// ── Push crew stats snapshot ──────────────────────────────────────────────────
// Called after any activity so every device sees up-to-date data on Crew page.
function pushCrewStats(db, userId) {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) return;

    // Watching / completed / plan counts
    const counts = db.prepare(`
      SELECT watch_status, COUNT(*) AS c
      FROM watchlist WHERE user_id = ? GROUP BY watch_status
    `).all(userId);
    const stats = { watching: 0, completed: 0, plan_to_watch: 0 };
    counts.forEach(r => {
      if (r.watch_status === 'watching')       stats.watching      = r.c;
      else if (r.watch_status === 'completed') stats.completed     = r.c;
      else if (r.watch_status === 'plan_to_watch') stats.plan_to_watch = r.c;
    });

    // This week (last 7 days of watching sessions)
    const thisWeek = db.prepare(`
      SELECT ws.content_id,
             c.title, c.poster_path,
             w.current_episode, w.current_season,
             MAX(ws.started_at) AS last_watched
      FROM watching_sessions ws
      JOIN content c ON ws.content_id = c.id
      LEFT JOIN watchlist w ON w.user_id = ws.user_id AND w.content_id = ws.content_id
      WHERE ws.user_id = ? AND ws.started_at > datetime('now', '-7 days')
      GROUP BY ws.content_id
      ORDER BY last_watched DESC LIMIT 5
    `).all(userId);

    // Recently completed (last 3)
    const recentCompleted = db.prepare(`
      SELECT w.content_id, c.title, w.user_rating
      FROM watchlist w JOIN content c ON w.content_id = c.id
      WHERE w.user_id = ? AND w.watch_status = 'completed'
      ORDER BY w.updated_at DESC LIMIT 3
    `).all(userId);

    postToLauncher(`/nstreams/crew/${encodeURIComponent(user.username)}`, {
      display_name:     user.display_name,
      avatar_color:     user.avatar_color,
      watching:         stats.watching,
      completed:        stats.completed,
      plan_to_watch:    stats.plan_to_watch,
      this_week:        thisWeek.map(r => ({
        content_id:      r.content_id,
        title:           r.title,
        poster_path:     r.poster_path,
        current_episode: r.current_episode || 0,
        current_season:  r.current_season  || 1,
      })),
      recent_completed: recentCompleted.map(r => ({
        content_id:  r.content_id,
        title:       r.title,
        user_rating: r.user_rating,
      })),
    });
  } catch (e) {
    console.error('[nstreams-crew-push] error:', e.message);
  }
}

// ── Main dispatcher ────────────────────────────────────────────────────────────
/**
 * Called right after an activity_feed INSERT. Decides whether the event
 * merits a Discord notification and, if so, sends it to the Launcher.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {'started_watching'|'finished_episode'|'completed'|'rated'} eventType
 * @param {number} userId
 * @param {number} contentId
 * @param {object} meta  — event-specific data already computed by the caller
 *   started_watching : {}
 *   finished_episode : { episode, season }   (after increment)
 *   completed        : { title }
 *   rated            : { rating }
 */
function maybeFireDiscord(db, eventType, userId, contentId, meta = {}) {
  try {
    const content = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
    const user    = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!content || !user) return;

    const userName      = user.display_name || user.username || `User ${userId}`;
    const contentTitle  = content.title || 'Unknown';
    const contentType   = content.type  || 'tv';
    const posterPath    = content.poster_path   || null;
    const totalEpisodes = content.total_episodes || null;

    // ── started_watching — only announce the very first session ───────────────
    if (eventType === 'started_watching') {
      const row = db.prepare(
        'SELECT COUNT(*) AS n FROM watching_sessions WHERE user_id = ? AND content_id = ?'
      ).get(userId, contentId);
      if ((row?.n || 0) !== 1) return; // already watched before

      postToLauncher('/nstreams/activity', {
        event_type:    'started_watching',
        user_name:     userName,
        content_title: contentTitle,
        content_type:  contentType,
        poster_path:   posterPath,
        release_year:  content.release_year || null,
      });
    }

    // ── finished_episode — only fire on season finales ────────────────────────
    else if (eventType === 'finished_episode') {
      const { episode, season } = meta;
      if (!episode || !season) return;

      let seasonEpCount = null;
      if (content.seasons) {
        try {
          const seasons = typeof content.seasons === 'string'
            ? JSON.parse(content.seasons)
            : content.seasons;
          const sd = (seasons || []).find(s => s.season_number === season);
          if (sd) seasonEpCount = sd.episode_count;
        } catch {}
      }

      // If we can't determine the season length, skip silently
      if (!seasonEpCount) return;
      // episode = newEp already incremented; skip if not the last ep of the season
      if (episode < seasonEpCount) return;

      postToLauncher('/nstreams/activity', {
        event_type:    'season_finale',
        user_name:     userName,
        content_title: contentTitle,
        content_type:  contentType,
        poster_path:   posterPath,
        season,
      });
    }

    // ── completed — always announce ───────────────────────────────────────────
    else if (eventType === 'completed') {
      postToLauncher('/nstreams/activity', {
        event_type:     'completed',
        user_name:      userName,
        content_title:  contentTitle,
        content_type:   contentType,
        poster_path:    posterPath,
        total_episodes: totalEpisodes,
      });
    }

    // ── rated — always announce ───────────────────────────────────────────────
    else if (eventType === 'rated') {
      const { rating } = meta;
      if (rating == null) return;

      postToLauncher('/nstreams/activity', {
        event_type:    'rated',
        user_name:     userName,
        content_title: contentTitle,
        content_type:  contentType,
        poster_path:   posterPath,
        rating,
      });
    }
  } catch (e) {
    // Never let a reporting error bubble up to the route
    console.error('[nstreams-discord] error:', e.message);
  }
}

module.exports = { maybeFireDiscord, pushCrewStats };

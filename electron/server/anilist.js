const axios = require('axios');
const Store = require('electron-store');
const store = new Store();
const { getDB } = require('./database');

const AL_BASE = 'https://graphql.anilist.co';
const AL_AUTH = 'https://anilist.co/api/v2/oauth';

function getAuthUrl() {
  const clientId = store.get('anilist_client_id') || '';
  return `${AL_AUTH}/authorize?client_id=${clientId}&response_type=token`;
}

async function fetchAniListUser(token) {
  const res = await axios.post(
    AL_BASE,
    {
      query: `query {
        Viewer {
          id
          name
          avatar { medium }
        }
      }`
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data.Viewer;
}

async function fetchAniListList(anilistUserId, token) {
  const res = await axios.post(
    AL_BASE,
    {
      query: `query ($userId: Int) {
        MediaListCollection(userId: $userId, type: ANIME) {
          lists {
            name
            status
            entries {
              mediaId
              status
              score
              progress
              startedAt { year month day }
              completedAt { year month day }
              media {
                id
                title { english romaji }
                episodes
                coverImage { medium }
                description
                genres
                meanScore
                status
                startDate { year }
              }
            }
          }
        }
      }`,
      variables: { userId: anilistUserId }
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return res.data.data.MediaListCollection.lists.flatMap(l => l.entries);
}

function mapAniListStatus(status) {
  const map = {
    CURRENT: 'watching',
    COMPLETED: 'completed',
    PAUSED: 'on_hold',
    DROPPED: 'dropped',
    PLANNING: 'plan_to_watch',
    REPEATING: 'watching'
  };
  return map[status] || 'plan_to_watch';
}

async function syncAniListList(userId) {
  const db = getDB();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user?.anilist_access_token) throw new Error('ANILIST_NOT_CONNECTED');

  const entries = await fetchAniListList(user.anilist_user_id, user.anilist_access_token);

  let imported = 0;
  let updated = 0;

  for (const entry of entries) {
    const media = entry.media;
    const title = media.title.english || media.title.romaji;

    let content = db.prepare('SELECT * FROM content WHERE anilist_id = ?').get(media.id);

    if (!content) {
      db.prepare(`
        INSERT OR IGNORE INTO content
          (anilist_id, title, type, poster_path, overview,
           total_episodes, rating, release_year, genres, is_anime)
        VALUES (?, ?, 'anime', ?, ?, ?, ?, ?, ?, 1)
      `).run(
        media.id,
        title,
        media.coverImage?.medium || null,
        media.description ? media.description.replace(/<[^>]*>/g, '') : null,
        media.episodes || null,
        media.meanScore ? media.meanScore / 10 : null,
        media.startDate?.year || null,
        JSON.stringify(media.genres || [])
      );
      content = db.prepare('SELECT * FROM content WHERE anilist_id = ?').get(media.id);
    }

    const existing = db.prepare(
      'SELECT * FROM watchlist WHERE user_id = ? AND content_id = ?'
    ).get(userId, content.id);

    if (existing) {
      db.prepare(`
        UPDATE watchlist SET
          watch_status = ?,
          current_episode = ?,
          total_watched_episodes = ?,
          user_rating = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND content_id = ?
      `).run(
        mapAniListStatus(entry.status),
        entry.progress || 0,
        entry.progress || 0,
        entry.score || null,
        userId,
        content.id
      );
      updated++;
    } else {
      db.prepare(`
        INSERT INTO watchlist
          (user_id, content_id, watch_status, current_episode,
           total_watched_episodes, user_rating, source)
        VALUES (?, ?, ?, ?, ?, ?, 'anilist')
      `).run(
        userId,
        content.id,
        mapAniListStatus(entry.status),
        entry.progress || 0,
        entry.progress || 0,
        entry.score || null
      );
      imported++;
    }
  }

  db.prepare('UPDATE users SET last_anilist_sync = ? WHERE id = ?')
    .run(new Date().toISOString(), userId);

  return { imported, updated, total: entries.length };
}

module.exports = { getAuthUrl, syncAniListList, fetchAniListUser };

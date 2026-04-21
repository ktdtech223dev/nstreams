const axios = require('axios');
const crypto = require('crypto');
const Store = require('electron-store');
const store = new Store();
const { getDB } = require('./database');
const { malRedirectUri } = require('../oauth');

const MAL_BASE = 'https://api.myanimelist.net/v2';
const MAL_AUTH = 'https://myanimelist.net/v1/oauth2';

// MAL's PKCE implementation only supports code_challenge_method=plain.
// The challenge must equal the verifier as-is (no SHA-256 hashing).
// This is a MAL-specific quirk — standard OAuth 2.0 recommends S256,
// but MAL rejects S256 challenges with a generic "redirect URI" error
// at token exchange that is incredibly misleading.
// Per MAL API v2 docs: "code_challenge_method: Only 'plain' is supported."
function generateVerifier() {
  // PKCE verifier must be 43–128 chars of [A-Z a-z 0-9 . _ ~ -]
  return crypto.randomBytes(48).toString('base64url').slice(0, 64);
}

function getAuthUrl(userId) {
  const clientId = store.get('mal_client_id');
  if (!clientId || !clientId.trim()) {
    throw new Error(
      'MAL_CLIENT_ID_MISSING: Save your MAL Client ID in Settings before connecting. ' +
      'Get one free at myanimelist.net/apiconfig'
    );
  }

  const verifier = generateVerifier();
  store.set(`mal_verifier_${userId}`, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId.trim(),
    code_challenge: verifier,          // plain method: challenge = verifier
    code_challenge_method: 'plain',    // MAL only supports plain
    redirect_uri: malRedirectUri()
  });
  return `${MAL_AUTH}/authorize?${params}`;
}

async function exchangeCode(code, userId) {
  const verifier = store.get(`mal_verifier_${userId}`);
  const clientId = store.get('mal_client_id');
  const clientSecret = store.get('mal_client_secret');

  if (!clientId) throw new Error('MAL_CLIENT_ID_MISSING');
  if (!verifier) {
    throw new Error(
      'MAL_VERIFIER_LOST: Auth session expired (did you restart the app mid-OAuth?). ' +
      'Click Connect MAL again.'
    );
  }

  // Build token request. Client Secret is REQUIRED for "Web" app type
  // and NOT ISSUED for "Other" app type. Include it only if saved.
  const body = {
    client_id: String(clientId).trim(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: malRedirectUri(),
    code_verifier: verifier
  };
  if (clientSecret && String(clientSecret).trim()) {
    body.client_secret = String(clientSecret).trim();
  }

  let res;
  try {
    res = await axios.post(
      `${MAL_AUTH}/token`,
      new URLSearchParams(body),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
  } catch (e) {
    const body = e.response?.data;
    const err = body?.error || '';
    const desc = body?.error_description || body?.message || '';
    let hint = '';
    if (/redirect|invalid_grant/i.test(err + ' ' + desc)) {
      hint = ` — Open myanimelist.net/apiconfig → your N Streams app → check App Redirect URL is EXACTLY: ${malRedirectUri()} (copy from Settings).`;
    } else if (/invalid_client|client/i.test(err)) {
      hint = ` — Check Client ID and Client Secret in Settings match your MAL app.`;
    } else if (/expired|used/i.test(desc)) {
      hint = ` — Authorization codes expire in 10 min and are single-use. Click Connect MAL again.`;
    }
    throw new Error(
      `MAL token exchange failed (${e.response?.status || '?'}): ${desc || err || e.message}${hint}`
    );
  }

  const db = getDB();
  db.prepare(`
    UPDATE users SET
      mal_access_token = ?,
      mal_refresh_token = ?,
      mal_token_expires = ?
    WHERE id = ?
  `).run(
    res.data.access_token,
    res.data.refresh_token,
    Date.now() + res.data.expires_in * 1000,
    userId
  );

  const profile = await getMalProfile(userId);
  db.prepare('UPDATE users SET mal_username = ? WHERE id = ?').run(profile.name, userId);
  store.delete(`mal_verifier_${userId}`);
  return profile;
}

async function getMalProfile(userId) {
  const token = getToken(userId);
  const res = await axios.get(`${MAL_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

async function fetchMALList(userId) {
  const token = getToken(userId);
  let all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const res = await axios.get(`${MAL_BASE}/users/@me/animelist`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        fields: 'list_status,num_episodes,start_date,end_date,mean,genres,pictures,synopsis',
        limit,
        offset,
        sort: 'list_score'
      }
    });
    all = all.concat(res.data.data);
    if (!res.data.paging?.next) break;
    offset += limit;
  }
  return all;
}

function mapMALStatus(malStatus) {
  const map = {
    watching: 'watching',
    completed: 'completed',
    on_hold: 'on_hold',
    dropped: 'dropped',
    plan_to_watch: 'plan_to_watch'
  };
  return map[malStatus] || 'plan_to_watch';
}

async function syncMALList(userId) {
  const db = getDB();
  const malList = await fetchMALList(userId);
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of malList) {
    const anime = item.node;
    const listStatus = item.list_status;

    let content = db.prepare('SELECT * FROM content WHERE mal_id = ?').get(anime.id);

    if (!content) {
      // Resolve the AniList id at import time so scrapers + episode
      // tracker have it immediately. Best-effort: if AniList is slow
      // we fall back to the one-shot backfill on first modal open.
      let anilistId = null;
      try {
        const { resolveAnilistId } = require('./scrapers');
        anilistId = await resolveAnilistId({ title: anime.title, mal_id: anime.id });
      } catch (_) {}

      db.prepare(`
        INSERT OR IGNORE INTO content
          (mal_id, anilist_id, title, type, poster_path, overview, total_episodes, is_anime)
        VALUES (?, ?, ?, 'anime', ?, ?, ?, 1)
      `).run(
        anime.id,
        anilistId,
        anime.title,
        anime.main_picture?.medium || null,
        anime.synopsis || null,
        anime.num_episodes || null
      );
      content = db.prepare('SELECT * FROM content WHERE mal_id = ?').get(anime.id);
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
        mapMALStatus(listStatus.status),
        listStatus.num_episodes_watched || 0,
        listStatus.num_episodes_watched || 0,
        listStatus.score ? Math.round(listStatus.score) : null,
        userId,
        content.id
      );
      updated++;
    } else {
      db.prepare(`
        INSERT INTO watchlist
          (user_id, content_id, watch_status, current_episode,
           total_watched_episodes, user_rating, source)
        VALUES (?, ?, ?, ?, ?, ?, 'mal')
      `).run(
        userId,
        content.id,
        mapMALStatus(listStatus.status),
        listStatus.num_episodes_watched || 0,
        listStatus.num_episodes_watched || 0,
        listStatus.score ? Math.round(listStatus.score) : null
      );
      imported++;
    }
  }

  db.prepare('UPDATE users SET last_mal_sync = ? WHERE id = ?')
    .run(new Date().toISOString(), userId);

  return { imported, updated, skipped, total: malList.length };
}

function getToken(userId) {
  const user = getDB().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user?.mal_access_token) throw new Error('MAL_NOT_CONNECTED');
  return user.mal_access_token;
}

module.exports = { getAuthUrl, exchangeCode, syncMALList, getMalProfile };

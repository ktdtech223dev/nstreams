// Local availability resolver — runs on each user's machine, not on a
// central server. Legally equivalent to the user visiting the sites
// themselves, which is the pattern that survived the March 2026 DMCA
// wave that wiped out every hosted scraper API.
//
// Three strategies depending on site:
//   • AniList-ID-based (Miruro, as separate Sub and Dub rows) — resolve
//     the AniList entry for the exact season/episode via AniList's public
//     GraphQL, then build a deep link the player resolves in-browser.
//   • TMDB-ID-based embed aggregators (VidSrc, Embed.su, 2Embed) —
//     grouped as a single "Embed Players" card in the UI since users
//     care that *one* works, not which. No scraping; just URL templates.
//   • HTML-scraped (FlixHQ, SFlix) — fetch their search page and parse
//     with cheerio, fuzzy-match title with year + media-type filters.

const axios = require('axios');
const cheerio = require('cheerio');
const { getDB } = require('./database');
const tmdb = require('./tmdb');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' };

// Embed aggregators rotate domains monthly — keep every URL here so
// rotations are a one-line edit.
const PROVIDERS = {
  // Miruro keys shows by opaque catalog ids (/watch/<32 chars>?ep=N) that
  // only its own pages can look up — the catalog API is Cloudflare-gated
  // against non-browser clients, so the server can't resolve them. We emit
  // a search URL carrying the AniList id, episode and audio track in the
  // fragment instead; the desktop player (electron/miruro-link.js) and the
  // Android app resolve it inside a real browser and preselect the audio.
  // Anything that can't resolve it still lands on Miruro's search results.
  // (Anify, AllAnime and AniPlay were removed in v1.3.13: the first two are
  // dead and aniplaynow.live now redirects to an adult site.)
  miruro: (aid, { title = '', episode = 1, audio = 'sub' } = {}) =>
    `https://www.miruro.tv/search?query=${encodeURIComponent(title)}` +
    `#nstreams-anilist=${aid}&ep=${episode}&audio=${audio}`,

  // TMDB-ID movie + TV embed aggregators
  vidsrc:   {
    movie: (tid)              => `https://vidsrc.to/embed/movie/${tid}`,
    tv:    (tid, s = 1, e = 1) => `https://vidsrc.to/embed/tv/${tid}/${s}/${e}`
  },
  embedsu:  {
    movie: (tid)              => `https://embed.su/embed/movie/${tid}`,
    tv:    (tid, s = 1, e = 1) => `https://embed.su/embed/tv/${tid}/${s}/${e}`
  },
  twoembed: {
    movie: (tid)              => `https://www.2embed.cc/embed/${tid}`,
    tv:    (tid, s = 1, e = 1) => `https://www.2embed.cc/embedtv/${tid}&s=${s}&e=${e}`
  }

  // goojara: dynamic — slug resolved at extraction time via extractors/goojara.js,
  // no static URL template. Show pages live at ww1.goojara.to/<slug> but slug is
  // looked up by walking the A-Z index per-title; episode pages live at
  // ww1.goojara.to/<episode_slug>, resolved via POST /xmre.php.
};

function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const bigrams = s => {
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = bigrams(x), B = bigrams(y);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

// If the result title contains the content's year (± 1), boost the score.
function yearBonus(contentYear, resultTitle) {
  if (!contentYear) return 0;
  const yearsInTitle = String(resultTitle || '').match(/\b(19|20)\d{2}\b/g);
  if (!yearsInTitle) return 0;
  return yearsInTitle.some(y => Math.abs(parseInt(y) - contentYear) <= 1) ? 0.15 : 0;
}

// ─── AniList resolver ────────────────────────────────────────
// Two-phase: direct idMal lookup (100% reliable for MAL-imported shows)
// first, fall back to title search only when we have no MAL id.
async function resolveAnilistId(content) {
  if (content.anilist_id) return content.anilist_id;

  // Phase 1 — direct MAL → AniList ID lookup. AniList stores idMal
  // for nearly every anime so this rarely misses.
  if (content.mal_id) {
    const directQuery = `
      query ($idMal: Int) {
        Media(idMal: $idMal, type: ANIME) {
          id
          idMal
          title { romaji english }
        }
      }`;
    try {
      const res = await axios.post(
        'https://graphql.anilist.co',
        { query: directQuery, variables: { idMal: content.mal_id } },
        { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
      );
      const m = res.data?.data?.Media;
      if (m?.id) return m.id;
    } catch (e) {
      // fall through to title search below
    }
  }

  // Phase 2 — title search fallback for content without a mal_id
  const searchQuery = `
    query ($search: String) {
      Page(perPage: 5) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          idMal
          title { romaji english native }
        }
      }
    }`;
  try {
    const res = await axios.post(
      'https://graphql.anilist.co',
      { query: searchQuery, variables: { search: content.title } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    const items = res.data?.data?.Page?.media || [];
    if (!items.length) return null;

    items.forEach(m => {
      const best = Math.max(
        similarity(content.title, m.title.english),
        similarity(content.title, m.title.romaji),
        similarity(content.title, m.title.native)
      );
      m._score = best;
    });
    items.sort((a, b) => b._score - a._score);
    return items[0]._score >= 0.6 ? items[0].id : null;
  } catch (e) {
    return null;
  }
}

// Fetch episode-level metadata from AniList for anime without a TMDB
// match. Returns { total_episodes, episodes: [{episode_number, name,
// thumbnail, runtime}] } — shape matches tmdb.getSeason for the
// EpisodeTracker consumer.
async function fetchAnilistEpisodes(anilistId, fallbackTotal = null) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        episodes
        duration
        coverImage { medium }
        streamingEpisodes {
          title
          thumbnail
          url
          site
        }
      }
    }`;
  try {
    const res = await axios.post(
      'https://graphql.anilist.co',
      { query, variables: { id: anilistId } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    const m = res.data?.data?.Media;
    if (!m) return null;

    const total = m.episodes || fallbackTotal || 0;
    const runtime = m.duration || null;

    // Map streamingEpisodes to a lookup by parsed episode number
    const byNum = {};
    for (const se of (m.streamingEpisodes || [])) {
      // titles are usually "Episode 1 - The Beginning" or "1 - The Beginning"
      const match = (se.title || '').match(/episode\s*(\d+)|^\s*(\d+)/i);
      const num = match ? parseInt(match[1] || match[2]) : null;
      if (num) {
        byNum[num] = {
          name: (se.title || '').replace(/^episode\s*\d+\s*[-:–]\s*/i, '').replace(/^\s*\d+\s*[-:–]\s*/, '') || null,
          thumbnail: se.thumbnail || null
        };
      }
    }

    const episodes = [];
    for (let i = 1; i <= total; i++) {
      const meta = byNum[i] || {};
      episodes.push({
        id: `anilist-${anilistId}-${i}`,
        episode_number: i,
        season_number: 1,
        name: meta.name || `Episode ${i}`,
        overview: null,
        air_date: null,
        runtime,
        rating: null,
        still_path: meta.thumbnail || null,
        still_path_large: meta.thumbnail || null
      });
    }

    return {
      season_number: 1,
      name: 'Season 1',
      overview: null,
      poster_path: m.coverImage?.medium || null,
      episode_count: episodes.length,
      episodes,
      source: 'anilist'
    };
  } catch (e) {
    return null;
  }
}

// ─── TMDB season/episode → AniList entry ────────────────────
// TMDB files a franchise as one show with seasons; AniList gives every
// season (often every cour) its own entry, and anime sites key on that
// entry. So TMDB "S2E3" has to become "<season-2 entry>, episode 3".
// Relation edges alone can't find it — Edgerunners 2 hangs off season 1
// as OTHER, not SEQUEL — so we gather the franchise and match each TMDB
// season's air date to an entry's start date, then follow SEQUEL edges
// when a TMDB season runs past one entry (split cours).
const SERIES_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const FRANCHISE_RELATIONS = new Set(['SEQUEL', 'PREQUEL', 'OTHER', 'SIDE_STORY', 'PARENT']);
const FRANCHISE_TTL = 12 * 60 * 60 * 1000;
const FRANCHISE_CACHE = new Map(); // baseId -> { ts, nodes: Map<id, node> }

function anilistDate(d) {
  if (!d?.year || !d?.month) return null;
  return Date.UTC(d.year, d.month - 1, d.day || 1);
}

async function fetchFranchise(baseId) {
  const hit = FRANCHISE_CACHE.get(baseId);
  if (hit && Date.now() - hit.ts < FRANCHISE_TTL) return hit.nodes;

  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, type: ANIME) {
          id format episodes
          startDate { year month day }
          title { romaji english }
          relations { edges { relationType node { id format } } }
        }
      }
    }`;
  const nodes = new Map();
  let frontier = [baseId];
  for (let depth = 0; frontier.length && depth < 8 && nodes.size < 40; depth++) {
    const res = await axios.post(
      'https://graphql.anilist.co',
      { query, variables: { ids: frontier } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    const next = new Set();
    for (const m of res.data?.data?.Page?.media || []) {
      const edges = m.relations?.edges || [];
      nodes.set(m.id, {
        id: m.id,
        format: m.format,
        episodes: m.episodes || null,
        start: anilistDate(m.startDate),
        title: m.title?.english || m.title?.romaji || null,
        sequels: edges
          .filter(e => e.relationType === 'SEQUEL' && SERIES_FORMATS.has(e.node?.format))
          .map(e => e.node.id)
      });
      for (const e of edges) {
        const id = e.node?.id;
        if (id && !nodes.has(id) && FRANCHISE_RELATIONS.has(e.relationType) && SERIES_FORMATS.has(e.node.format)) {
          next.add(id);
        }
      }
    }
    frontier = [...next].filter(id => !nodes.has(id));
  }
  FRANCHISE_CACHE.set(baseId, { ts: Date.now(), nodes });
  return nodes;
}

// Returns { anilistId, episode, title } for a TMDB (season, episode), or
// the base entry unchanged when there's nothing to map.
async function resolveAnilistEpisode(content, baseId, season, episode) {
  const fallback = { anilistId: baseId, episode, title: content.title };
  let seasons = [];
  try { seasons = JSON.parse(content.seasons || '[]') || []; } catch {}
  // MAL/AniList-imported rows have no TMDB seasons: episodes already
  // number the AniList entry itself.
  if (!content.tmdb_id || !seasons.length) return fallback;

  let nodes;
  try { nodes = await fetchFranchise(baseId); } catch { return fallback; }
  const base = nodes.get(baseId);
  if (!base) return fallback;

  // 1. The entry the TMDB season starts on: nearest start date within
  //    ~6 weeks of the season's air date.
  let entry = null;
  const airDate = Date.parse(seasons.find(s => s.season_number === season)?.air_date || '');
  if (Number.isFinite(airDate)) {
    let best = Infinity;
    for (const n of nodes.values()) {
      if (n.start == null) continue;
      const gap = Math.abs(n.start - airDate);
      if (gap < best) { best = gap; entry = n; }
    }
    if (best > 45 * 24 * 60 * 60 * 1000) entry = null;
  }

  // 2. No usable date: count absolute episodes along the SEQUEL chain.
  let ep = episode;
  if (!entry) {
    if (season <= 1) {
      entry = base;
    } else {
      entry = base;
      ep = seasons
        .filter(s => s.season_number < season)
        .reduce((n, s) => n + (s.episode_count || 0), 0) + episode;
    }
  }

  // 3. Walk into the next cour while the episode overruns this entry.
  for (let hops = 0; entry.episodes && ep > entry.episodes && hops < 10; hops++) {
    const next = entry.sequels.map(id => nodes.get(id)).find(Boolean);
    if (!next) break;
    ep -= entry.episodes;
    entry = next;
  }
  return { anilistId: entry.id, episode: ep, title: entry.title || content.title };
}

function anilistSiteResults(target, content) {
  if (!target?.anilistId) return [];
  const base = {
    provider: 'miruro',
    title: content.title,
    image: content.poster_path,
    match_score: 100,
    category: 'anime',
    note: target.anilistId === content.anilist_id
      ? 'AniList ID match'
      : `AniList ID match · ${target.title} ep ${target.episode}`
  };
  const link = audio => PROVIDERS.miruro(target.anilistId, { title: target.title, episode: target.episode, audio });
  return [
    { ...base, provider_name: 'Miruro · Sub', audio: 'sub', site_url: link('sub') },
    { ...base, provider_name: 'Miruro · Dub', audio: 'dub', site_url: link('dub') }
  ];
}

// ─── Anime flag back-fill ───────────────────────────────────
// Rows added before v1.3.13 were flagged anime only when TMDB linked a
// MAL id, which missed shows like Edgerunners. Re-check with
// tmdb.isAnimeTmdb once per process per show, and only for rows already
// tagged Animation.
const ANIME_CHECKED = new Set();

async function backfillAnimeFlag(content) {
  if (content.is_anime === 1 || content.type === 'anime') return true;
  if (!content.tmdb_id || ANIME_CHECKED.has(content.id)) return false;
  let genres = [];
  try { genres = JSON.parse(content.genres || '[]') || []; } catch {}
  if (!genres.includes('Animation')) return false;
  ANIME_CHECKED.add(content.id);
  try {
    const data = await tmdb.getRaw(content.tmdb_id, content.type === 'movie' ? 'movie' : 'tv', 'external_ids,keywords');
    if (!tmdb.isAnimeTmdb(data)) return false;
    getDB().prepare('UPDATE content SET is_anime = 1 WHERE id = ?').run(content.id);
    content.is_anime = 1;
    return true;
  } catch {
    ANIME_CHECKED.delete(content.id); // transient — try again next time
    return false;
  }
}

// ─── TMDB-ID embed aggregators (movies + TV) ─────────────────
function embedAggregatorResult(content, season, episode) {
  if (!content.tmdb_id) return null;
  const tid = content.tmdb_id;
  const isMovie = content.type === 'movie';
  const s = isMovie ? null : (season || 1);
  const e = isMovie ? null : (episode || 1);

  const variants = [
    {
      provider: 'vidsrc',
      provider_name: 'VidSrc',
      site_url: isMovie ? PROVIDERS.vidsrc.movie(tid) : PROVIDERS.vidsrc.tv(tid, s, e)
    },
    {
      provider: 'embedsu',
      provider_name: 'Embed.su',
      site_url: isMovie ? PROVIDERS.embedsu.movie(tid) : PROVIDERS.embedsu.tv(tid, s, e)
    },
    {
      provider: 'twoembed',
      provider_name: '2Embed',
      site_url: isMovie ? PROVIDERS.twoembed.movie(tid) : PROVIDERS.twoembed.tv(tid, s, e)
    }
  ];

  return {
    provider: 'embed',
    provider_name: 'Embed Players',
    site_url: variants[0].site_url,
    variants,
    title: content.title,
    image: content.poster_path,
    match_score: 100,
    category: isMovie ? 'movie' : 'tv',
    note: `One-click player · ${isMovie ? 'Movie' : `S${s}E${e}`}`,
    is_grouped: true
  };
}

// ─── FlixHQ / SFlix (HTML scraped) ───────────────────────────
async function scrapeFlixHQ(content, base = 'https://flixhq.to') {
  const slug = encodeURIComponent(
    content.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-').toLowerCase()
  );
  const url = `${base}/search/${slug}`;
  try {
    const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
    const $ = cheerio.load(res.data);
    const items = [];
    $('a[href^="/movie/"], a[href^="/tv/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      if (!href.includes('/watch-')) return;
      const title = $a.attr('title') || $a.text().trim() || $a.find('h3,h2').first().text().trim();
      if (!title) return;
      const poster = $a.find('img').attr('data-src') || $a.find('img').attr('src');
      items.push({
        title,
        site_url: base + href,
        image: poster,
        kind: href.startsWith('/movie/') ? 'movie' : 'tv'
      });
    });

    const isSeries = content.type !== 'movie';
    const seen = new Set();
    const scored = [];
    for (const it of items) {
      if (seen.has(it.site_url)) continue;
      seen.add(it.site_url);

      // Media-type strict filter
      if (isSeries && it.kind === 'movie') continue;
      if (!isSeries && it.kind === 'tv') continue;

      const dice = similarity(content.title, it.title);
      const yb = yearBonus(content.release_year, it.title);
      const total = dice + yb;

      // Two-factor gate: raw Dice ≥ 0.5 AND combined ≥ 0.65
      if (dice < 0.5 || total < 0.65) continue;

      scored.push({ ...it, score: total, yearBonus: yb });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 3);
  } catch (e) {
    return [];
  }
}

async function flixhqResults(content) {
  const raw = await scrapeFlixHQ(content, 'https://flixhq.to');
  return raw.map(r => ({
    provider: 'flixhq',
    provider_name: 'FlixHQ',
    site_url: r.site_url,
    title: r.title,
    image: r.image,
    match_score: Math.round(r.score * 100),
    category: r.kind === 'movie' ? 'movie' : 'tv'
  }));
}

async function sflixResults(content) {
  const raw = await scrapeFlixHQ(content, 'https://sflix.to');
  return raw.map(r => ({
    provider: 'sflix',
    provider_name: 'SFlix',
    site_url: r.site_url,
    title: r.title,
    image: r.image,
    match_score: Math.round(r.score * 100),
    category: r.kind === 'movie' ? 'movie' : 'tv'
  }));
}

// goojara — dynamic slug lookup, no static site_url. Surfaces as a source row
// in the Kodi UI so users can pick it; the actual stream URL is resolved
// server-side by extractors/goojara.js when /api/stream/goojara is hit.
function goojaraResults(content) {
  const isMovie = content.type === 'movie';
  return [{
    provider: 'goojara',
    provider_name: 'Goojara',
    // No stable site_url — extractor resolves slug + hoster at stream time.
    // Leave null so the UI knows to call /api/stream/goojara instead of iframing.
    site_url: null,
    title: content.title,
    image: content.poster_path,
    match_score: 100,
    category: isMovie ? 'movie' : 'tv',
    note: 'Native extraction · slug resolved on demand'
  }];
}

// ─── Top-level resolver ─────────────────────────────────────
async function resolveAvailability(contentId, { userId, season, episode } = {}) {
  const db = getDB();
  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
  if (!content) throw new Error('Content not found');

  // Pull current episode progress for TV content
  let s = season, e = episode;
  if ((s == null || e == null) && userId) {
    const wl = db.prepare(
      'SELECT current_season, current_episode FROM watchlist WHERE user_id = ? AND content_id = ?'
    ).get(userId, contentId);
    if (wl) {
      s = s ?? wl.current_season ?? 1;
      e = e ?? wl.current_episode ?? 1;
    }
  }
  if (!s) s = 1;
  if (!e || e < 1) e = 1;

  const isAnime = await backfillAnimeFlag(content);
  const results = [];

  if (isAnime) {
    const anilistId = await resolveAnilistId(content);
    if (anilistId) {
      if (!content.anilist_id) {
        try { db.prepare('UPDATE content SET anilist_id = ? WHERE id = ?').run(anilistId, contentId); } catch {}
        content.anilist_id = anilistId;
      }
      const target = await resolveAnilistEpisode(content, anilistId, s, e);
      results.push(...anilistSiteResults(target, content));
    }
    // TMDB-backed anime keeps goojara: it's the only provider Kodi can
    // play natively, and these shows were non-anime rows until v1.3.13.
    if (content.tmdb_id) results.push(...goojaraResults(content));
  } else {
    const [flix, sflix] = await Promise.all([
      flixhqResults(content),
      sflixResults(content)
    ]);
    results.push(...flix, ...sflix);
    // goojara surfaces as a dynamic source — slug + hoster resolved at
    // stream time, no pre-flight scrape. Always include for movies + TV.
    results.push(...goojaraResults(content));
  }

  // Grouped Embed Players card — always offered for movies + TV with a TMDB ID.
  // Also included for anime as a fallback: VidSrc/Embed.su support anime via
  // TMDB IDs and use completely different CDNs than the anime-specific providers,
  // so they work even when megacloud/rabbitstream is blocked for a user.
  if (content.tmdb_id) {
    const embed = embedAggregatorResult(content, s, e);
    if (embed) {
      if (isAnime) results.push(embed); // after anime-specific sources
      else         results.unshift(embed); // before scraped results for movies/TV
    }
  }

  // Filter blacklist
  const hidden = new Set(
    db.prepare('SELECT site_url FROM scrape_blacklist WHERE content_id = ?')
      .all(contentId).map(r => r.site_url)
  );
  const filtered = results.filter(r => !hidden.has(r.site_url));

  return {
    title: content.title,
    is_anime: isAnime,
    season: s,
    episode: e,
    results: filtered
  };
}

module.exports = {
  resolveAvailability, resolveAnilistId, resolveAnilistEpisode, backfillAnimeFlag,
  fetchAnilistEpisodes, similarity, PROVIDERS
};

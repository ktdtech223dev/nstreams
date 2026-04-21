// Local availability resolver — runs on each user's machine, not on a
// central server. Legally equivalent to the user visiting the sites
// themselves, which is the pattern that survived the March 2026 DMCA
// wave that wiped out every hosted scraper API.
//
// Three strategies depending on site:
//   • AniList-ID-based (Miruro, Anify, AllAnime, AniPlay) — resolve the
//     AniList ID from our DB or via AniList's public GraphQL, then build
//     the direct URL. Zero scraping.
//   • TMDB-ID-based embed aggregators (VidSrc, Embed.su, 2Embed) —
//     grouped as a single "Embed Players" card in the UI since users
//     care that *one* works, not which. No scraping; just URL templates.
//   • HTML-scraped (FlixHQ, SFlix) — fetch their search page and parse
//     with cheerio, fuzzy-match title with year + media-type filters.

const axios = require('axios');
const cheerio = require('cheerio');
const { getDB } = require('./database');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' };

// Embed aggregators rotate domains monthly — keep every URL here so
// rotations are a one-line edit.
const PROVIDERS = {
  // AniList-ID anime sites
  miruro:    (aid)            => `https://www.miruro.tv/watch?id=${aid}`,
  anify:     (aid)            => `https://anify.eltik.cc/info/${aid}`,
  allanime:  (aid)            => `https://allanime.to/anime/${aid}`,
  aniplay:   (aid)            => `https://aniplaynow.live/anime/info/${aid}`,

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
async function resolveAnilistId(content) {
  if (content.anilist_id) return content.anilist_id;
  const query = `
    query ($search: String, $malId: Int) {
      Page(perPage: 5) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          idMal
          title { romaji english native }
          episodes
          coverImage { medium }
          startDate { year }
        }
      }
    }`;
  try {
    const res = await axios.post(
      'https://graphql.anilist.co',
      { query, variables: { search: content.title, malId: content.mal_id || null } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    const items = res.data?.data?.Page?.media || [];
    if (!items.length) return null;

    if (content.mal_id) {
      const mal = items.find(m => m.idMal === content.mal_id);
      if (mal) return mal.id;
    }
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

function anilistSiteResults(anilistId, content) {
  if (!anilistId) return [];
  const base = {
    title: content.title,
    image: content.poster_path,
    match_score: 100,
    category: 'anime',
    note: 'AniList ID match'
  };
  return [
    { ...base, provider: 'miruro',   provider_name: 'Miruro',   site_url: PROVIDERS.miruro(anilistId)   },
    { ...base, provider: 'anify',    provider_name: 'Anify',    site_url: PROVIDERS.anify(anilistId)    },
    { ...base, provider: 'allanime', provider_name: 'AllAnime', site_url: PROVIDERS.allanime(anilistId) },
    { ...base, provider: 'aniplay',  provider_name: 'AniPlay',  site_url: PROVIDERS.aniplay(anilistId)  }
  ];
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

  const isAnime = content.is_anime === 1 || content.type === 'anime';
  const results = [];

  if (isAnime) {
    const anilistId = await resolveAnilistId(content);
    if (anilistId) {
      if (!content.anilist_id) {
        try { db.prepare('UPDATE content SET anilist_id = ? WHERE id = ?').run(anilistId, contentId); } catch {}
      }
      results.push(...anilistSiteResults(anilistId, content));
    }
  } else {
    const [flix, sflix] = await Promise.all([
      flixhqResults(content),
      sflixResults(content)
    ]);
    results.push(...flix, ...sflix);
  }

  // Grouped Embed Players card — always offered for movies + TV with a TMDB ID
  if (!isAnime && content.tmdb_id) {
    const embed = embedAggregatorResult(content, s, e);
    if (embed) results.unshift(embed);
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
  resolveAvailability, resolveAnilistId, similarity, PROVIDERS
};

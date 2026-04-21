// Local availability resolver — runs on each user's machine, not on a
// central server. Legally equivalent to the user visiting the sites
// themselves, which is the pattern that survived the March 2026 DMCA
// wave that wiped out every hosted scraper API (Consumet, aniwatch-api,
// etc.).
//
// Two strategies depending on site:
//   • AniList-based sites (Miruro, Anify, others) — resolve the AniList
//     ID from our DB or via AniList's public GraphQL, then build the
//     direct URL. Zero scraping.
//   • HTML-scraped sites (FlixHQ, SFlix) — fetch their search page,
//     parse results with cheerio.

const axios = require('axios');
const cheerio = require('cheerio');
const { getDB } = require('./database');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' };

function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  // Dice coefficient on char bigrams
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

// ─── AniList resolver ────────────────────────────────────────
async function resolveAnilistId(content) {
  if (content.anilist_id) return content.anilist_id;
  // Already have MAL ID? Use it as a hint.
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

    // Prefer exact MAL match, then best title similarity
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

// Build results for AniList-based sites once we have the ID
function anilistSiteResults(anilistId, content) {
  if (!anilistId) return [];
  return [
    {
      provider: 'miruro',
      provider_name: 'Miruro',
      site_url: `https://www.miruro.tv/watch?id=${anilistId}`,
      title: content.title,
      image: content.poster_path,
      match_score: 100,
      category: 'anime',
      note: 'AniList ID match — exact'
    },
    {
      provider: 'anify',
      provider_name: 'Anify',
      site_url: `https://anify.eltik.cc/info/${anilistId}`,
      title: content.title,
      image: content.poster_path,
      match_score: 100,
      category: 'anime'
    }
  ];
}

// ─── FlixHQ scraper (also works for SFlix, same engine) ─────
async function scrapeFlixHQ(content, base = 'https://flixhq.to') {
  const slug = encodeURIComponent(content.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '-').toLowerCase());
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
    // Dedupe + score
    const seen = new Set();
    const scored = [];
    for (const it of items) {
      if (seen.has(it.site_url)) continue;
      seen.add(it.site_url);
      const s = similarity(content.title, it.title);
      if (s >= 0.5) scored.push({ ...it, score: s });
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
async function resolveAvailability(contentId) {
  const db = getDB();
  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
  if (!content) throw new Error('Content not found');

  const isAnime = content.is_anime === 1 || content.type === 'anime';
  const results = [];

  if (isAnime) {
    const anilistId = await resolveAnilistId(content);
    if (anilistId) {
      // Cache it back to DB for next time
      if (!content.anilist_id) {
        try { db.prepare('UPDATE content SET anilist_id = ? WHERE id = ?').run(anilistId, contentId); } catch {}
      }
      results.push(...anilistSiteResults(anilistId, content));
    }
  } else {
    // Movies / TV → FlixHQ and SFlix in parallel
    const [flix, sflix] = await Promise.all([
      flixhqResults(content),
      sflixResults(content)
    ]);
    results.push(...flix, ...sflix);
  }

  return {
    title: content.title,
    is_anime: isAnime,
    results
  };
}

module.exports = { resolveAvailability, resolveAnilistId, similarity };

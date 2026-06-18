// Goojara (ww1.goojara.to) extractor — TMDB title → A-Z index slug → episode
// page → /go.php redirect → real hoster URL. Two-cookie session (aGooz +
// rotating JS-set _3chk pair) gates every redirect; both are scraped from
// the latest page HTML on each call since names/values rotate per session.
// Returns an unresolved hoster URL (wootly/luluvdo/dood/streamplay/etc.) —
// the caller's ResolveURL layer handles the final m3u8 hop.

const axios = require('axios');
const cheerio = require('cheerio');
const { similarity } = require('../scrapers');

const BASE = 'https://ww1.goojara.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const TIMEOUT = 12000;
const MAX_BYTES = 10 * 1024 * 1024;
const SLUG_TTL_MS = 24 * 60 * 60 * 1000;
const AZ_TTL_MS = 24 * 60 * 60 * 1000;
const SLUG_CACHE = new Map();   // key (tmdb_id || title|year) → { slug, ts }
const AZ_INDEX   = new Map();   // letter|page → { html, ts }

// In-flight promise dedupe — concurrent /api/stream/goojara hits for the
// same show during a cache miss would otherwise BOTH spawn a full A-Z walk
// (~18 round trips), which on Railway's free tier is the difference between
// a 3-second response and a 3-minute timeout.
const SLUG_INFLIGHT = new Map();
const AZ_INFLIGHT = new Map();

// Hosts we trust ResolveURL to handle. Anything off-list gets dropped so we
// don't hand the player a redirect chain into ad-mining junk.
const ALLOWED_HOSTERS = /^(?:www\.)?(?:doodstream\.com|dood\.(?:re|la|wf|yt|so|ws|sh|pm|to|stream|watch)|luluvdo\.com|wootly\.ch|streamtape\.com|filemoon\.sx|mixdrop\.(?:co|ag|to|club|sx|ms|bz)|streamwish\.(?:com|to|site|fyi|net)|vidoza\.net|vidmoly\.me|fembed\.(?:com|net|tv)|streamplay\.to)$/i;

// Try hosters in this order — ResolveURL coverage is best for dood/luluvdo,
// wootly's a coin-flip, streamplay last because its tokens expire fastest.
const HOSTER_PREF = ['dood', 'doodstream', 'luluvdo', 'wootly', 'streamplay'];

class ExtractorError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ExtractorError';
    Object.assign(this, meta);
  }
}

// Hand-rolled cookie jar — only ever holds two cookies per session and the
// /go.php gate doesn't need anything fancier. tough-cookie isn't a dep.
function parseSetCookie(headers) {
  const raw = headers?.['set-cookie'];
  if (!raw) return {};
  const out = {};
  for (const line of (Array.isArray(raw) ? raw : [raw])) {
    const m = /^([^=;\s]+)=([^;]+)/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Every page embeds: _3chk('<8hex>','<22hex>') — that pair IS the JS cookie.
function extractJsCookie(html) {
  const m = /_3chk\(['"]([a-f0-9]{8})['"],\s*['"]([a-f0-9]{22})['"]\)/.exec(html || '');
  return m ? { name: m[1], value: m[2] } : null;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchPage(url, jar, referer) {
  let res;
  try {
    res = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        ...(Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}),
        ...(referer ? { Referer: referer } : {})
      },
      timeout: TIMEOUT,
      maxContentLength: MAX_BYTES,
      maxRedirects: 5,
      validateStatus: s => s < 500
    });
  } catch (e) {
    throw new ExtractorError(`goojara fetch failed: ${e.message}`, { cause: e });
  }
  Object.assign(jar, parseSetCookie(res.headers));
  const js = extractJsCookie(res.data);
  if (js) jar[js.name] = js.value;
  return { html: res.data, status: res.status };
}

// Pull title + year out of the search-result anchor. Multiple "Boys" shows
// exist — year is the only reliable disambiguator.
function scanIndexHtml(html, title, year) {
  return scanIndexHtmlDetailed(html, title, year).slug;
}

// Same logic, exposes the best non-passing candidate too so callers can
// report what they almost matched on a miss.
function scanIndexHtmlDetailed(html, title, year) {
  const $ = cheerio.load(html || '');
  let best = { slug: null, score: 0, candidate_title: null };
  $('a[href^="https://ww1.goojara.to/"][title]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const t = $(a).attr('title') || '';
    const slugMatch = href.match(/^https:\/\/ww1\.goojara\.to\/([A-Za-z0-9]{6,8})\/?$/);
    if (!slugMatch) return;
    const titleMatch = t.match(/^(.+?)\s*\((\d{4})\)\s*$/);
    if (!titleMatch) return;
    const [, rTitle, rYear] = titleMatch;
    let score = similarity(title, rTitle);
    if (year && parseInt(rYear, 10) === parseInt(year, 10)) score += 0.25;
    if (score > best.score) best = { slug: slugMatch[1], score, candidate_title: t };
  });
  return {
    slug: best.score >= 0.75 ? best.slug : null,
    best: best.candidate_title ? { title: best.candidate_title, score: Number(best.score.toFixed(2)) } : null
  };
}

async function getAzPage(letter, page, jar) {
  const key = `${letter}|${page}`;
  const cached = AZ_INDEX.get(key);
  if (cached && Date.now() - cached.ts < AZ_TTL_MS) return cached.html;
  // Coalesce concurrent fetches for the same letter|page.
  if (AZ_INFLIGHT.has(key)) return AZ_INFLIGHT.get(key);
  const promise = (async () => {
    const url = `${BASE}/watch-series-az-${letter}${page > 1 ? `?p=${page}` : ''}`;
    const { html, status } = await fetchPage(url, jar, BASE + '/');
    if (status !== 200) return null;
    AZ_INDEX.set(key, { html, ts: Date.now() });
    return html;
  })().finally(() => AZ_INFLIGHT.delete(key));
  AZ_INFLIGHT.set(key, promise);
  return promise;
}

// Force a fresh fetch on the next call (used when downstream confirms a
// stale slug — episode page 404s, data-id missing, etc.).
function invalidateAzPage(letter, page) {
  AZ_INDEX.delete(`${letter}|${page}`);
}

async function getSlugForTitle(content, jar) {
  const title = content.title;
  const year = content.release_year || (content.release_date ? parseInt(content.release_date.slice(0, 4), 10) : null);
  if (!title) throw new ExtractorError('goojara: missing title');

  const cacheKey = content.tmdb_id ? `t:${content.tmdb_id}` : `s:${title}|${year || ''}`;
  const hit = SLUG_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < SLUG_TTL_MS) return hit.slug;

  // Coalesce concurrent lookups for the same show.
  if (SLUG_INFLIGHT.has(cacheKey)) return SLUG_INFLIGHT.get(cacheKey);

  const promise = (async () => {
    // Walk both article-letter AND first-keyword-letter (probe note:
    // "The Boys" lives under B page 5, not under T).
    const words = title.replace(/^(the|a|an)\s+/i, '').trim().split(/\s+/);
    const candidates = new Set();
    const first = title.trim().charAt(0).toUpperCase();
    const kw = words[0].charAt(0).toUpperCase();
    if (/[A-Z]/.test(first)) candidates.add(first);
    if (/[A-Z]/.test(kw)) candidates.add(kw);

    // Probe pages 1-9 of each candidate letter in parallel batches of 3.
    // Track diagnostics so the "no match" error names the actual cause
    // (Cloudflare gating short pages vs. genuine "not in catalog").
    const BATCH = 3;
    const stats = { letters_searched: [...candidates], pages_scanned: 0, pages_empty: 0, pages_short: 0, best_seen: null };
    for (const letter of candidates) {
      for (let startP = 1; startP <= 9; startP += BATCH) {
        const endP = Math.min(startP + BATCH - 1, 9);
        const pages = [];
        for (let p = startP; p <= endP; p++) pages.push(p);
        const htmls = await Promise.all(pages.map(p => getAzPage(letter, p, jar).catch(() => null)));
        let shortPageSeen = false;
        for (let i = 0; i < htmls.length; i++) {
          const html = htmls[i];
          stats.pages_scanned += 1;
          if (!html) { stats.pages_empty += 1; shortPageSeen = true; continue; }
          if (html.length < 8000) { stats.pages_short += 1; shortPageSeen = true; }
          const scan = scanIndexHtmlDetailed(html, title, year);
          if (scan.slug) {
            SLUG_CACHE.set(cacheKey, { slug: scan.slug, ts: Date.now() });
            return scan.slug;
          }
          if (scan.best && (!stats.best_seen || scan.best.score > stats.best_seen.score)) {
            stats.best_seen = scan.best;
          }
        }
        if (shortPageSeen) break;
      }
    }
    const detail = ` [searched=${stats.letters_searched.join(',')} pages=${stats.pages_scanned} empty=${stats.pages_empty} short=${stats.pages_short} best=${stats.best_seen ? JSON.stringify(stats.best_seen) : 'none'}]`;
    throw new ExtractorError(`goojara: no slug match for "${title}" (${year || '?'})${detail}`);
  })().finally(() => SLUG_INFLIGHT.delete(cacheKey));
  SLUG_INFLIGHT.set(cacheKey, promise);
  return promise;
}

// Used by extract() on downstream failure (show-page 404, data-id missing,
// /xmre.php non-200, episode not found) — if the slug rotated, retry one
// walk with the cache bypassed. Without this, a stale slug stays cached
// for the full 24h TTL.
function invalidateSlug(content) {
  const year = content.release_year || (content.release_date ? parseInt(content.release_date.slice(0, 4), 10) : null);
  const cacheKey = content.tmdb_id ? `t:${content.tmdb_id}` : `s:${content.title}|${year || ''}`;
  SLUG_CACHE.delete(cacheKey);
}

async function getEpisodeSlug(showSlug, season, episode, jar) {
  // Need the show page first — sets/refreshes cookies and exposes data-id.
  const showUrl = `${BASE}/${showSlug}`;
  const { html: showHtml, status } = await fetchPage(showUrl, jar, BASE + '/');
  if (status !== 200) throw new ExtractorError(`goojara: show page ${status}`);
  const idMatch = /data-id=["'](\d+)["']/.exec(showHtml);
  if (!idMatch) throw new ExtractorError('goojara: data-id missing on show page');
  const showId = idMatch[1];

  // POST /xmre.php for the season's episode list (reverse-ordered).
  let res;
  try {
    res = await axios.post(`${BASE}/xmre.php`, `s=${encodeURIComponent(season)}&t=${encodeURIComponent(showId)}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,*/*;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader(jar),
        'Referer': showUrl,
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: TIMEOUT,
      maxContentLength: MAX_BYTES,
      validateStatus: s => s < 500
    });
  } catch (e) {
    throw new ExtractorError(`goojara: /xmre.php failed: ${e.message}`, { cause: e });
  }
  if (res.status !== 200 || typeof res.data !== 'string') {
    throw new ExtractorError(`goojara: /xmre.php status ${res.status}`);
  }

  const $ = cheerio.load(res.data);
  const want = String(episode).padStart(2, '0');
  let epSlug = null;
  $('div.seho').each((_, el) => {
    const num = ($(el).find('span.sea').text() || '').trim();
    if (num !== want) return;
    const href = $(el).find('a[href^="/"]').first().attr('href');
    const m = href && /^\/([A-Za-z0-9]{6,8})\/?$/.exec(href);
    if (m) epSlug = m[1];
  });
  if (!epSlug) throw new ExtractorError(`goojara: S${season}E${episode} not found`);
  return epSlug;
}

// /go.php returns 302; we want the Location header, not the body.
async function resolveGoUrl(token, referer, jar) {
  let res;
  try {
    // Do NOT encodeURIComponent the token. pickHosterOrder's regex
    // `/url=([^&"']+)/` captures whatever goojara wrote into the anchor —
    // which is already URL-component-encoded by goojara. Wrapping again
    // double-encodes: a literal `+` becomes `%2B`, the server decodes to
    // ` `, every redirect 404s. The probe note ("Anchor token chars
    // include base64 + URL-safe variants — do NOT URL-encode further")
    // is the ground truth here.
    res = await axios.get(`${BASE}/go.php?url=${token}`, {
      headers: {
        'User-Agent': UA,
        'Cookie': cookieHeader(jar),
        ...(referer ? { Referer: referer } : {})
      },
      timeout: TIMEOUT,
      maxContentLength: MAX_BYTES,
      maxRedirects: 0,
      validateStatus: s => s < 500
    });
  } catch (e) {
    throw new ExtractorError(`goojara: /go.php failed: ${e.message}`, { cause: e });
  }
  if (res.status !== 302 && res.status !== 301) {
    throw new ExtractorError(`goojara: /go.php status ${res.status} (cookie gate?)`);
  }
  const loc = res.headers?.location;
  if (!loc) throw new ExtractorError('goojara: /go.php missing Location');
  return loc;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

// Tighter than just the hostname check — guards against gopher://, ftp://,
// ws://, file:///, etc. that a compromised goojara could redirect to.
function isPlayableHosterUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return ALLOWED_HOSTERS.test(parsed.hostname.toLowerCase());
}

function pickHosterOrder($) {
  // goojara emits ABSOLUTE hrefs (https://ww1.goojara.to/go.php?url=...)
  // not relative paths. `href^="/go.php?url="` matched zero anchors on
  // every real page — use `[href*=".go.php?url="]` to catch both shapes.
  // Tested on the live B-page-5 anchor for The Boys S1E1.
  const all = [];
  $('a.bcg[href*="/go.php?url="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const label = $(a).text().toLowerCase();
    const tok = /url=([^&"']+)/.exec(href);
    if (!tok) return;
    let rank = HOSTER_PREF.findIndex(h => label.includes(h));
    if (rank < 0) rank = HOSTER_PREF.length;
    all.push({ token: tok[1], label, rank });
  });
  all.sort((a, b) => a.rank - b.rank);
  return all;
}

async function extractOnce(content, season, episode) {
  const jar = {};
  // Warm the session — first GET sets aGooz + JS cookie.
  await fetchPage(BASE + '/', jar, null);

  const showSlug = await getSlugForTitle(content, jar);
  const isMovie = content.type === 'movie';

  let pageUrl, epHtml;
  if (isMovie) {
    pageUrl = `${BASE}/${showSlug}`;
    const r = await fetchPage(pageUrl, jar, BASE + '/');
    if (r.status !== 200) {
      const err = new ExtractorError(`goojara: movie page ${r.status}`);
      err.staleSlug = true;
      throw err;
    }
    epHtml = r.html;
  } else {
    let epSlug;
    try {
      epSlug = await getEpisodeSlug(showSlug, season || 1, episode || 1, jar);
    } catch (e) {
      // data-id missing / /xmre.php non-200 / episode not found all hint
      // the cached slug is stale. Mark so extract() can retry one walk.
      e.staleSlug = true;
      throw e;
    }
    pageUrl = `${BASE}/${epSlug}`;
    const r = await fetchPage(pageUrl, jar, `${BASE}/${showSlug}`);
    if (r.status !== 200) {
      const err = new ExtractorError(`goojara: episode page ${r.status}`);
      err.staleSlug = true;
      throw err;
    }
    epHtml = r.html;
  }

  const $ = cheerio.load(epHtml);
  const anchors = pickHosterOrder($);
  if (!anchors.length) throw new ExtractorError('goojara: no hoster anchors found');

  let lastErr;
  for (const { token, label } of anchors) {
    try {
      const real = await resolveGoUrl(token, pageUrl, jar);
      // Validate scheme + host together — hostname-only check would let
      // gopher://doodstream.com or javascript:doodstream.com sneak through.
      if (!isPlayableHosterUrl(real)) {
        lastErr = new ExtractorError(`goojara: rejected redirect to ${real.slice(0, 80)}`);
        continue;
      }
      return {
        stream_url: real,
        headers: { 'Referer': BASE + '/', 'User-Agent': UA },
        subtitles: [],
        hoster: label.split(/\s+/)[0] || hostOf(real),
        // Surface the episode/show page URL so the activity feed and
        // ProgressMonitor have a clean origin instead of recording the
        // resolved hoster CDN URL (with embedded headers) under site_url.
        site_url: pageUrl
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new ExtractorError('goojara: all hosters failed');
}

async function extract(content, season, episode) {
  if (!content || !content.title) {
    throw new ExtractorError('goojara: content.title required');
  }
  try {
    return await extractOnce(content, season, episode);
  } catch (e) {
    // Slug looks stale — purge the cache and retry once.
    if (e && e.staleSlug) {
      invalidateSlug(content);
      return await extractOnce(content, season, episode);
    }
    throw e;
  }
}

module.exports = { extract, ExtractorError };

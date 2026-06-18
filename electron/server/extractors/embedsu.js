// Embed.su HLS extractor — two-stage flow lifted from Gradleless/vidsrc-bypass
// (archived 2024-10-29). Stage 1 fetches the /embed/{type}/{tmdbId}/... page,
// regex-pulls window.vConfig = JSON.parse(atob(`...`)), then runs vConfig.hash
// through a 3-step deobfuscation to get the server list. Stage 2 GETs
// /api/e/{serverHash} to resolve the actual .m3u8.
//
// Returns raw HLS URL + the Referer/UA headers Kodi's inputstream.adaptive
// MUST forward on segment requests, else the CDN 403s. Caches resolved
// (serverHash → source) for 5 min since the m3u8 URLs are short-lived
// signed CDN links.

const axios = require('axios');
const { PROVIDERS } = require('../scrapers');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const TIMEOUT = 10000;
const MAX_BYTES = 10 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SERVER_PREFERENCE = ['viper', 'orbit']; // try in order; rest as fallback
const cache = new Map(); // serverHash → { source, subtitles, expires }

class ExtractorError extends Error {
  constructor(message, { fallbackToChromium = false, cause } = {}) {
    super(message);
    this.name = 'ExtractorError';
    this.fallbackToChromium = fallbackToChromium;
    if (cause) this.cause = cause;
  }
}

// vConfig.hash deobfuscation — see Gradleless/vidsrc-bypass src/embed-su.ts.
// Single character drift here (vConfig → wConfig, etc.) silently bricks the
// extractor, so wrap everything in try/catch and surface a Chromium-fallback
// signal rather than throwing raw.
function decodeServers(hash) {
  const firstDecode = Buffer.from(hash, 'base64').toString('utf8')
    .split('.').map(s => s.split('').reverse().join(''));
  const joined = firstDecode.join('').split('').reverse().join('');
  const servers = JSON.parse(Buffer.from(joined, 'base64').toString('utf8'));
  if (!Array.isArray(servers) || !servers.length) throw new Error('empty server list');
  return servers;
}

function looksLikeM3u8(url) {
  // Tight match: must be https:, must end in .m3u8 (with optional query
  // string). Permissive substring-match invites file:///, javascript:,
  // and cloud-metadata SSRF (the source field is upstream-controlled).
  if (!url || typeof url !== 'string') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  return /\.m3u8(\?|$)/i.test(parsed.pathname + parsed.search);
}

function detectCloudflareBlock(html, status) {
  if (status === 403) return true;
  if (typeof html !== 'string') return false;
  return /just a moment|cf-mitigated|challenge-platform/i.test(html);
}

async function fetchEmbedPage(content, season, episode) {
  if (!content.tmdb_id) throw new ExtractorError('embedsu requires tmdb_id');
  const isMovie = content.type === 'movie';
  const url = isMovie
    ? PROVIDERS.embedsu.movie(content.tmdb_id)
    : PROVIDERS.embedsu.tv(content.tmdb_id, season || 1, episode || 1);

  let res;
  try {
    res = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      timeout: TIMEOUT,
      maxContentLength: MAX_BYTES,
      validateStatus: s => s < 500
    });
  } catch (e) {
    throw new ExtractorError(`embed page fetch failed: ${e.message}`, { fallbackToChromium: true, cause: e });
  }
  if (detectCloudflareBlock(res.data, res.status)) {
    throw new ExtractorError('cloudflare challenge', { fallbackToChromium: true });
  }
  if (res.status !== 200) {
    throw new ExtractorError(`embed page status ${res.status}`, { fallbackToChromium: true });
  }
  return res.data;
}

function extractServers(html) {
  const m = /window\.vConfig\s*=\s*JSON\.parse\(atob\(`([^`]+?)`\)\)/.exec(html);
  if (!m) throw new ExtractorError('vConfig regex miss — site rotated', { fallbackToChromium: true });
  let vConfig;
  try {
    vConfig = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  } catch (e) {
    throw new ExtractorError('vConfig base64/JSON decode failed', { fallbackToChromium: true, cause: e });
  }
  if (!vConfig?.hash) throw new ExtractorError('vConfig.hash missing', { fallbackToChromium: true });
  try {
    return decodeServers(vConfig.hash);
  } catch (e) {
    throw new ExtractorError('server-list deobfuscation failed', { fallbackToChromium: true, cause: e });
  }
}

async function resolveServer(serverHash) {
  // serverHash comes from the base64'd, deobfuscated upstream blob —
  // unsafe to splice into a URL path raw. Restrict to the alphabet the
  // legit hashes actually use to block ../ injection and bad chars.
  if (!serverHash || typeof serverHash !== 'string' || !/^[A-Za-z0-9_-]{8,256}$/.test(serverHash)) {
    throw new ExtractorError('serverHash failed shape check');
  }
  const cached = cache.get(serverHash);
  if (cached && cached.expires > Date.now()) return cached;

  let res;
  try {
    res = await axios.get(`https://embed.su/api/e/${serverHash}`, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://embed.su/',
        'Origin': 'https://embed.su'
      },
      timeout: TIMEOUT,
      maxContentLength: MAX_BYTES,
      validateStatus: s => s < 500
    });
  } catch (e) {
    throw new ExtractorError(`/api/e fetch failed: ${e.message}`, { cause: e });
  }
  if (res.status !== 200 || !res.data?.source) {
    throw new ExtractorError(`/api/e bad response (status ${res.status})`);
  }
  const entry = {
    source: res.data.source,
    subtitles: Array.isArray(res.data.subtitles) ? res.data.subtitles : [],
    expires: Date.now() + CACHE_TTL_MS
  };
  cache.set(serverHash, entry);
  return entry;
}

async function extract(content, season, episode) {
  const html = await fetchEmbedPage(content, season, episode);
  const servers = extractServers(html);

  // Try preferred servers first, then anything else.
  const ordered = [
    ...SERVER_PREFERENCE.flatMap(name => servers.filter(s => s.name === name)),
    ...servers.filter(s => !SERVER_PREFERENCE.includes(s.name))
  ];

  let lastErr;
  for (const srv of ordered) {
    if (!srv?.hash) continue;
    try {
      const { source, subtitles } = await resolveServer(srv.hash);
      if (!looksLikeM3u8(source)) { lastErr = new ExtractorError(`non-m3u8 source from ${srv.name}`); continue; }
      return {
        stream_url: source,
        headers: { 'Referer': 'https://embed.su/', 'User-Agent': UA },
        subtitles: subtitles.map(s => ({ url: s.file, lang: s.label, label: s.label }))
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new ExtractorError('no server yielded an m3u8', { fallbackToChromium: true });
}

module.exports = { extract, ExtractorError };

// DaddyLive / DLHD (dlhd.st) extractor — live-TV IPTV over HLS.
// Four-hop chain: stream page → iframe (rotating host) → decode base64 in
// Clappr `source: window.atob('…')` → signed HLS master on a rotating CDN.
// Channels + schedule are surfaced separately so the sports route can list
// events; extract() is a channel-aware adapter for /api/stream/:provider.
//
// Ground-truth deltas vs. the upstream StepDaddyLiveHD script (probed
// 2026-07-22): the community `_base_url = "https://dlhd.dad"` is NXDOMAIN
// today — canonical is dlhd.st. daddylive.org (the classic fixture scrape)
// has been SEIZED (Operation Offsides) so listLiveEvents() reads the
// schedule JSON dlhd.st publishes for its own site instead. The legacy
// decode_bundle / auth.php / server_lookup.php dance is superseded by
// direct atob() extraction on today's Clappr embed.
//
// Every hop has a Referer/Origin lock. Hop 3 (HLS master on Varnish) will
// hard 403 with Content-Length: 0 if Referer isn't `https://{iframe_host}/`
// — the iframe host, NOT dlhd.st. Segments inherit the same lock.

const axios = require('axios');

const BASE_CANDIDATES = [
  'https://dlhd.st',
  'https://dlhd.pk',   // 301 → dlhd.st today, but keep as warm fallback
  'https://dlhd.dad',  // NXDOMAIN today; still in the upstream script so probe it last in case it comes back
  'https://dlhd.sx'
];
const STEPDADDY_SOURCE_URL = 'https://raw.githubusercontent.com/gookie-dev/StepDaddyLiveHD/master/StepDaddyLiveHD/step_daddy.py';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0';
const TIMEOUT = 12000;
const MAX_BYTES = 10 * 1024 * 1024;

const BASE_TTL_MS = 6 * 60 * 60 * 1000;
const CHANNEL_TTL_MS = 24 * 60 * 60 * 1000;
const EVENT_TTL_MS = 5 * 60 * 1000;
const STREAM_TTL_MS = 30 * 60 * 1000;
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;

let BASE_CACHE = null;               // { url, ts }
let CHANNELS_CACHE = null;           // { list, ts }
let EVENTS_CACHE = null;             // { list, ts }
const STREAM_CACHE = new Map();      // id → { payload, ts, expires_ms }

const BASE_INFLIGHT = { p: null };
const CHANNELS_INFLIGHT = { p: null };
const EVENTS_INFLIGHT = { p: null };
const STREAM_INFLIGHT = new Map();   // id → Promise

// Rotating CDN hosts we cannot enumerate; guard only against IPs,
// localhost, and RFC1918 space so a compromised iframe can't push the
// player at an internal service.
const HOSTNAME_ALLOW_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const HOSTNAME_BLOCK_RE = /^(?:localhost|.*\.local|.*\.internal|.*\.lan)$/i;
// Bare-IP private / loopback / link-local space. The (fc|fd) alternates were
// the original v1.3.7 shape — those matched ANY hostname starting with fc/fd
// (e.g. "fc-storage.example.com"), a real false-positive gate. IPv6 ULA
// (fc00::/7) contains colons which HOSTNAME_ALLOW_RE already rejects
// upstream, so IP-shape anchoring is sufficient here.
const PRIVATE_IP_RE = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.|169\.254\.|0\.|::1$)/i;

// Content-shape gates on probeCandidate — a seized-domain HTML notice or a
// domain-parking landing page will happily return 200 with >500 bytes; without
// content markers we'd cache the wrong host as "the live base" for 6h and
// every downstream call would silently fail. This is exactly what killed
// daddylive.org (Operation Offsides seizure), so we defend against a repeat.
const BASE_DEAD_MARKERS = [
  /this domain has been seized/i,
  /operation offsides/i,
  /nation.?al intellectual property rights coordination center/i,
  /parked (?:free )?(?:courtesy of|by|domain)/i,
  /buy this domain/i,
  /is (?:for sale|available for purchase)/i,
  /domain for sale/i,
  /parklogic\.com|sedoparking|bodis\.com|dan\.com/i,
];
const BASE_LIVE_MARKERS = [
  /24-7-channels/i,
  /watch\.php/i,
  /stream\/stream-/i,
  /schedule\/schedule-generated/i,
];

class ExtractorError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ExtractorError';
    Object.assign(this, meta);
  }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
async function httpGet(url, { referer, origin, ua = UA } = {}) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
        ...(referer ? { Referer: referer } : {}),
        ...(origin ? { Origin: origin } : {})
      },
      timeout: TIMEOUT,
      maxContentLength: MAX_BYTES,
      maxRedirects: 5,
      validateStatus: s => s < 500
    });
    return { status: res.status, data: res.data, headers: res.headers, finalUrl: res.request?.res?.responseUrl || url };
  } catch (e) {
    throw new ExtractorError(`daddylive fetch failed: ${url.slice(0, 80)}: ${e.message}`, { cause: e });
  }
}

function isPublicHttpsHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (HOSTNAME_BLOCK_RE.test(h)) return false;
  if (PRIVATE_IP_RE.test(h)) return false;
  // Reject bare IPv4 (would have passed HOSTNAME_ALLOW_RE if all-digit octets).
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return HOSTNAME_ALLOW_RE.test(h);
}

function validateHlsUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  return isPublicHttpsHost(parsed.hostname);
}

// ─── Base URL resolution ─────────────────────────────────────────────────────
async function probeCandidate(base) {
  try {
    const res = await httpGet(base + '/', {});
    if (res.status !== 200 || typeof res.data !== 'string' || res.data.length < 500) return false;
    // Reject seizure banners and parking pages — they answer 200 but are
    // useless for downstream calls, and caching them as "the live base"
    // bricks the extractor for the full BASE_TTL_MS.
    if (BASE_DEAD_MARKERS.some(re => re.test(res.data))) return false;
    // Require at least one live-shape marker so a random 200-with-body
    // page can't accidentally win the probe.
    if (!BASE_LIVE_MARKERS.some(re => re.test(res.data))) return false;
    return true;
  } catch { /* fallthrough */ }
  return false;
}

// Called by every downstream operation on non-200 or extractor failure so
// a mid-cycle rotation self-heals on the next request instead of returning
// broken responses for the full 6h BASE_TTL_MS.
function invalidateBase() {
  BASE_CACHE = null;
}

async function readUpstreamBase() {
  try {
    const res = await httpGet(STEPDADDY_SOURCE_URL, {});
    if (res.status !== 200 || typeof res.data !== 'string') return null;
    const m = /_base_url\s*=\s*["']([^"']+)["']/.exec(res.data);
    if (!m) return null;
    const upstream = m[1].replace(/\/+$/, '');
    if (!/^https?:\/\//.test(upstream)) return null;
    // Sanity: only accept it if it actually responds. Upstream is currently
    // pinned to dlhd.dad (NXDOMAIN) — if we blindly returned it, the whole
    // extractor would 404 for six hours.
    if (await probeCandidate(upstream)) return upstream;
    return null;
  } catch {
    return null;
  }
}

async function resolveBase() {
  if (BASE_CACHE && Date.now() - BASE_CACHE.ts < BASE_TTL_MS) return BASE_CACHE.url;
  if (BASE_INFLIGHT.p) return BASE_INFLIGHT.p;
  BASE_INFLIGHT.p = (async () => {
    for (const cand of BASE_CANDIDATES) {
      if (await probeCandidate(cand)) {
        // Cross-check with the upstream script (updates weekly-ish). If it
        // disagrees AND its declared base is live, prefer it — the community
        // catches base rotations faster than a static candidate list.
        const upstream = await readUpstreamBase();
        const winner = upstream && upstream !== cand ? upstream : cand;
        BASE_CACHE = { url: winner, ts: Date.now() };
        return winner;
      }
    }
    // Last-ditch: upstream script alone if none of our candidates responded.
    const upstream = await readUpstreamBase();
    if (upstream) {
      BASE_CACHE = { url: upstream, ts: Date.now() };
      return upstream;
    }
    throw new ExtractorError('daddylive: no live base URL (all candidates dead + upstream unresponsive)');
  })().finally(() => { BASE_INFLIGHT.p = null; });
  return BASE_INFLIGHT.p;
}

// ─── Channels (24/7) ─────────────────────────────────────────────────────────
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

async function listChannels() {
  if (CHANNELS_CACHE && Date.now() - CHANNELS_CACHE.ts < CHANNEL_TTL_MS) return CHANNELS_CACHE.list;
  if (CHANNELS_INFLIGHT.p) return CHANNELS_INFLIGHT.p;
  CHANNELS_INFLIGHT.p = (async () => {
    const base = await resolveBase();
    const res = await httpGet(`${base}/24-7-channels.php`, { referer: base + '/' });
    if (res.status !== 200 || typeof res.data !== 'string') {
      invalidateBase();
      throw new ExtractorError(`daddylive: channels list status ${res.status}`);
    }
    const re = /<a\s+class="card"\s+href="\/watch\.php\?id=(\d+)"[^>]*>\s*<div class="card__title">([\s\S]*?)<\/div>/gi;
    const list = [];
    let m;
    while ((m = re.exec(res.data)) !== null) {
      list.push({ id: m[1], name: decodeEntities(m[2]).replace(/\s+/g, ' ').trim() });
    }
    if (!list.length) throw new ExtractorError('daddylive: channels list parsed to zero rows');
    CHANNELS_CACHE = { list, ts: Date.now() };
    return list;
  })().finally(() => { CHANNELS_INFLIGHT.p = null; });
  return CHANNELS_INFLIGHT.p;
}

// ─── Live events (schedule) ──────────────────────────────────────────────────
// Task originally asked for daddylive.org fixture scraping. That domain has
// been SEIZED (Operation Offsides / NIPRCC); it returns a law-enforcement
// notice, no fixtures. dlhd.st publishes its own schedule JSON for the same
// data, so we source from there instead. Shape returned matches what the
// original scrape would have produced.
function normalizeCategoryKey(k) {
  return String(k).replace(/<\/?span[^>]*>/gi, '').trim();
}

function eventIdFor(dateKey, category, event, timeStr) {
  const s = `${dateKey}|${category}|${event}|${timeStr}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `evt_${(h >>> 0).toString(16)}`;
}

function parseKickoff(dateKey, timeStr) {
  // dateKey looks like "Thursday 20th March 2025"; timeStr like "20:30".
  const m = /^\w+\s+(\d+)(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})$/i.exec(dateKey || '');
  if (!m || !/^\d{1,2}:\d{2}$/.test(timeStr || '')) return null;
  const months = { january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11 };
  const mo = months[m[2].toLowerCase()];
  if (mo == null) return null;
  const [hh, mm] = timeStr.split(':').map(n => parseInt(n, 10));
  // Schedule times are UK GMT per the JSON's key suffix; Date.UTC is a close
  // enough approximation (DST drift up to 1h — caller shows freshness anyway).
  return Date.UTC(parseInt(m[3], 10), mo, parseInt(m[1], 10), hh, mm);
}

async function listLiveEvents() {
  if (EVENTS_CACHE && Date.now() - EVENTS_CACHE.ts < EVENT_TTL_MS) return EVENTS_CACHE.list;
  if (EVENTS_INFLIGHT.p) return EVENTS_INFLIGHT.p;
  EVENTS_INFLIGHT.p = (async () => {
    const base = await resolveBase();
    const res = await httpGet(`${base}/schedule/schedule-generated.json`, { referer: base + '/' });
    if (res.status !== 200) { invalidateBase(); throw new ExtractorError(`daddylive: schedule status ${res.status}`); }
    let json = res.data;
    if (typeof json === 'string') { try { json = JSON.parse(json); } catch { throw new ExtractorError('daddylive: schedule JSON parse failed'); } }
    if (!json || typeof json !== 'object') throw new ExtractorError('daddylive: schedule JSON empty');

    const out = [];
    for (const [dateKey, cats] of Object.entries(json)) {
      if (!cats || typeof cats !== 'object') continue;
      for (const [rawCat, events] of Object.entries(cats)) {
        if (!Array.isArray(events)) continue;
        const category = normalizeCategoryKey(rawCat);
        for (const ev of events) {
          if (!ev || typeof ev !== 'object') continue;
          const name = String(ev.event || '').trim();
          if (!name) continue;
          const time = String(ev.time || '').trim();
          const channels = [...(Array.isArray(ev.channels) ? ev.channels : []), ...(Array.isArray(ev.channels2) ? ev.channels2 : [])];
          const channel_ids = channels
            .map(c => c && (c.channel_id || c.id))
            .filter(v => v != null)
            .map(v => String(v));
          // "teams" — split "A vs B" / "A - B"; else leave null.
          const teamSplit = /^\s*(.+?)\s+(?:vs\.?|v|-)\s+(.+?)\s*$/i.exec(name);
          out.push({
            event_id: eventIdFor(dateKey, category, name, time),
            sport: category,
            event: name,
            teams: teamSplit ? [teamSplit[1], teamSplit[2]] : null,
            start_time: parseKickoff(dateKey, time),
            start_time_raw: `${dateKey} ${time} GMT`,
            channel_ids
          });
        }
      }
    }
    EVENTS_CACHE = { list: out, ts: Date.now() };
    return out;
  })().finally(() => { EVENTS_INFLIGHT.p = null; });
  return EVENTS_INFLIGHT.p;
}

// ─── Stream resolution (4-hop) ───────────────────────────────────────────────
async function resolveStreamOnce(id) {
  const base = await resolveBase();
  const streamPageUrl = `${base}/stream/stream-${id}.php`;

  // Hop 1: stream page — tolerant of missing Referer today, send it anyway.
  const hop1 = await httpGet(streamPageUrl, { referer: base + '/' });
  if (hop1.status !== 200 || typeof hop1.data !== 'string') {
    invalidateBase();
    throw new ExtractorError(`daddylive: stream page ${hop1.status} for id=${id}`);
  }
  const iframeMatch = /<iframe[^>]+src=["']([^"']+)["']/i.exec(hop1.data);
  if (!iframeMatch) throw new ExtractorError(`daddylive: no iframe on stream page id=${id}`);
  const iframeUrl = iframeMatch[1].startsWith('//') ? 'https:' + iframeMatch[1] : iframeMatch[1];
  // Refuse plaintext hops — an http:// iframe src would ship the Referer
  // + Origin in clear, and the downstream Referer lock means we can't
  // just upgrade to https without breaking the CDN check.
  if (!iframeUrl.startsWith('https://')) {
    throw new ExtractorError(`daddylive: non-https iframe rejected for id=${id}`);
  }
  const iframeHost = (() => { try { return new URL(iframeUrl).hostname; } catch { return null; } })();
  if (!iframeHost || !isPublicHttpsHost(iframeHost)) {
    throw new ExtractorError(`daddylive: rejected iframe host for id=${id}: ${iframeHost}`);
  }
  const iframeOrigin = `https://${iframeHost}`;

  // Hop 2: iframe HTML — requires Referer=stream page, Origin=base.
  const hop2 = await httpGet(iframeUrl, { referer: streamPageUrl, origin: base });
  if (hop2.status !== 200 || typeof hop2.data !== 'string') {
    throw new ExtractorError(`daddylive: iframe status ${hop2.status} for id=${id}`);
  }

  // Hop 3: pull the base64-encoded HLS URL out of the Clappr config.
  const atobMatch = /source\s*:\s*window\.atob\(\s*['"]([A-Za-z0-9+/=]+)['"]/i.exec(hop2.data);
  if (!atobMatch) throw new ExtractorError(`daddylive: atob source missing on iframe id=${id}`);
  let hlsUrl;
  try { hlsUrl = Buffer.from(atobMatch[1], 'base64').toString('utf8'); }
  catch (e) { throw new ExtractorError(`daddylive: atob decode failed id=${id}: ${e.message}`); }
  if (!validateHlsUrl(hlsUrl)) {
    throw new ExtractorError(`daddylive: HLS URL failed validation id=${id}: ${hlsUrl.slice(0, 100)}`);
  }

  // The path contains a unix-epoch expiry: /.../secure/<md5>/<epoch>/premium<id>/index.m3u8
  let expires_ms = 0;
  const tsMatch = /\/secure\/[a-f0-9]{16,}\/(\d{10})\//i.exec(hlsUrl);
  if (tsMatch) expires_ms = parseInt(tsMatch[1], 10) * 1000;

  return {
    stream_url: hlsUrl,
    headers: {
      'Referer': iframeOrigin + '/',
      'Origin': iframeOrigin,
      'User-Agent': UA
    },
    subtitles: [],
    expires: expires_ms || null,
    hoster: 'dlhd',
    site_url: streamPageUrl
  };
}

async function resolveStream(id) {
  const key = String(id);
  const cached = STREAM_CACHE.get(key);
  const now = Date.now();
  if (cached) {
    const ttlOk = now - cached.ts < STREAM_TTL_MS;
    const expiryOk = !cached.payload.expires || (cached.payload.expires - now > EXPIRY_SAFETY_MS);
    if (ttlOk && expiryOk) return cached.payload;
    STREAM_CACHE.delete(key);
  }
  if (STREAM_INFLIGHT.has(key)) return STREAM_INFLIGHT.get(key);
  const promise = (async () => {
    const payload = await resolveStreamOnce(key);
    STREAM_CACHE.set(key, { payload, ts: Date.now() });
    return payload;
  })().finally(() => STREAM_INFLIGHT.delete(key));
  STREAM_INFLIGHT.set(key, promise);
  return promise;
}

// ─── extract(): parity with other extractors ─────────────────────────────────
// content shape here: { channel_id?, tmdb_id? (used as channel id if numeric), title? }
// season/episode are ignored (live TV has neither).
function scoreName(query, name) {
  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const n = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!q || !n) return 0;
  if (n === q) return 1;
  if (n.includes(q)) return 0.85;
  const qw = new Set(q.split(' ').filter(Boolean));
  const nw = new Set(n.split(' ').filter(Boolean));
  let hit = 0;
  qw.forEach(w => { if (nw.has(w)) hit++; });
  return qw.size ? hit / qw.size * 0.75 : 0;
}

async function extract(content /* season, episode ignored */) {
  if (!content) throw new ExtractorError('daddylive: content required');
  let channelId = content.channel_id;
  if (!channelId && content.tmdb_id != null && /^\d+$/.test(String(content.tmdb_id))) {
    channelId = String(content.tmdb_id);
  }
  if (!channelId && content.title) {
    const list = await listChannels();
    let best = { id: null, score: 0, name: null };
    for (const ch of list) {
      const s = scoreName(content.title, ch.name);
      if (s > best.score) best = { id: ch.id, score: s, name: ch.name };
    }
    if (best.score < 0.5) {
      throw new ExtractorError(`daddylive: no channel match for "${content.title}" (best=${best.name || 'none'}@${best.score.toFixed(2)})`);
    }
    channelId = best.id;
  }
  if (!channelId) throw new ExtractorError('daddylive: need channel_id, numeric tmdb_id, or title');
  return resolveStream(channelId);
}

module.exports = { resolveBase, listChannels, listLiveEvents, resolveStream, extract, ExtractorError };

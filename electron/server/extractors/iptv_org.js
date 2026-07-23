// iptv-org (github.com/iptv-org/iptv) — legal FAST-channel fallback.
//
// When dlhd/daddylive is down (seizure, DNS rotation, referer-lock changes),
// we still want SOME US-relevant live sports on the grid. iptv-org publishes
// a normalized catalog of publicly-broadcast free-to-air / FAST streams that
// each channel's own owner has already made available (Samsung TV Plus, Pluto,
// LG Channels, Amagi feeds, direct network feeds, etc.). Nothing here is
// scraped from a piracy site — the catalog is a curated JSON pointing at
// player URLs the copyright holders host themselves.
//
// The catalog is 6000+ channels globally. This extractor deliberately filters
// down to the ~30 that a US NFL/NBA/UFC/F1 crew would recognize on a Sunday.
//
// Contract:
//   listChannels()  → cached [{id, name, url, headers, sport, source:'iptv-org'}]
//   resolveStream(channelId) → { stream_url, headers, ... }  (fresh; no cache)
//   ExtractorError                                            (same shape as goojara)

const axios = require('axios');

const CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json';
const STREAMS_URL  = 'https://iptv-org.github.io/api/streams.json';

const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;  // 6h — iptv-org rebuilds daily
const DEAD_TTL_MS    = 60 * 60 * 1000;      // 1h — don't hammer a dead stream
const CATALOG_TIMEOUT = 15000;              // catalog JSON is ~2MB each
const HEAD_TIMEOUT   = 10000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Reject anything served from a raw IP — those are almost always grey-market
// restreams someone stapled onto the catalog via a pull-request, not the
// broadcaster's own edge. Legal FAST feeds are always on a real hostname.
const IP_HOST_RE = /^https?:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\//i;

// The US-relevant allowlist. iptv-org's `name` field is human-readable
// ("ESPN Deportes", "NBA TV", "NFL Channel"); we match by substring so
// small name drifts don't drop a channel silently.
//
// Each row = { match: RegExp against channel.name, sport: our sport tag,
//              label: what we show in the UI, priority: sort within sport }
const ALLOW = [
  // General ESPN family (Ocho is the FAST/free "quirky sports" feed)
  { match: /^ESPN\s+Ocho\b/i,                    sport: 'multi',      label: 'ESPN Ocho',                     priority: 10 },
  { match: /^ESPN\s*(?:2|U|News|Deportes)?\s*$/i,sport: 'multi',      label: null,                            priority: 20 },

  // Basketball
  { match: /^NBA\s*TV\b/i,                       sport: 'basketball', label: 'NBA TV',                        priority: 10 },

  // Hockey
  { match: /^NHL\s+Network\b/i,                  sport: 'hockey',     label: 'NHL Network',                   priority: 10 },

  // Football (NFL Channel = the FAST NFL feed on Samsung/Pluto)
  { match: /^NFL\s+(?:Channel|Network)\b/i,      sport: 'football',   label: null,                            priority: 10 },

  // Baseball
  { match: /^MLB\s+Network\b/i,                  sport: 'baseball',   label: 'MLB Network',                   priority: 10 },

  // Soccer (CBS's free FAST feed)
  { match: /^CBS\s+Sports\s+Golazo\s+Network\b/i,sport: 'soccer',     label: 'CBS Sports Golazo Network',     priority: 10 },

  // Golf
  { match: /^PGA\s+TOUR(?:\s+Live)?\b/i,         sport: 'golf',       label: null,                            priority: 10 },

  // Tennis (International = the free feed; the paid US TC channel isn't on iptv-org)
  { match: /^Tennis\s+Channel\s+International\b/i, sport: 'tennis',   label: 'Tennis Channel International',  priority: 10 },

  // MMA / Boxing / Combat
  { match: /^DAZN\s+(?:Combat|Ringside)\b/i,     sport: 'boxing',     label: null,                            priority: 10 },
  { match: /^Fight\s+Network\b/i,                sport: 'boxing',     label: 'Fight Network',                 priority: 20 },
  { match: /^PFL\s+MMA\b/i,                      sport: 'mma',        label: 'PFL MMA',                       priority: 10 },
  { match: /^Bellator\s+MMA\b/i,                 sport: 'mma',        label: 'Bellator MMA',                  priority: 20 },
];

class ExtractorError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ExtractorError';
    Object.assign(this, meta);
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let CATALOG_CACHE = null;      // { channels: [{id,name,url,headers,sport,label,source}], ts }
let CATALOG_INFLIGHT = null;   // dedupe concurrent catalog rebuilds
const DEAD_CACHE = new Map();  // url → ts (when marked dead)

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchJson(url) {
  const res = await axios.get(url, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    timeout: CATALOG_TIMEOUT,
    // iptv-org catalogs are big; give them room without going unbounded.
    maxContentLength: 25 * 1024 * 1024,
    validateStatus: s => s < 500
  });
  if (res.status !== 200 || !Array.isArray(res.data)) {
    throw new ExtractorError(`iptv-org: ${url} → status ${res.status}`);
  }
  return res.data;
}

// HEAD is spec-optional; some Amagi/Pluto CDNs return 405 or even 400 for HEAD
// but still serve the m3u8 fine on GET. Treat those as "alive, unverifiable"
// rather than dropping the channel — false-negatives here silently strip
// legitimate feeds.
async function headCheck(url, extraHeaders) {
  try {
    const res = await axios.head(url, {
      headers: { 'User-Agent': UA, ...(extraHeaders || {}) },
      timeout: HEAD_TIMEOUT,
      maxRedirects: 3,
      validateStatus: () => true
    });
    if ([200, 206, 301, 302, 303, 304, 307, 308, 405].includes(res.status)) return true;
    return false;
  } catch (e) {
    // ECONNREFUSED / ENOTFOUND / timeout → genuinely dead.
    return false;
  }
}

// ─── Catalog build ────────────────────────────────────────────────────────────
function classify(channelName) {
  for (const rule of ALLOW) {
    if (rule.match.test(channelName)) return rule;
  }
  return null;
}

function isDead(url) {
  const ts = DEAD_CACHE.get(url);
  if (!ts) return false;
  if (Date.now() - ts > DEAD_TTL_MS) { DEAD_CACHE.delete(url); return false; }
  return true;
}

function markDead(url) {
  DEAD_CACHE.set(url, Date.now());
}

async function buildCatalog() {
  const [channels, streams] = await Promise.all([
    fetchJson(CHANNELS_URL),
    fetchJson(STREAMS_URL),
  ]);

  // Index channels by id → metadata. A channel can have multiple stream
  // entries; we pick the first live one per channel (streams.json is
  // roughly quality-ordered by iptv-org's own testing).
  const chanById = new Map();
  for (const c of channels) {
    if (!c || !c.id) continue;
    // iptv-org tags channels with categories: ['sports'] etc. Keep only
    // channels that list sports — this drops news/entertainment channels
    // that happen to share a name fragment ("NFL Films" the doc channel).
    const cats = Array.isArray(c.categories) ? c.categories : [];
    if (!cats.includes('sports')) continue;
    const rule = classify(c.name || '');
    if (!rule) continue;
    chanById.set(c.id, { meta: c, rule, streams: [] });
  }

  // Attach streams to their channel, rejecting IP-host URLs and non-http(s).
  for (const s of streams) {
    if (!s || !s.channel || !s.url) continue;
    const entry = chanById.get(s.channel);
    if (!entry) continue;
    if (typeof s.url !== 'string') continue;
    if (!/^https?:\/\//i.test(s.url)) continue;
    if (IP_HOST_RE.test(s.url)) continue;
    entry.streams.push(s);
  }

  // Verify one stream per channel with HEAD. In parallel, capped concurrency
  // so we don't fire 200 sockets at once. 8 in flight is plenty for a 30-item
  // list and stays polite.
  const candidates = [];
  for (const { meta, rule, streams: chStreams } of chanById.values()) {
    if (!chStreams.length) continue;
    const s = chStreams[0];  // first stream ~= iptv-org's preferred quality
    if (isDead(s.url)) continue;
    candidates.push({
      id: meta.id,
      name: rule.label || meta.name,
      url: s.url,
      headers: buildStreamHeaders(s),
      sport: rule.sport,
      priority: rule.priority,
      source: 'iptv-org',
    });
  }

  const CONC = 8;
  const alive = [];
  for (let i = 0; i < candidates.length; i += CONC) {
    const batch = candidates.slice(i, i + CONC);
    const results = await Promise.all(batch.map(async (c) => {
      const ok = await headCheck(c.url, c.headers);
      if (!ok) { markDead(c.url); return null; }
      return c;
    }));
    for (const r of results) if (r) alive.push(r);
  }

  // Dedupe by name (Samsung + Pluto sometimes both carry NBA TV under the
  // same iptv-org id, but occasionally the catalog lists the same feed
  // under two different channel ids too). Keep the higher-priority row.
  const byName = new Map();
  for (const row of alive) {
    const key = row.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev || row.priority < prev.priority) byName.set(key, row);
  }
  const finalRows = [...byName.values()]
    .sort((a, b) => (a.sport === b.sport)
      ? a.priority - b.priority
      : a.sport.localeCompare(b.sport));

  return { channels: finalRows, ts: Date.now() };
}

// Some iptv-org rows carry http_referrer / user_agent — the origin CDN 403s
// without them. Kodi's inputstream.adaptive and Electron's Chromium both
// forward the headers we return, so pack them here.
function buildStreamHeaders(s) {
  const h = {};
  if (s.http_referrer) h.Referer = s.http_referrer;
  if (s.user_agent) h['User-Agent'] = s.user_agent;
  else h['User-Agent'] = UA;
  return h;
}

// ─── Public surface ───────────────────────────────────────────────────────────
async function listChannels() {
  const now = Date.now();
  if (CATALOG_CACHE && now - CATALOG_CACHE.ts < CATALOG_TTL_MS) {
    return CATALOG_CACHE.channels;
  }
  if (CATALOG_INFLIGHT) return CATALOG_INFLIGHT;

  CATALOG_INFLIGHT = (async () => {
    try {
      const built = await buildCatalog();
      CATALOG_CACHE = built;
      return built.channels;
    } catch (e) {
      // Serve stale on failure — a dead GitHub Pages hit is not a reason
      // to break the sports grid.
      if (CATALOG_CACHE) return CATALOG_CACHE.channels;
      throw e instanceof ExtractorError
        ? e
        : new ExtractorError(`iptv-org catalog build failed: ${e.message}`, { cause: e });
    } finally {
      CATALOG_INFLIGHT = null;
    }
  })();
  return CATALOG_INFLIGHT;
}

// Fresh per-request (no cache): the caller wants a live playable URL right
// now, and streams.json rows are the ground truth. We re-read the catalog
// (which itself is cached) so we don't re-fetch the raw JSONs.
async function resolveStream(channelId) {
  if (!channelId) throw new ExtractorError('iptv-org: channelId required');
  const channels = await listChannels();
  const row = channels.find(c => c.id === channelId);
  if (!row) throw new ExtractorError(`iptv-org: channel ${channelId} not in curated list`);

  // Re-verify RIGHT NOW — the 6h catalog cache is long enough that a stream
  // could have died since the last rebuild. One HEAD is cheap.
  const ok = await headCheck(row.url, row.headers);
  if (!ok) {
    markDead(row.url);
    throw new ExtractorError(`iptv-org: ${row.name} is offline right now`);
  }

  return {
    stream_url: row.url,
    headers: row.headers,
    subtitles: [],
    site_url: null,     // no landing page — the FAST feed is direct
    hoster: 'iptv-org',
  };
}

module.exports = { listChannels, resolveStream, ExtractorError };

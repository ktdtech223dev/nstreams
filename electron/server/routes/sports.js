// N Streams — Sports schedule route
// Aggregates: ESPN unofficial scoreboard API + OpenF1 + hardcoded WEC 2026 calendar.
// Each aggregation cycle fuzzy-matches events against DaddyLive's live fixture
// list and attaches per-event resolver URLs. Events without a match are left
// with streams:[] — the client can fall back to iptv-org FAST channels or the
// 24/7 DaddyLive list.
// Cached for 10 minutes server-side.

const express = require('express');
const iptvOrg = require('../extractors/iptv_org');
const { similarity } = require('../scrapers');
const router = express.Router();

// ─── Cache ───────────────────────────────────────────────────────────────────
let cache = null;
let cacheAt = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 min

// DaddyLive fixture/channel/stream caches. Fixture + channels get refreshed
// on the aggregation TTL; per-stream resolves are short-lived because the
// signed HLS URL embeds a Unix-epoch expiry and rotates every few minutes.
let dlFixtureCache = null;
let dlFixtureCacheAt = 0;
const DL_FIXTURE_TTL = 5 * 60 * 1000;

let dlChannelsCache = null;
let dlChannelsCacheAt = 0;
const DL_CHANNELS_TTL = 30 * 60 * 1000;

const dlStreamCache = new Map(); // id → { at, payload }
const DL_STREAM_TTL = 90 * 1000; // signed URLs are single-use-ish

// Lazily require the extractor so this route still loads if the module is
// missing during initial bring-up. Returns null on failure.
function getDaddyLive() {
  try {
    return require('../extractors/daddylive');
  } catch (e) {
    console.warn('[sports] daddylive extractor unavailable:', e.message);
    return null;
  }
}

// ─── WEC 2026 Calendar ───────────────────────────────────────────────────────
// No free API — hardcoded. Update annually.
const WEC_2026 = [
  { id: 'wec-2026-1', title: 'Qatar 1812km',         subtitle: 'Round 1 · Losail Circuit',          startTime: '2026-03-01T11:00:00Z', endTime: '2026-03-02T00:00:00Z' },
  { id: 'wec-2026-2', title: 'Sebring 1000 Miles',    subtitle: 'Round 2 · Sebring International',   startTime: '2026-03-14T16:00:00Z', endTime: '2026-03-15T01:00:00Z' },
  { id: 'wec-2026-3', title: 'Spa-Francorchamps 6H',  subtitle: 'Round 3 · Circuit de Spa',          startTime: '2026-04-25T10:30:00Z', endTime: '2026-04-25T16:30:00Z' },
  { id: 'wec-2026-4', title: 'Le Mans 24 Hours',      subtitle: 'Round 4 · Circuit de la Sarthe',    startTime: '2026-06-13T14:00:00Z', endTime: '2026-06-14T14:00:00Z' },
  { id: 'wec-2026-5', title: 'Fuji 6 Hours',          subtitle: 'Round 5 · Fuji Speedway',           startTime: '2026-09-06T05:00:00Z', endTime: '2026-09-06T11:00:00Z' },
  { id: 'wec-2026-6', title: 'Bahrain 8 Hours',       subtitle: 'Round 6 · Bahrain International',   startTime: '2026-11-07T15:00:00Z', endTime: '2026-11-07T23:00:00Z' },
];

// ─── ESPN endpoints ──────────────────────────────────────────────────────────
const ESPN_ENDPOINTS = [
  { leagueId: 'ufc',        sport: 'ufc',         label: 'UFC',              espnPath: 'mma/ufc' },
  { leagueId: 'basketball', sport: 'basketball',  label: 'NBA',              espnPath: 'basketball/nba' },
  { leagueId: 'football',   sport: 'football',    label: 'NFL',              espnPath: 'football/nfl' },
  { leagueId: 'hockey',     sport: 'hockey',      label: 'NHL',              espnPath: 'hockey/nhl' },
  { leagueId: 'baseball',   sport: 'baseball',    label: 'MLB',              espnPath: 'baseball/mlb' },
  { leagueId: 'soccer',     sport: 'soccer',      label: 'Premier League',   espnPath: 'soccer/eng.1' },
  { leagueId: 'soccer',     sport: 'soccer',      label: 'La Liga',          espnPath: 'soccer/esp.1' },
  { leagueId: 'soccer',     sport: 'soccer',      label: 'Champions League', espnPath: 'soccer/UEFA.CHAMPIONS' },
  { leagueId: 'soccer',     sport: 'soccer',      label: 'MLS',              espnPath: 'soccer/usa.1' },
  { leagueId: 'soccer',     sport: 'soccer',      label: 'Bundesliga',       espnPath: 'soccer/ger.1' },
  { leagueId: 'soccer',     sport: 'soccer',      label: 'Serie A',          espnPath: 'soccer/ita.1' },
  { leagueId: 'golf',       sport: 'golf',        label: 'Golf (PGA)',        espnPath: 'golf/pga' },
  { leagueId: 'boxing',     sport: 'boxing',      label: 'Boxing',           espnPath: 'boxing' },
  { leagueId: 'tennis',     sport: 'tennis',      label: 'Tennis (ATP)',     espnPath: 'tennis/atp' },
  { leagueId: 'tennis',     sport: 'tennis',      label: 'Tennis (WTA)',     espnPath: 'tennis/wta' },
  { leagueId: 'motogp',     sport: 'motorsports', label: 'MotoGP',           espnPath: 'motorsports/motogp' },
];

function dateStr(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function fetchESPN(endpoint) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 7);
  const dateRange = `${dateStr(now)}-${dateStr(end)}`;

  const url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint.espnPath}/scoreboard?dates=${dateRange}&limit=50`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NStreams/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).map(ev => normalizeESPN(ev, endpoint));
  } catch (e) {
    // Silently skip unavailable endpoints
    return [];
  }
}

function normalizeESPN(ev, endpoint) {
  const comp = ev.competitions?.[0];
  const statusType = ev.status?.type;
  const state = statusType?.state; // 'pre' | 'in' | 'post'

  let status = 'upcoming';
  if (state === 'in') status = 'live';
  else if (state === 'post') status = 'final';

  // Build human-readable title
  const competitors = comp?.competitors || [];
  let title = ev.shortName || ev.name || 'Event';
  let subtitle = endpoint.label;
  let teams = null;

  // For two-team events: "Away at Home" format
  if (competitors.length === 2 && competitors[0]?.team) {
    const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
    const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
    const hName = home.team.shortDisplayName || home.team.abbreviation || home.team.name;
    const aName = away.team.shortDisplayName || away.team.abbreviation || away.team.name;
    title = `${aName} at ${hName}`;
    teams = {
      home: home.team.displayName || home.team.name || hName,
      away: away.team.displayName || away.team.name || aName,
      homeShort: hName,
      awayShort: aName,
    };
    if (comp?.venue?.fullName) subtitle = `${endpoint.label} · ${comp.venue.fullName}`;
  }

  // Score
  let score = null;
  if (status !== 'upcoming' && competitors.length === 2) {
    const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
    const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
    if (home?.score !== undefined && away?.score !== undefined) {
      const hName = home.team?.shortDisplayName || home.team?.abbreviation || 'Home';
      const aName = away.team?.shortDisplayName || away.team?.abbreviation || 'Away';
      score = `${aName} ${away.score} — ${home.score} ${hName}`;
    }
  }

  const statusText = statusType?.shortDetail || statusType?.detail || '';

  return {
    id: `espn-${endpoint.espnPath.replace(/\//g, '-')}-${ev.id}`,
    sport: endpoint.sport,
    league: endpoint.label,
    leagueId: endpoint.leagueId,
    title,
    subtitle,
    teams,
    startTime: ev.date,
    endTime: null,
    status,
    statusText: statusText === 'Final' || statusText === 'F' ? 'Final' : statusText,
    score,
    streams: [],
  };
}

// ─── OpenF1 ──────────────────────────────────────────────────────────────────
async function fetchOpenF1() {
  try {
    const year = new Date().getFullYear();
    const res = await fetch(`https://api.openf1.org/v1/sessions?year=${year}`, {
      headers: { 'User-Agent': 'NStreams/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const sessions = await res.json();
    const now = new Date();
    const cutoffFuture = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const cutoffPast   = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return sessions
      .filter(s => {
        if (!s.date_start) return false;
        const start = new Date(s.date_start);
        const end   = s.date_end ? new Date(s.date_end) : start;
        // Exclude sessions ended more than 24h ago or starting more than 14 days away
        if (end < cutoffPast) return false;
        if (start > cutoffFuture) return false;
        return true;
      })
      .map(s => {
        const start = new Date(s.date_start);
        const end   = s.date_end ? new Date(s.date_end) : null;
        let status = 'upcoming';
        if (end && now > end) status = 'final';
        else if (now >= start) status = 'live';

        const sessionName = s.session_name || s.session_type || 'Session';
        const meetingName = s.meeting_name || 'Formula 1';
        const location = [s.location, s.country_name].filter(Boolean).join(', ');

        return {
          id: `f1-${s.session_key || s.meeting_key || s.date_start}-${sessionName.replace(/\s/g, '')}`,
          sport: 'motorsports',
          league: 'Formula 1',
          leagueId: 'f1',
          title: `${meetingName} — ${sessionName}`,
          subtitle: `F1${location ? ` · ${location}` : ''}`,
          startTime: s.date_start,
          endTime: s.date_end || null,
          status,
          statusText: status === 'live' ? 'LIVE' : status === 'final' ? 'Final' : '',
          score: null,
          streams: [],
        };
      });
  } catch (e) {
    console.warn('[sports] OpenF1 error:', e.message);
    return [];
  }
}

// ─── WEC ─────────────────────────────────────────────────────────────────────
function getWECEvents() {
  const now = new Date();
  const cutoffFuture = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const cutoffPast   = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return WEC_2026
    .filter(ev => {
      const start = new Date(ev.startTime);
      const end   = ev.endTime ? new Date(ev.endTime) : start;
      if (end < cutoffPast) return false;
      if (start > cutoffFuture) return false;
      return true;
    })
    .map(ev => {
      const start = new Date(ev.startTime);
      const end   = ev.endTime ? new Date(ev.endTime) : null;
      let status = 'upcoming';
      if (end && now > end) status = 'final';
      else if (now >= start) status = 'live';
      return {
        ...ev,
        sport: 'motorsports',
        league: 'WEC',
        leagueId: 'wec',
        status,
        statusText: status === 'live' ? 'LIVE' : status === 'final' ? 'Final' : '',
        score: null,
        streams: [],
      };
    });
}

// ─── DaddyLive fixture matching ──────────────────────────────────────────────
// Normalize an event/fixture object into a searchable form. DaddyLive fixture
// items look like `{time, event, channels: [{channel_name, channel_id}], channels2: [...]}`
// per the schedule JSON shape — we defensively accept a few field-name variants.
function dlFixtureTitle(fx) {
  return String(fx.event || fx.title || fx.name || '').trim();
}

function dlFixtureChannels(fx) {
  // The extractor's listLiveEvents() normalizes channels down to a flat
  // string array on `channel_ids` — read that shape as the primary path.
  // Also tolerate the raw {channels: [{channel_id, channel_name}]} shape
  // in case anyone starts feeding the raw JSON in later.
  const out = [];
  const seen = new Set();
  if (Array.isArray(fx.channel_ids)) {
    for (const id of fx.channel_ids) {
      if (id == null) continue;
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: key, name: '' });
    }
  }
  for (const key of ['channels', 'channels2']) {
    const arr = fx[key];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const id = c && (c.channel_id ?? c.id);
      const name = (c && (c.channel_name ?? c.name)) || '';
      if (id == null || seen.has(String(id))) continue;
      seen.add(String(id));
      out.push({ id: String(id), name: String(name) });
    }
  }
  return out;
}

// Score a candidate fixture against an event. Threshold gate is applied by
// caller. Substring hits on team names are the strongest signal — a full
// "Team A" or "Team B" appearing in the fixture title beats bag-of-bigrams
// on longer strings.
function scoreEventVsFixture(ev, fx) {
  const evTitle = ev.title || '';
  const fxTitle = dlFixtureTitle(fx);
  if (!fxTitle) return 0;

  const evLc = evTitle.toLowerCase();
  const fxLc = fxTitle.toLowerCase();

  // Team-pair substring bonus: both teams appear in the DL fixture title.
  if (ev.teams) {
    const { home, away, homeShort, awayShort } = ev.teams;
    const homeCandidates = [home, homeShort].filter(Boolean).map(s => s.toLowerCase());
    const awayCandidates = [away, awayShort].filter(Boolean).map(s => s.toLowerCase());
    const homeHit = homeCandidates.some(t => t && fxLc.includes(t));
    const awayHit = awayCandidates.some(t => t && fxLc.includes(t));
    if (homeHit && awayHit) return 1.0;
    if (homeHit || awayHit) {
      // one team + decent bigram overlap on the rest is still a match
      const partial = similarity(evTitle, fxTitle);
      return Math.max(0.8, partial);
    }
  }

  // Fall back to string similarity, boosted a hair if the fixture title
  // is a superstring of the event title (common for "F1: Grand Prix — Race").
  const base = similarity(evTitle, fxTitle);
  if (fxLc.includes(evLc) || evLc.includes(fxLc)) return Math.max(base, 0.85);
  return base;
}

async function getDaddyFixtures() {
  const now = Date.now();
  if (dlFixtureCache && (now - dlFixtureCacheAt) < DL_FIXTURE_TTL) return dlFixtureCache;
  const dl = getDaddyLive();
  if (!dl || typeof dl.listLiveEvents !== 'function') {
    dlFixtureCache = [];
    dlFixtureCacheAt = now;
    return dlFixtureCache;
  }
  try {
    const list = await dl.listLiveEvents();
    dlFixtureCache = Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('[sports] daddylive listLiveEvents error:', e.message);
    dlFixtureCache = [];
  }
  dlFixtureCacheAt = now;
  return dlFixtureCache;
}

async function attachDaddyLiveStreams(events) {
  const fixtures = await getDaddyFixtures();
  if (!fixtures.length) return events;

  const THRESHOLD = 0.7;
  for (const ev of events) {
    // Skip finals — no live stream to attach.
    if (ev.status === 'final') continue;
    if (!ev.title) continue;

    let best = null;
    let bestScore = 0;
    for (const fx of fixtures) {
      const s = scoreEventVsFixture(ev, fx);
      if (s > bestScore) { bestScore = s; best = fx; }
    }
    if (!best || bestScore < THRESHOLD) continue;

    const channels = dlFixtureChannels(best);
    if (!channels.length) continue;
    const primary = channels[0];
    // Also stamp the match on the event root so the Kodi UI (which
    // reads ev.dlhd_channel_id / ev.dlhd_event_id in build_sports_live)
    // can render a native "play_sports" row without dredging streams[].
    ev.dlhd_channel_id = primary.id;
    ev.dlhd_event_id = best.event_id || null;
    ev.dlhd_match_score = Number(bestScore.toFixed(3));
    ev.streams = [{
      name: 'DaddyLive',
      provider: 'dlhd',
      channel_id: primary.id,
      event_id: best.event_id || null,
      channel_name: primary.name || undefined,
      // `url` is a live resolve URL the desktop client can hit to get
      // {ok:true, stream_url, headers}. Same host as /api/sports so the
      // browser doesn't need to know Railway's URL.
      url: `/api/sports/dlhd/stream/${encodeURIComponent(primary.id)}`,
      resolve_url: `/api/sports/dlhd/stream/${encodeURIComponent(primary.id)}`,
      match_score: Number(bestScore.toFixed(3)),
    }];
  }
  return events;
}

// ─── Aggregator ───────────────────────────────────────────────────────────────
async function fetchAllSports() {
  const [espnResults, f1Events, wecEvents] = await Promise.all([
    Promise.all(ESPN_ENDPOINTS.map(fetchESPN)).then(r => r.flat()),
    fetchOpenF1(),
    Promise.resolve(getWECEvents()),
  ]);

  const all = [...espnResults, ...f1Events, ...wecEvents];

  // Dedupe by id (multiple soccer leagues can repeat events)
  const seen = new Set();
  const deduped = all.filter(ev => {
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  });

  // Sort: live → upcoming (by time) → final (by time desc)
  const ORDER = { live: 0, upcoming: 1, final: 2 };
  deduped.sort((a, b) => {
    if (ORDER[a.status] !== ORDER[b.status]) return ORDER[a.status] - ORDER[b.status];
    if (a.status === 'final') return new Date(b.startTime) - new Date(a.startTime);
    return new Date(a.startTime) - new Date(b.startTime);
  });

  // Populate .streams from DaddyLive fixture fuzzy-match. Never allowed to
  // break the aggregation — a failure just leaves streams:[] on every event.
  try {
    await attachDaddyLiveStreams(deduped);
  } catch (e) {
    console.warn('[sports] attachDaddyLiveStreams failed:', e.message);
  }

  return deduped;
}

// ─── Routes ──────────────────────────────────────────────────────────────────
router.get('/sports', async (req, res) => {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL) return res.json(cache);

  try {
    const events = await fetchAllSports();
    cache = events;
    cacheAt = now;
    res.json(events);
  } catch (e) {
    console.error('[sports] aggregation error:', e);
    if (cache) return res.json(cache); // serve stale on error
    res.status(500).json({ error: e.message });
  }
});

router.post('/sports/clear-cache', (req, res) => {
  cache = null;
  cacheAt = 0;
  dlFixtureCache = null;
  dlFixtureCacheAt = 0;
  dlChannelsCache = null;
  dlChannelsCacheAt = 0;
  dlStreamCache.clear();
  res.json({ ok: true });
});

// ─── DaddyLive routes ────────────────────────────────────────────────────────
// 24/7 channel directory — cached for 30 min. Falls back cleanly when the
// extractor module isn't present (returns { ok:false, error, channels:[] }).
router.get('/sports/dlhd/channels', async (req, res) => {
  const now = Date.now();
  if (dlChannelsCache && (now - dlChannelsCacheAt) < DL_CHANNELS_TTL) {
    return res.json({ ok: true, channels: dlChannelsCache, cached: true });
  }
  const dl = getDaddyLive();
  if (!dl || typeof dl.listChannels !== 'function') {
    return res.json({ ok: false, error: 'daddylive extractor unavailable', channels: [] });
  }
  try {
    const list = await dl.listChannels();
    const channels = Array.isArray(list) ? list : [];
    dlChannelsCache = channels;
    dlChannelsCacheAt = now;
    res.json({ ok: true, channels });
  } catch (e) {
    console.warn('[sports] dlhd channels error:', e.message);
    // serve stale if we have it
    if (dlChannelsCache) return res.json({ ok: true, channels: dlChannelsCache, stale: true, error: e.message });
    res.json({ ok: false, error: e.message, channels: [] });
  }
});

// Per-channel HLS resolver — matches the /api/stream/:provider convention:
// 200 on success with the extractor payload; 200 with {ok:false, error} on
// extractor failure so the client can surface it without a network-error toast.
router.get('/sports/dlhd/stream/:id', async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'missing id' });

  const now = Date.now();
  const hit = dlStreamCache.get(id);
  // Gate on the signed URL's own expiry, not just wall-clock TTL — a
  // 90 s route cache is otherwise happy to serve a URL whose CDN
  // signature already lapsed.
  const EXPIRY_SAFETY_MS = 300 * 1000;
  const stillFresh =
    hit &&
    (now - hit.at) < DL_STREAM_TTL &&
    (!hit.payload?.expires || hit.payload.expires - now > EXPIRY_SAFETY_MS);
  if (stillFresh) {
    return res.json({ ok: true, ...hit.payload, cached: true });
  }

  const dl = getDaddyLive();
  if (!dl || typeof dl.resolveStream !== 'function') {
    return res.json({ ok: false, error: 'daddylive extractor unavailable' });
  }
  try {
    const payload = await dl.resolveStream(id);
    if (!payload || !payload.stream_url) {
      return res.json({ ok: false, error: 'no stream resolved' });
    }
    dlStreamCache.set(id, { at: now, payload });
    res.json({ ok: true, ...payload });
  } catch (e) {
    console.warn(`[sports] dlhd resolveStream ${id} error:`, e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ─── iptv-org FAST-channel fallback ──────────────────────────────────────────
// Legal free-to-air / FAST feeds (Samsung TV Plus, Pluto, Amagi, etc.) that
// the copyright holders publish themselves. Used when dlhd/daddylive is down.
// See electron/server/extractors/iptv_org.js for the curated allowlist.

router.get('/sports/iptv-org/channels', async (req, res) => {
  try {
    const channels = await iptvOrg.listChannels();
    res.json({ channels, source: 'iptv-org', count: channels.length });
  } catch (e) {
    console.error('[sports] iptv-org channels error:', e.message);
    res.status(502).json({ error: e.message, channels: [] });
  }
});

router.get('/sports/iptv-org/stream/:id', async (req, res) => {
  try {
    const out = await iptvOrg.resolveStream(req.params.id);
    res.json(out);
  } catch (e) {
    console.error('[sports] iptv-org stream error:', e.message);
    // 404 for "not in curated list", 502 for "upstream offline right now"
    const status = /not in curated/i.test(e.message) ? 404 : 502;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;

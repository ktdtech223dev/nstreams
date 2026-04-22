// N Streams — Sports schedule route
// Aggregates: ESPN unofficial scoreboard API + OpenF1 + hardcoded WEC 2026 calendar
// Cached for 10 minutes server-side.

const express = require('express');
const router = express.Router();

// ─── Cache ───────────────────────────────────────────────────────────────────
let cache = null;
let cacheAt = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 min

// ─── Stream sources per league ───────────────────────────────────────────────
// Ordered by reliability in embedded Chromium (no CF bot loops, no iframe blocks).
// LiveTV.sx and WeakStreams are the most consistent; sport-specific "Bite" sites
// work well for US leagues. 720pStream and VIPLeague as backups.
const STREAMS = {
  f1:         [{ name: 'F1Stream',    url: 'https://f1stream.me' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: '720pStream',  url: 'https://720pstreams.tv' }],
  motogp:     [{ name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: '720pStream',  url: 'https://720pstreams.tv' }],
  wec:        [{ name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' }],
  ufc:        [{ name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'VIPLeague',   url: 'https://vipleaguetv.net' }],
  basketball: [{ name: 'NFLBite/NBA', url: 'https://nbabite.com' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' }],
  football:   [{ name: 'NFLBite',    url: 'https://nflbite.com' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' }],
  hockey:     [{ name: 'NHLBite',    url: 'https://nhlbite.com' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' }],
  baseball:   [{ name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'VIPLeague',   url: 'https://vipleaguetv.net' }],
  soccer:     [{ name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'VIPLeague',   url: 'https://vipleaguetv.net' }],
  boxing:     [{ name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'VIPLeague',   url: 'https://vipleaguetv.net' }],
  golf:       [{ name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' }],
  tennis:     [{ name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' },
               { name: '720pStream',  url: 'https://720pstreams.tv' }],
  motorsports:[{ name: 'LiveTV',      url: 'https://livetv.sx/en/' },
               { name: 'WeakStreams', url: 'https://weakstreams.one' }],
};

function streamsFor(leagueId, sport) {
  return STREAMS[leagueId] || STREAMS[sport] || STREAMS.motorsports;
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

  // For two-team events: "Away at Home" format
  if (competitors.length === 2 && competitors[0]?.team) {
    const home = competitors.find(c => c.homeAway === 'home') || competitors[0];
    const away = competitors.find(c => c.homeAway === 'away') || competitors[1];
    const hName = home.team.shortDisplayName || home.team.abbreviation || home.team.name;
    const aName = away.team.shortDisplayName || away.team.abbreviation || away.team.name;
    title = `${aName} at ${hName}`;
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
    startTime: ev.date,
    endTime: null,
    status,
    statusText: statusText === 'Final' || statusText === 'F' ? 'Final' : statusText,
    score,
    streams: streamsFor(endpoint.leagueId, endpoint.sport),
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
          streams: STREAMS.f1,
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
        streams: STREAMS.wec,
      };
    });
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
  res.json({ ok: true });
});

module.exports = router;

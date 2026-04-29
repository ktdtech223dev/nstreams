// HTTP wrapper for the Launcher REST API.
// All methods return parsed JSON or null on error.
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const BASE        = () => process.env.LAUNCHER_API   || 'https://ngames-server-production.up.railway.app';
const NSTREAMS    = () => process.env.NSTREAMS_API   || 'https://nstreams-api-production.up.railway.app/api';

async function get(path, baseUrl) {
  try {
    const url = (baseUrl || BASE()) + path;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Fetch a user's watchlist from the N Streams Railway API.
// Returns the watchlist array sorted by the given field, or null on error.
async function getNStreamsWatchlist(username, opts = {}) {
  // First look up the user id by username
  const users = await get('/users', NSTREAMS());
  if (!users?.length) return null;
  const user = users.find(u =>
    u.username?.toLowerCase() === username.toLowerCase() ||
    u.display_name?.toLowerCase() === username.toLowerCase()
  );
  if (!user) return null;

  const qs = new URLSearchParams({ sort: opts.sort || 'updated' });
  if (opts.status) qs.set('status', opts.status);
  const rows = await get(`/watchlist/${user.id}?${qs}`, NSTREAMS());
  return rows ? { user, rows } : null;
}

const api = {
  getCrew:              ()          => get('/crew'),
  getPresence:          ()          => get('/presence'),
  getWall:              (n = 5)     => get(`/wall?limit=${n}`),
  getStats:             (id)        => get(`/stats/${id}`),
  getLeaderboard:       (game)      => get(game ? `/sessions/leaderboard?game=${game}` : '/sessions/leaderboard'),
  getChallenges:        ()          => get('/challenges/active'),
  getSeason:            ()          => get('/seasons/current'),
  // N Streams relay (crew stats snapshots on the N Games server)
  getNStreamsCrew:      ()          => get('/nstreams/crew'),
  getNStreamsUser:       (username)  => get(`/nstreams/crew/${encodeURIComponent(username)}`),
  // N Streams Railway API (full watchlist data)
  getNStreamsWatchlist,
};

module.exports = api;

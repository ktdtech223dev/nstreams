// HTTP wrapper for the Launcher REST API.
// All methods return parsed JSON or null on error.
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const BASE = () => process.env.LAUNCHER_API || 'https://ngames-server-production.up.railway.app';

async function get(path) {
  try {
    const res = await fetch(`${BASE()}${path}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const api = {
  getCrew:       ()       => get('/crew'),
  getPresence:   ()       => get('/presence'),
  getWall:       (n = 5)  => get(`/wall?limit=${n}`),
  getStats:      (id)     => get(`/stats/${id}`),
  getLeaderboard:(game)   => get(game ? `/sessions/leaderboard?game=${game}` : '/sessions/leaderboard'),
  getChallenges: ()       => get('/challenges/active'),
  getSeason:     ()       => get('/seasons/current'),
};

module.exports = api;

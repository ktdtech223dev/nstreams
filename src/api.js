const BASE = 'http://localhost:57832/api';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
  put: (p, b) => req('PUT', p, b),
  del: (p) => req('DELETE', p),

  // Shortcuts
  search: (q, type) => req('GET', `/search?q=${encodeURIComponent(q)}&type=${type || 'multi'}`),
  getUsers: () => req('GET', '/users'),
  getUser: (id) => req('GET', `/users/${id}`),
  getWatchlist: (userId, opts = {}) => {
    const p = new URLSearchParams(opts);
    return req('GET', `/watchlist/${userId}?${p}`);
  },
  addToWatchlist: (b) => req('POST', '/watchlist', b),
  updateWatchlist: (id, b) => req('PUT', `/watchlist/${id}`, b),
  advanceEpisode: (id) => req('POST', `/watchlist/${id}/advance`),
  getContent: (id, userId) => req('GET', `/content/${id}?user_id=${userId}`),
  addContent: (b) => req('POST', '/content', b),
  addContentManual: (b) => req('POST', '/content/manual', b),
  whereToWatch: (id) => req('GET', `/content/${id}/where-to-watch`),
  linkService: (id, b) => req('POST', `/content/${id}/link-service`, b),
  getSites: () => req('GET', '/sites'),
  addSite: (b) => req('POST', '/sites', b),
  upvoteSite: (id) => req('PUT', `/sites/${id}/upvote`),
  delSite: (id, userId) => req('DELETE', `/sites/${id}?user_id=${userId}`),
  activityCrew: () => req('GET', '/activity/crew'),
  startSession: (b) => req('POST', '/sessions/start', b),
  endSession: (id, b) => req('POST', `/sessions/${id}/end`, b),
  activeSessions: (userId) => req('GET', `/sessions/active/${userId}`),
  syncStatus: (userId) => req('GET', `/sync/status/${userId}`),
  discoverAll: (type = 'tv') => req('GET', `/discover/all?type=${type}`),
  discoverService: (siteId, type = 'tv') => req('GET', `/discover/service/${siteId}?type=${type}`),
  discoverTrending: (type = 'all') => req('GET', `/discover/trending?type=${type}`),
  linkableSites: () => req('GET', '/sites/linkable'),
  malAuthUrl: (userId) => req('GET', `/sync/mal/auth-url?userId=${userId}`),
  malCallback: (b) => req('POST', '/sync/mal/callback', b),
  malSync: (userId) => req('POST', `/sync/mal/${userId}`),
  anilistAuthUrl: () => req('GET', '/sync/anilist/auth-url'),
  anilistCallback: (b) => req('POST', '/sync/anilist/callback', b),
  anilistSync: (userId) => req('POST', `/sync/anilist/${userId}`)
};

export default api;

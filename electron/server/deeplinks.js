// Best-effort deep-link search URLs for each streaming service.
// Since TMDB doesn't expose per-show deep links, we link to the
// service's own search page scoped to the show title.

const SERVICE_SEARCH = {
  'netflix':              (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  'hulu':                 (q) => `https://www.hulu.com/search?q=${encodeURIComponent(q)}`,
  'disney+':              (q) => `https://www.disneyplus.com/search/${encodeURIComponent(q)}`,
  'disney plus':          (q) => `https://www.disneyplus.com/search/${encodeURIComponent(q)}`,
  'max':                  (q) => `https://play.max.com/search?q=${encodeURIComponent(q)}`,
  'hbo max':              (q) => `https://play.max.com/search?q=${encodeURIComponent(q)}`,
  'prime video':          (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=instant-video`,
  'amazon prime video':   (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=instant-video`,
  'amazon prime':         (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=instant-video`,
  'crunchyroll':          (q) => `https://www.crunchyroll.com/search?q=${encodeURIComponent(q)}`,
  'peacock':              (q) => `https://www.peacocktv.com/search?q=${encodeURIComponent(q)}`,
  'peacock premium':      (q) => `https://www.peacocktv.com/search?q=${encodeURIComponent(q)}`,
  'paramount+':           (q) => `https://www.paramountplus.com/search/?q=${encodeURIComponent(q)}`,
  'paramount plus':       (q) => `https://www.paramountplus.com/search/?q=${encodeURIComponent(q)}`,
  'apple tv+':            (q) => `https://tv.apple.com/search?term=${encodeURIComponent(q)}`,
  'apple tv plus':        (q) => `https://tv.apple.com/search?term=${encodeURIComponent(q)}`,
  'youtube':              (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  'tubi':                 (q) => `https://tubitv.com/search/${encodeURIComponent(q)}`,
  'pluto tv':             (q) => `https://pluto.tv/en/search/details?query=${encodeURIComponent(q)}`,
  'funimation':           (q) => `https://www.funimation.com/search?q=${encodeURIComponent(q)}`,
  'hidive':               (q) => `https://www.hidive.com/search?q=${encodeURIComponent(q)}`,
  'starz':                (q) => `https://www.starz.com/us/en/search?searchTerm=${encodeURIComponent(q)}`,
  'showtime':             (q) => `https://www.showtime.com/search?q=${encodeURIComponent(q)}`,
  'discovery+':           (q) => `https://www.discoveryplus.com/search?q=${encodeURIComponent(q)}`,
  'mubi':                 (q) => `https://mubi.com/search/films?query=${encodeURIComponent(q)}`,
  'amc+':                 (q) => `https://www.amcplus.com/search?q=${encodeURIComponent(q)}`,
  'britbox':              (q) => `https://www.britbox.com/us/search/${encodeURIComponent(q)}`
};

// Landing pages where users sign in — used by "Linked Accounts" in Settings
const SERVICE_LOGIN = {
  'netflix':              'https://www.netflix.com/login',
  'hulu':                 'https://auth.hulu.com/web/login',
  'disney+':              'https://www.disneyplus.com/login',
  'disney plus':          'https://www.disneyplus.com/login',
  'max':                  'https://play.max.com/sign-in',
  'hbo max':              'https://play.max.com/sign-in',
  'prime video':          'https://www.amazon.com/ap/signin',
  'amazon prime video':   'https://www.amazon.com/ap/signin',
  'crunchyroll':          'https://www.crunchyroll.com/login',
  'peacock':              'https://www.peacocktv.com/signin',
  'paramount+':           'https://www.paramountplus.com/account/signin/',
  'paramount plus':       'https://www.paramountplus.com/account/signin/',
  'apple tv+':            'https://tv.apple.com/login',
  'youtube':              'https://accounts.google.com/signin',
  'tubi':                 'https://tubitv.com/login',
  'pluto tv':             'https://pluto.tv/en/login',
  'funimation':           'https://www.funimation.com/log-in/',
  'hidive':               'https://www.hidive.com/account/login'
};

// Services that rely on Widevine DRM — playback inside embedded
// Electron viewer may fail; offer external-browser fallback.
const DRM_SERVICES = new Set([
  'netflix', 'hulu', 'disney+', 'disney plus', 'max', 'hbo max',
  'prime video', 'amazon prime video', 'amazon prime',
  'peacock', 'paramount+', 'paramount plus', 'apple tv+', 'apple tv plus',
  'starz', 'showtime', 'discovery+',
  'crunchyroll',                    // KAT-6005 = Widevine required on all tiers
  'funimation', 'hidive',
  'amc+', 'britbox', 'mubi'
]);

function norm(name) {
  return (name || '').toLowerCase().trim();
}

function lookupByName(map, name) {
  const key = norm(name);
  if (map[key]) return map[key];
  for (const k of Object.keys(map)) {
    if (key.includes(k) || k.includes(key)) return map[k];
  }
  return null;
}

function deepLinkFor(siteName, homepageUrl, title) {
  if (!title) return homepageUrl;
  const fn = lookupByName(SERVICE_SEARCH, siteName);
  return fn ? fn(title) : homepageUrl;
}

function loginUrlFor(siteName, homepageUrl) {
  return lookupByName(SERVICE_LOGIN, siteName) || homepageUrl;
}

function requiresDrm(siteName) {
  const key = norm(siteName);
  if (DRM_SERVICES.has(key)) return true;
  for (const d of DRM_SERVICES) {
    if (key.includes(d) || d.includes(key)) return true;
  }
  return false;
}

module.exports = {
  SERVICE_SEARCH,
  SERVICE_LOGIN,
  DRM_SERVICES,
  deepLinkFor,
  loginUrlFor,
  requiresDrm
};

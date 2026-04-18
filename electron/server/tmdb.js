const axios = require('axios');
const Store = require('electron-store');
const store = new Store();

const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

function getKey() {
  const key = store.get('tmdb_api_key');
  if (!key) throw new Error('TMDB_KEY_MISSING');
  return key;
}

async function search(query, type = 'multi') {
  const res = await axios.get(`${BASE}/search/${type}`, {
    params: {
      api_key: getKey(),
      query,
      language: 'en-US',
      include_adult: false,
      page: 1
    }
  });
  return res.data.results
    .filter(r => r.poster_path)
    .map(formatResult);
}

async function getDetails(tmdbId, type) {
  const res = await axios.get(`${BASE}/${type}/${tmdbId}`, {
    params: {
      api_key: getKey(),
      language: 'en-US',
      append_to_response: 'credits,watch/providers,external_ids'
    }
  });
  return {
    ...formatDetails(res.data, type),
    providers: formatProviders(res.data['watch/providers'])
  };
}

function formatProviders(providerData) {
  if (!providerData?.results?.US) return [];
  const us = providerData.results.US;
  const all = [
    ...(us.flatrate || []),
    ...(us.free || []),
    ...(us.ads || [])
  ];
  const seen = new Set();
  return all.filter(p => {
    if (seen.has(p.provider_id)) return false;
    seen.add(p.provider_id);
    return true;
  }).map(p => ({
    provider_id: p.provider_id,
    provider_name: p.provider_name,
    logo_path: p.logo_path ? `${IMG}w45${p.logo_path}` : null,
    display_priority: p.display_priority
  }));
}

function formatResult(item) {
  const isMovie = item.media_type === 'movie' || item.title !== undefined;
  return {
    tmdb_id: item.id,
    title: item.title || item.name,
    type: isMovie ? 'movie' : 'series',
    poster_path: item.poster_path ? `${IMG}w300${item.poster_path}` : null,
    backdrop_path: item.backdrop_path ? `${IMG}w780${item.backdrop_path}` : null,
    overview: item.overview,
    release_year: parseInt((item.release_date || item.first_air_date || '0').split('-')[0]),
    rating: item.vote_average,
    media_type: item.media_type || (isMovie ? 'movie' : 'tv')
  };
}

function formatDetails(data, type) {
  return {
    tmdb_id: data.id,
    title: data.title || data.name,
    type: type === 'movie' ? 'movie' : 'series',
    poster_path: data.poster_path ? `${IMG}w300${data.poster_path}` : null,
    backdrop_path: data.backdrop_path ? `${IMG}w780${data.backdrop_path}` : null,
    overview: data.overview,
    release_year: parseInt((data.release_date || data.first_air_date || '0').split('-')[0]),
    rating: data.vote_average,
    genres: JSON.stringify((data.genres || []).map(g => g.name)),
    cast_list: JSON.stringify((data.credits?.cast || []).slice(0, 5).map(c => ({
      name: c.name,
      character: c.character,
      photo: c.profile_path ? `${IMG}w45${c.profile_path}` : null
    }))),
    total_seasons: data.number_of_seasons,
    total_episodes: data.number_of_episodes,
    status: data.status,
    mal_id: data.external_ids?.myanimelist_id || null,
    is_anime: data.external_ids?.myanimelist_id ? 1 : 0
  };
}

// Map site names → TMDB watch-provider IDs (US region).
// TMDB provider IDs are stable. Source: /watch/providers/tv?watch_region=US
const PROVIDER_MAP = {
  'netflix': 8,
  'hulu': 15,
  'disney+': 337,
  'disney plus': 337,
  'max': 1899,
  'hbo max': 1899,
  'prime video': 9,
  'amazon prime video': 9,
  'amazon prime': 9,
  'crunchyroll': 283,
  'peacock': 386,
  'peacock premium': 386,
  'paramount+': 531,
  'paramount plus': 531,
  'apple tv+': 350,
  'apple tv plus': 350,
  'youtube': 192,
  'youtube premium': 188,
  'tubi': 73,
  'pluto tv': 300,
  'funimation': 269,
  'hidive': 430,
  'starz': 43,
  'showtime': 37,
  'discovery+': 520,
  'mubi': 11,
  'amc+': 526,
  'britbox': 151
};

function getProviderIdForSite(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  if (PROVIDER_MAP[key]) return PROVIDER_MAP[key];
  // partial match — "Netflix Basic" → netflix
  for (const [k, v] of Object.entries(PROVIDER_MAP)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

async function discoverByProvider(providerId, type = 'tv', page = 1) {
  const res = await axios.get(`${BASE}/discover/${type}`, {
    params: {
      api_key: getKey(),
      watch_region: 'US',
      with_watch_providers: providerId,
      with_watch_monetization_types: 'flatrate|free|ads',
      sort_by: 'popularity.desc',
      page,
      language: 'en-US',
      include_adult: false
    }
  });
  return res.data.results
    .filter(r => r.poster_path)
    .map(r => formatResult({ ...r, media_type: type === 'movie' ? 'movie' : 'tv' }));
}

async function trending(window = 'week', type = 'all') {
  const res = await axios.get(`${BASE}/trending/${type}/${window}`, {
    params: { api_key: getKey(), language: 'en-US' }
  });
  return res.data.results.filter(r => r.poster_path).map(formatResult);
}

module.exports = {
  search, getDetails, discoverByProvider, trending,
  getProviderIdForSite, PROVIDER_MAP
};

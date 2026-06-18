// VidSrc HLS extractor — walks the vidsrc.to → vsembed.ru → cloudnestra-family
// /rcp/ → /prorcp/ chain server-side. As of June 2026 the final /prorcp/ hop is
// gated by a Cloudflare Turnstile challenge: the page returns a widget form
// instead of the Playerjs config until a 32-char _rcp token (obtained via
// POST /rcp_verify with a Turnstile solution) is appended to the URL.
//
// We deliberately do NOT bundle Puppeteer or a captcha-solver here — that would
// blow the Pi 3B+ ~380 MB budget and centralize legal exposure on Railway.
// Instead we walk hops 1-3 to surface the live {rcpDomain, prorcpHash} pair,
// then throw ExtractorError({ requires_browser: true, ... }) so the caller can
// either (a) hand the deeplink to Kodi's Chromium fallback or (b) the Pi-side
// addon can spawn Chromium briefly to solve Turnstile and dump the m3u8.
//
// On the rare codepath where /prorcp returns the player HTML directly (older
// hosts, A/B buckets without the gate) we extract the .m3u8 and return it.

const axios = require('axios');
const { PROVIDERS } = require('../scrapers');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const TIMEOUT = 10000;
const MAX_BYTES = 10 * 1024 * 1024;

class ExtractorError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ExtractorError';
    Object.assign(this, meta);
  }
}

// Tight host allowlist enforced on every hop AND on every redirect axios
// follows. Without this an allowlisted host could 302 the request to
// 169.254.169.254 or an internal IP and we'd merrily fetch it.
const ALLOWED_HOSTS = /^([a-z0-9-]+\.)*(vidsrc\.to|vsembed\.ru|cloudnestra\.com|cloudorchestranova\.com)$/i;

function _checkHost(hostname, label) {
  if (!ALLOWED_HOSTS.test(hostname)) {
    throw new Error(label + ' host off-allowlist: ' + hostname);
  }
}

function hop(url, referer, extra = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('non-https hop: ' + url);
  _checkHost(parsed.hostname, 'hop');
  return axios.get(url, {
    timeout: TIMEOUT,
    maxContentLength: MAX_BYTES,
    maxRedirects: 3,
    beforeRedirect: (opts) => {
      // axios calls this before following every Location header. If the
      // upstream tries to redirect us off-allowlist, refuse.
      _checkHost(opts.hostname || new URL(opts.href || opts.url).hostname, 'redirect');
    },
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': referer,
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      ...extra
    }
  });
}

async function extract(content, season, episode) {
  if (!content?.tmdb_id) throw new ExtractorError('vidsrc requires a TMDB id');

  const isMovie = content.type === 'movie';
  const s = isMovie ? null : (season || 1);
  const e = isMovie ? null : (episode || 1);
  const embedUrl = isMovie
    ? PROVIDERS.vidsrc.movie(content.tmdb_id)
    : PROVIDERS.vidsrc.tv(content.tmdb_id, s, e);

  // Hop 1: vidsrc.to/embed → vsembed.ru iframe
  let res;
  try { res = await hop(embedUrl, 'https://vidsrc.to/'); }
  catch (err) { throw new ExtractorError(`vidsrc.to embed fetch failed: ${err.message}`); }

  const vsembedMatch = res.data.match(/<iframe[^>]+src=["'](https?:\/\/vsembed\.ru\/[^"']+)["']/i);
  if (!vsembedMatch) throw new ExtractorError('vsembed.ru iframe not found on vidsrc.to');
  const vsembedUrl = vsembedMatch[1];

  // Hop 2: vsembed.ru → //{rcpDomain}/rcp/<hash>. Domain rotates (cloudnestra,
  // cloudorchestranova, …) — extract from the iframe src, never hardcode.
  try { res = await hop(vsembedUrl, 'https://vidsrc.to/'); }
  catch (err) { throw new ExtractorError(`vsembed.ru fetch failed: ${err.message}`); }

  let rcpMatch = res.data.match(/id=["']player_iframe["'][^>]+src=["'](\/\/[^"']+\/rcp\/[^"']+)["']/i);
  if (!rcpMatch) {
    // Fallback: pick first div.server[data-hash] — same hash works on whatever
    // host is current; prepend the canonical cloudnestra.com host.
    const dh = res.data.match(/<div[^>]+class=["'][^"']*server[^"']*["'][^>]+data-hash=["']([^"']+)["']/i);
    if (!dh) throw new ExtractorError('rcp iframe / data-hash not found on vsembed.ru');
    rcpMatch = [null, `//cloudnestra.com/rcp/${dh[1]}`];
  }
  // rcpMatch[1] is upstream HTML — must validate before following.
  // Otherwise vsembed.ru could redirect us into the cloud-metadata
  // service (169.254.169.254) or any internal host.
  const rawRcp = rcpMatch[1].startsWith('//') ? 'https:' + rcpMatch[1] : rcpMatch[1];
  let rcpUrl, rcpDomain;
  try {
    const parsed = new URL(rawRcp);
    rcpUrl = parsed.toString();
    rcpDomain = parsed.origin;
    if (parsed.protocol !== 'https:') throw new Error('non-https rcp');
    // Cloudnestra rotates the SLD but keeps a recognizable shape.
    // Accept the family; refuse anything else (incl. raw IPs, 169.254, .ru, etc.).
    // Strict allowlist — wildcard TLDs (nestra.*, tmstr.*) are
    // attacker-registrable. Enumerate exact SLDs; expand only when a
    // new legitimate one is observed in the wild.
    if (!/^([a-z0-9-]+\.)*(cloudnestra\.com|cloudorchestranova\.com)$/i.test(parsed.hostname)) {
      throw new Error('rcp hostname off-allowlist: ' + parsed.hostname);
    }
  } catch (err) {
    throw new ExtractorError('rcp URL rejected: ' + err.message);
  }

  // Hop 3: /rcp → loadIframe() with /prorcp/<hash>
  try { res = await hop(rcpUrl, vsembedUrl); }
  catch (err) { throw new ExtractorError(`rcp fetch failed: ${err.message}`); }

  const prorcpMatch = res.data.match(/src:\s*['"]\/prorcp\/([A-Za-z0-9+/=_-]+)['"]/);
  if (!prorcpMatch) throw new ExtractorError('prorcp hash not found in rcp HTML');
  const prorcpUrl = `${rcpDomain}/prorcp/${prorcpMatch[1]}`;

  // Hop 4: /prorcp — usually Turnstile gate; occasionally player HTML directly.
  try { res = await hop(prorcpUrl, rcpUrl); }
  catch (err) { throw new ExtractorError(`prorcp fetch failed: ${err.message}`); }

  const body = res.data;
  if (/turnstile|cf-turnstile|challenges\.cloudflare\.com/i.test(body)) {
    throw new ExtractorError('vidsrc /prorcp is Turnstile-gated; browser required', {
      requires_browser: true,
      gate_url: prorcpUrl,
      referer: rcpUrl,
      sitekey: (body.match(/data-sitekey=["']([^"']+)["']/) || [])[1] || null
    });
  }

  const m3u8 =
    (body.match(/file\s*:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/) || [])[1] ||
    (body.match(/(https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>]*)/) || [])[1];
  if (!m3u8 || !/\.m3u8(\?|$)/i.test(m3u8.split('#')[0])) {
    throw new ExtractorError('m3u8 URL not found in prorcp player HTML');
  }

  // Subtitles: tracks: [{file, label, kind}, …] — best-effort.
  const subtitles = [];
  const tracksRaw = (body.match(/tracks\s*:\s*(\[[^\]]+\])/) || [])[1];
  if (tracksRaw) {
    for (const t of tracksRaw.matchAll(/\{[^}]*file\s*:\s*['"]([^'"]+)['"][^}]*\}/g)) {
      const block = t[0];
      const lang = (block.match(/label\s*:\s*['"]([^'"]+)['"]/) || [])[1] || 'und';
      subtitles.push({ url: t[1], lang, label: lang });
    }
  }

  return {
    stream_url: m3u8,
    headers: { 'Referer': `${rcpDomain}/`, 'Origin': rcpDomain, 'User-Agent': UA },
    subtitles
  };
}

module.exports = { extract, ExtractorError };

// Miruro raw-HLS extractor — replicates the JWE/ECDH-ES pipe that
// the browser uses since miruro v0.2 made plain /api/sources a 410.
//
// Flow: anilist_id → /api/secure/jwks (server pubkey) → encrypted
// `episodes` call → pick episode → encrypted `sources` call → decrypt
// universalSource.streams[] → return the first hls/mp4 URL plus the
// matching Referer for inputstream.adaptive.
//
// Brittle on purpose: gated behind a feature flag at the caller, falls
// through to embed/Chromium on any throw.

const axios = require('axios');
const crypto = require('crypto');
const zlib = require('zlib');
const { resolveAnilistId, similarity } = require('../scrapers');

const ORIGIN = 'https://www.miruro.tv';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PROTO = '0.2.0';
const PROVIDERS = ['kiwi', 'pewe', 'bonk', 'bee', 'ally', 'moo', 'hop'];
const HTTP = { timeout: 10000, maxContentLength: 10 * 1024 * 1024 };
const HDRS = { 'User-Agent': UA, 'Origin': ORIGIN, 'Referer': ORIGIN + '/', 'x-protocol-version': PROTO };

class ExtractorError extends Error {
  constructor(msg) { super(msg); this.name = 'ExtractorError'; }
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ECDH-ES key derivation per RFC 7518 §4.6 with empty apu/apv (what miruro uses).
function deriveCEK(sharedSecret, alg = 'A256GCM', keylen = 32) {
  const algBuf = Buffer.from(alg, 'utf8');
  const algInfo = Buffer.concat([Buffer.alloc(4, 0), algBuf]); algInfo.writeUInt32BE(algBuf.length, 0);
  const empty = Buffer.alloc(4, 0);
  const supp = Buffer.alloc(4); supp.writeUInt32BE(keylen * 8, 0);
  const counter = Buffer.alloc(4); counter.writeUInt32BE(1, 0);
  const otherInfo = Buffer.concat([algInfo, empty, empty, supp]);
  return crypto.createHash('sha256').update(Buffer.concat([counter, sharedSecret, otherInfo])).digest().slice(0, keylen);
}

// Decrypt a JWE response — the server's epk is in the header.
function decryptResponse(jwe, ourEcdh) {
  const [protectedB64, , ivB64, ctB64, tagB64] = jwe.split('.');
  const header = JSON.parse(b64urlDecode(protectedB64).toString('utf8'));
  const peer = Buffer.concat([Buffer.from([0x04]), b64urlDecode(header.epk.x), b64urlDecode(header.epk.y)]);
  const cek = deriveCEK(ourEcdh.computeSecret(peer));
  const decipher = crypto.createDecipheriv('aes-256-gcm', cek, b64urlDecode(ivB64));
  decipher.setAuthTag(b64urlDecode(tagB64));
  decipher.setAAD(Buffer.from(protectedB64, 'utf8'));
  let pt = Buffer.concat([decipher.update(b64urlDecode(ctB64)), decipher.final()]);
  if (header.zip === 'DEF') pt = zlib.inflateRawSync(pt);
  return JSON.parse(pt.toString('utf8'));
}

// One round-trip through /api/secure/pipe — keeps the ephemeral private key
// in scope so we can decrypt the response.
async function pipeOnce(path, query = {}) {
  const jwks = await axios.get(`${ORIGIN}/api/secure/jwks`, { headers: HDRS, ...HTTP });
  const serverJwk = (jwks.data?.keys || [jwks.data])[0];
  if (!serverJwk?.x || !serverJwk?.y) throw new ExtractorError('miruro jwks malformed');

  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const peer = Buffer.concat([Buffer.from([0x04]), b64urlDecode(serverJwk.x), b64urlDecode(serverJwk.y)]);
  const cek = deriveCEK(ecdh.computeSecret(peer));
  const epk = { kty: 'EC', crv: 'P-256', x: b64url(ecdh.getPublicKey().slice(1, 33)), y: b64url(ecdh.getPublicKey().slice(33, 65)) };
  const header = { alg: 'ECDH-ES', enc: 'A256GCM', epk };
  const protectedB64 = b64url(Buffer.from(JSON.stringify(header), 'utf8'));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(protectedB64, 'utf8'));
  const envelope = JSON.stringify({ path, method: 'GET', query, body: null, version: PROTO, _t: Date.now() });
  const ct = Buffer.concat([cipher.update(Buffer.from(envelope, 'utf8')), cipher.final()]);
  const jwe = `${protectedB64}..${b64url(iv)}.${b64url(ct)}.${b64url(cipher.getAuthTag())}`;
  const e = b64url(Buffer.from(jwe, 'utf8'));

  const res = await axios.get(`${ORIGIN}/api/secure/pipe?e=${e}`, {
    headers: { ...HDRS, 'Accept': 'application/jose+json' }, ...HTTP, responseType: 'text'
  });
  return decryptResponse(res.data, ecdh);
}

// Same shape as embedsu.looksLikeM3u8 — URL-parse, require https,
// require the path to actually end in .m3u8. Permissive substring
// matching let a compromised provider return file:/// or
// http://169.254.169.254/x?m3u8=1 — both rejected here.
function isHls(u) {
  if (!u || typeof u !== 'string') return false;
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  // Reject private/loopback/link-local hostnames so a poisoned
  // upstream can't pivot the Pi onto its own LAN or cloud metadata.
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
  if (host === '169.254.169.254' || host.startsWith('169.254.')) return false;
  return /\.m3u8$/i.test(parsed.pathname);
}

async function extract(content, season, episode) {
  if (!(content.is_anime === 1 || content.type === 'anime')) throw new ExtractorError('miruro: anime only');
  const anilistId = content.anilist_id || await resolveAnilistId(content);
  if (!anilistId) throw new ExtractorError('miruro: no anilist id');
  const epNum = Math.max(1, parseInt(episode) || 1);

  const epData = await pipeOnce('episodes', { anilistId: String(anilistId) });
  const epList = epData?.episodes || epData?.data?.episodes || [];
  if (!epList.length) throw new ExtractorError('miruro: empty episode list');
  // Match by number; fall back to title similarity if needed.
  let target = epList.find(x => Number(x.number ?? x.episode_number) === epNum);
  if (!target && content.title) {
    target = epList.map(x => ({ x, s: similarity(content.title, x.title || '') })).sort((a, b) => b.s - a.s)[0]?.x;
  }
  if (!target?.id) throw new ExtractorError(`miruro: episode ${epNum} not found`);

  let universal = null;
  for (const provider of PROVIDERS) {
    try {
      const src = await pipeOnce('sources', { episodeId: target.id, provider, category: 'sub', anilistId: String(anilistId) });
      const u = src?.universalSource || src?.data?.universalSource || src;
      if (u?.streams?.length) { universal = u; break; }
    } catch { /* try next provider */ }
  }
  if (!universal?.streams?.length) throw new ExtractorError('miruro: no provider returned streams');

  const stream = universal.streams.find(s => s.type === 'hls' || isHls(s.url)) || universal.streams[0];
  if (!stream?.url || !isHls(stream.url)) throw new ExtractorError('miruro: no hls url in streams');

  const referer = stream.referer || ORIGIN + '/';
  const subtitles = (universal.subtitles || [])
    .filter(s => s?.file && (s.kind || '').toLowerCase() !== 'thumbnails')
    .map(s => ({ url: s.file, lang: s.label || s.lang || 'und', label: s.label || s.lang || 'Subtitles' }));

  return {
    stream_url: stream.url,
    headers: { 'Referer': referer, 'User-Agent': UA },
    subtitles
  };
}

module.exports = { extract, ExtractorError };

// Miruro deep links — turns the server's
//   https://www.miruro.tv/search?query=<title>#nstreams-anilist=<id>&ep=<n>&audio=<sub|dub>
// into https://www.miruro.tv/watch/<miruro id>?ep=<n> with the audio
// track preselected.
//
// This has to run inside miruro.tv: its catalog API is Cloudflare-gated
// against non-browser clients and sends no CORS headers, so neither the
// server nor the renderer can call it. We park the player on a tiny
// same-origin page (/health), do the lookup there, and write the per-show
// audio choice to the localStorage key Miruro's watch page reads
// (priver:anime → { <miruro id>: { language } }). If anything fails, the
// player falls back to the search URL so the user can still pick by hand.

const ORIGIN = 'https://www.miruro.tv';
const AUDIO = new Set(['sub', 'dub', 'ssub']);
const TIMEOUT_MS = 12000;

function parse(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'www.miruro.tv' && u.hostname !== 'miruro.tv') return null;
  const p = new URLSearchParams(u.hash.slice(1));
  const anilistId = parseInt(p.get('nstreams-anilist'), 10);
  if (!(anilistId > 0)) return null;
  const episode = Math.max(1, parseInt(p.get('ep'), 10) || 1);
  const audio = AUDIO.has(p.get('audio')) ? p.get('audio') : 'sub';
  u.hash = '';
  return { anilistId, episode, audio, fallbackUrl: u.toString() };
}

// Runs in the miruro.tv page. Catalog responses are gzip XOR'd with the
// key "miruro/catalog" (application/octet-stream); errors are plain JSON.
// Inputs are validated integers / enum values before interpolation.
function lookupScript({ anilistId, audio }) {
  return `(async () => {
    const r = await fetch('/api/v1/anime?anilist_id_in=${anilistId}&limit=100');
    if (!r.ok) throw new Error('catalog HTTP ' + r.status);
    let text;
    if ((r.headers.get('content-type') || '').startsWith('application/octet-stream')) {
      const key = new TextEncoder().encode('miruro/catalog');
      const b = new Uint8Array(await r.arrayBuffer());
      for (let i = 0; i < b.length; i++) b[i] ^= key[i % key.length];
      const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(s).text();
    } else {
      text = await r.text();
    }
    const hit = (JSON.parse(text).data || [])
      .find(a => (a.external_ids?.anilist || []).includes('${anilistId}'));
    if (!hit || !/^[A-Za-z0-9_-]{32}$/.test(hit.id)) return null;
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem('priver:anime') || '{}') || {}; } catch {}
    prefs[hit.id] = { ...(prefs[hit.id] || {}), language: '${audio}' };
    localStorage.setItem('priver:anime', JSON.stringify(prefs));
    return hit.id;
  })()`;
}

// Resolves a parsed link to the URL the player should load.
async function resolve(webContents, link) {
  try {
    await webContents.loadURL(`${ORIGIN}/health`);
    const id = await Promise.race([
      webContents.executeJavaScript(lookupScript(link), true),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS))
    ]);
    if (id) return `${ORIGIN}/watch/${id}?ep=${link.episode}`;
    console.warn('[miruro-link] no catalog entry for AniList', link.anilistId);
  } catch (e) {
    console.warn('[miruro-link] lookup failed:', e.message);
  }
  return link.fallbackUrl;
}

// loadURL that understands Miruro deep links; anything else loads as-is.
async function loadURL(webContents, url) {
  const link = parse(url);
  if (!link) return webContents.loadURL(url);
  return webContents.loadURL(await resolve(webContents, link));
}

module.exports = { parse, resolve, loadURL };

/**
 * Miruro deep links on Android — bridge to the native MiruroLink plugin
 * (android/app/src/main/java/com/ngames/nstreams/MiruroLinkPlugin.java).
 *
 * The server emits Miruro sources as a search URL carrying the AniList id,
 * episode and audio in the fragment (see PROVIDERS.miruro in
 * electron/server/scrapers.js). Desktop resolves it inside the player
 * (electron/miruro-link.js). Here the native plugin looks up Miruro's id so
 * the browser tab opens the exact episode. The audio can't be preset — the
 * tab is Chrome, whose storage the app can't write — so Miruro's own
 * per-show Audio choice applies.
 */
import { registerPlugin } from '@capacitor/core';

const MiruroLink = registerPlugin('MiruroLink');

export function parseMiruroLink(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'www.miruro.tv' && u.hostname !== 'miruro.tv') return null;
  const p = new URLSearchParams(u.hash.slice(1));
  const anilistId = parseInt(p.get('nstreams-anilist'), 10);
  if (!(anilistId > 0)) return null;
  const episode = Math.max(1, parseInt(p.get('ep'), 10) || 1);
  u.hash = '';
  return { anilistId, episode, fallbackUrl: u.toString() };
}

// The URL to hand the browser tab: the exact episode when the lookup works,
// Miruro's search results for the title when it doesn't, or `url` untouched
// when it isn't a Miruro deep link.
export async function androidPlayerUrl(url) {
  const link = parseMiruroLink(url);
  if (!link) return url;
  try {
    const { id } = await MiruroLink.resolve({ anilistId: link.anilistId });
    if (id) return `https://www.miruro.tv/watch/${id}?ep=${link.episode}`;
  } catch (e) {
    console.warn('[miruro] lookup failed:', e?.message || e);
  }
  return link.fallbackUrl;
}

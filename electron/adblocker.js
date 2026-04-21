// Ad + tracker blocking for Electron sessions.
// Uses @ghostery/adblocker-electron (the actively maintained fork of
// Cliqz's adblocker). Applied to the main app session + the persistent
// viewer session where streaming sites load.

const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const fs = require('fs');
const path = require('path');

let blocker = null;
let enabled = true;
const trackedSessions = new Set();

// Premium streaming services depend on tracking/ad domains for their
// login + playback flows (Amazon pulls auth from amazon-adsystem, Netflix
// ships code via nflxso, etc.). Adblock breaks them — we auto-skip for
// anything matching these hosts.
const PREMIUM_HOSTS = [
  'amazon.com', 'primevideo.com', 'amazon-adsystem.com', 'a2z.com', 'ssl-images-amazon.com', 'media-amazon.com',
  'netflix.com', 'nflximg.net', 'nflxext.com', 'nflxvideo.net', 'nflxso.net',
  'hulu.com', 'hulustream.com', 'huluim.com',
  'disneyplus.com', 'disney-plus.net', 'dssott.com', 'bamgrid.com',
  'max.com', 'play.max.com', 'hbomax.com',
  'crunchyroll.com', 'crunchyrollsvc.com',
  'peacocktv.com', 'nbc.com',
  'paramountplus.com', 'cbs.com', 'cbsaavideo.com',
  'tv.apple.com', 'apple.com', 'itunes.apple.com', 'mzstatic.com',
  'youtube.com', 'youtu.be', 'googlevideo.com', 'ytimg.com', 'ggpht.com',
  'tubitv.com', 'adrise.tv',
  'pluto.tv',
  'funimation.com', 'hidive.com'
];

function isPremiumUrl(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    return PREMIUM_HOSTS.some(p => h === p || h.endsWith('.' + p));
  } catch { return false; }
}

async function init(userDataPath) {
  if (blocker) return blocker;
  const cacheDir = path.join(userDataPath, 'adblocker-cache');
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch {}

  try {
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: path.join(cacheDir, 'engine.bin'),
      read: fs.promises.readFile,
      write: fs.promises.writeFile
    });
    console.log('[adblock] initialized');
    return blocker;
  } catch (e) {
    console.warn('[adblock] init failed, ads will NOT be blocked:', e.message);
    return null;
  }
}

function enableFor(session) {
  if (!blocker || !enabled) return false;
  try {
    blocker.enableBlockingInSession(session);
    trackedSessions.add(session);
    return true;
  } catch (e) {
    console.warn('[adblock] enable failed:', e.message);
    return false;
  }
}

function disable() {
  enabled = false;
  if (!blocker) return;
  for (const session of trackedSessions) {
    try { blocker.disableBlockingInSession(session); } catch {}
  }
}

function enable() {
  enabled = true;
  if (!blocker) return;
  for (const session of trackedSessions) {
    try { blocker.enableBlockingInSession(session); } catch {}
  }
}

function isEnabled() { return enabled && !!blocker; }

module.exports = { init, enableFor, disable, enable, isEnabled, isPremiumUrl };

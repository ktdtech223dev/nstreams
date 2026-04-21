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

module.exports = { init, enableFor, disable, enable, isEnabled };

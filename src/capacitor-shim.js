/**
 * N Streams — Capacitor (Android) shim for window.electron
 *
 * Provides the same interface that Electron injects via preload.js so every
 * existing React component keeps working without modification.
 *
 * Imported once at the top of main.jsx only when VITE_PLATFORM=android.
 */

import { Preferences } from '@capacitor/preferences';
import { Browser }     from '@capacitor/browser';
import { App }         from '@capacitor/app';

// ─── Persistent key-value store (replaces electron-store) ────────────────────
async function getStore(key) {
  const { value } = await Preferences.get({ key: String(key) });
  if (value === null || value === undefined) return undefined;
  try { return JSON.parse(value); } catch { return value; }
}

async function setStore(key, value) {
  await Preferences.set({ key: String(key), value: JSON.stringify(value) });
}

// ─── Active-user persistence ──────────────────────────────────────────────────
async function getActiveUser() {
  const { value } = await Preferences.get({ key: 'active_user_id' });
  return value ? JSON.parse(value) : 1;
}

async function setActiveUser(id) {
  await Preferences.set({ key: 'active_user_id', value: JSON.stringify(id) });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const noop        = () => {};
const noopAsync   = () => Promise.resolve();
const noopCleanup = () => noop; // returns a cleanup no-op (mirrors Electron event pattern)

// ─── Install shim ─────────────────────────────────────────────────────────────
window.electron = {
  // Store
  getStore,
  setStore,

  // User
  getActiveUser,
  setActiveUser,

  // Window controls — no-op on Android (system handles navigation)
  minimize: noop,
  maximize: noop,
  close: () => App.exitApp(),

  // Open URLs — use Capacitor browser on Android
  openUrl:           (url) => Browser.open({ url }),
  openBrowser:       (url) => Browser.open({ url }),
  openUserDataFolder: noop,

  // OAuth — deep links arrive via App.addListener('appUrlOpen') in App.jsx
  onOAuthCallback: noop,

  // Electron viewer / popup notifications — no-op on Android
  onPopupBlocked:    noopCleanup,
  onViewerEscaped:   noopCleanup,
  onRedirectBlocked: noopCleanup,

  // Ad blocker — not available on Android (returns disabled status)
  adblockStatus: () => Promise.resolve({ enabled: false, setting: false }),
  adblockToggle: () => Promise.resolve({ enabled: false }),

  // In-app viewer (Electron BrowserView) — not available on Android
  watchInApp:           noopAsync,
  viewerLinkedDomains:  () => Promise.resolve({}),
  clearViewerDomain:    () => Promise.resolve({ cleared: 0 }),
  clearViewerSession:   noopAsync,

  // App info / updates — surfaced from build-time env on Android
  getAppInfo: () => Promise.resolve({
    version:      import.meta.env.VITE_APP_VERSION || '—',
    platform:     'android',
    arch:         'arm64',
    apiPort:      null,
    userDataPath: null,
  }),
  onUpdateProgress:  noopCleanup,
  checkForUpdates:   () => Promise.resolve({ hasUpdate: false }),
  installUpdate:     noopAsync,

  // Watch-party IPC — not available on Android
  party: null,

  // apiPort — not used; API URL comes from VITE_API_URL env var
  apiPort: null,
};

console.log('[N Streams] Capacitor shim installed');

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

// ─── No-op event registrations (Electron-only features) ─────────────────────
const noop = () => {};

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

  // Player — open streaming URL in full-screen in-app browser
  // (App.jsx checks window.Capacitor and calls Browser.open directly;
  //  this stub is here in case anything calls openInBrowser via window.electron)
  openBrowser: (url) => Browser.open({ url }),

  // OAuth — deep links arrive via App.addListener('appUrlOpen')
  // Registered in App.jsx for Android
  onOAuthCallback: noop,

  // Electron-only notifications — no-op on Android
  onPopupBlocked:    noop,
  onViewerEscaped:   noop,
  onRedirectBlocked: noop,

  // Watch-party IPC — not available on Android
  party: null,

  // apiPort — not used; API URL comes from VITE_API_URL env var
  apiPort: null,
};

console.log('[N Streams] Capacitor shim installed');

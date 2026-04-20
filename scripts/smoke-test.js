#!/usr/bin/env node
// Smoke test: loads every main-process module to catch bad require paths,
// circular deps, missing files, etc. BEFORE we build a broken release.
// Runs inside Electron (to satisfy modules that `require('electron')`).

const path = require('path');
const Module = require('module');

const failures = [];
function tryLoad(name) {
  try {
    require(name);
    console.log('  ✓', name);
  } catch (e) {
    console.log('  ✗', name, '—', e.message);
    failures.push({ name, error: e.message });
  }
}

console.log('\nSmoke test — loading main-process modules:\n');

// Fake globals so viewer-preload (meant for a browser context) doesn't crash.
global.window = { location: { search: '' }, addEventListener: () => {} };
global.document = {
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ appendChild: () => {}, style: {}, addEventListener: () => {} }),
  documentElement: { appendChild: () => {} },
  getElementById: () => null,
  addEventListener: () => {},
  readyState: 'complete'
};
global.MutationObserver = class { observe() {} };
global.getComputedStyle = () => ({ visibility: 'visible' });

// Shim out `electron` import so this works from plain node too.
const tmp = require('os').tmpdir();
const Electron = {
  app: {
    getPath: () => tmp, getVersion: () => '0.0.0', getName: () => 'nstreams',
    on: () => {}, whenReady: () => Promise.resolve(), quit: () => {},
    requestSingleInstanceLock: () => true, setAsDefaultProtocolClient: () => {},
    commandLine: { appendSwitch: () => {} }
  },
  BrowserWindow: Object.assign(
    class { constructor() { this.webContents = { send: () => {}, executeJavaScript: async () => {} }; } on() {} loadURL() {} loadFile() {} focus() {} isMinimized() {} restore() {} isDestroyed() { return false; } },
    { getAllWindows: () => [], fromWebContents: () => null }
  ),
  shell: { openExternal: async () => {}, openPath: async () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  session: { fromPartition: () => ({ setUserAgent: () => {}, clearStorageData: async () => {}, cookies: { get: async () => [], remove: async () => {} } }) },
  dialog: { showErrorBox: () => {} },
  protocol: { registerSchemesAsPrivileged: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: {
    on: () => {},
    invoke: async () => {},
    send: () => {},
    // electron-store uses sendSync('electron-store-get-data') at import
    sendSync: () => ({ defaultCwd: tmp, appVersion: '0.0.0', appData: tmp, userData: tmp })
  }
};

// Intercept require('electron')
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (req === 'electron') return 'electron-shim';
  return origResolve.call(this, req, parent, ...rest);
};
require.cache['electron-shim'] = { id: 'electron-shim', filename: 'electron-shim', loaded: true, exports: Electron };

const root = path.join(__dirname, '..');
const modules = [
  'electron/main.js',
  'electron/preload.js',
  'electron/party.js',
  'electron/oauth.js',
  'electron/viewer-preload.js',
  'electron/server/index.js',
  'electron/server/database.js',
  'electron/server/tmdb.js',
  'electron/server/mal.js',
  'electron/server/anilist.js',
  'electron/server/deeplinks.js',
  'electron/server/routes/content.js',
  'electron/server/routes/watchlist.js',
  'electron/server/routes/users.js',
  'electron/server/routes/sites.js',
  'electron/server/routes/activity.js',
  'electron/server/routes/sessions.js',
  'electron/server/routes/sync.js'
];

for (const m of modules) tryLoad(path.join(root, m));

console.log('\nRelay:\n');
// Skip relay/index.js (has top-level side effect — starts listening)
tryLoad(path.join(root, 'relay/store.js'));

if (failures.length) {
  console.log(`\n✗ Smoke test FAILED — ${failures.length} broken module(s). Build is blocked.\n`);
  process.exit(1);
}

console.log('\n✓ Smoke test passed — all modules load cleanly.\n');

// Drop-in replacement for ./party.js used by stripped-down builds
// (currently: the Raspberry Pi `dist:pi` target). Exports the same API
// shape so all call sites in electron/main.js work unchanged — they
// just no-op.
//
// Selected at runtime in electron/main.js based on build-flags.json
// or the NSTREAMS_PI env var.

module.exports = {
  setWindows: () => {},
  registerIpc: () => {},
  disconnect: () => {}
};

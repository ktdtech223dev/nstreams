#!/usr/bin/env node
// Generates electron/build-flags.json before an electron-builder run.
// Usage: `node scripts/write-build-flags.js pi`  → writes { pi: true }
//        `node scripts/write-build-flags.js reset` → writes {}
//
// The file is .gitignore'd. electron/main.js reads it at startup to
// decide whether to load the full party subsystem or its no-op stub.

const fs = require('fs');
const path = require('path');

const arg = (process.argv[2] || '').toLowerCase();
const out = path.join(__dirname, '..', 'electron', 'build-flags.json');

const flags = {};
if (arg === 'pi') flags.pi = true;

fs.writeFileSync(out, JSON.stringify(flags, null, 2) + '\n');
console.log(`[write-build-flags] wrote ${out} ${JSON.stringify(flags)}`);

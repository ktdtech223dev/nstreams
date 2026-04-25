#!/usr/bin/env node
/**
 * One-time N Games bot profile setup.
 *
 * Sets the bot's:
 *   • Username  → "N Games"
 *   • Avatar    → Generated N Games logo (dark navy circle, white "N", indigo ring)
 *
 * Run once:  npm run setup   (or: node scripts/setup-bot.js)
 *
 * Discord rate-limits avatar changes to ~2 per 10 minutes on free bots.
 * Run this manually; the main bot never calls it at startup.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const zlib  = require('zlib');
const fetch = (...a) => import('node-fetch').then(m => m.default(...a));

// ─────────────────────────────────────────────────────────────────────────────
// Pure-Node PNG generator (zero extra deps)
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xFF];
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const tb  = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, crc]);
}

/**
 * makePNG(size, drawFn)
 * drawFn(x, y) → [r, g, b, a]  (each 0-255)
 * Returns a Buffer containing a valid RGBA PNG.
 */
function makePNG(size, drawFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA

  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter byte: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = drawFn(x, y);
      raw.push(
        Math.max(0, Math.min(255, r)),
        Math.max(0, Math.min(255, g)),
        Math.max(0, Math.min(255, b)),
        Math.max(0, Math.min(255, a)),
      );
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),        // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(raw), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// N Games logo — 512×512
//
//  ┌──────────────────────────────────────────────┐
//  │  Dark navy circle (#0f0f1a)                  │
//  │  Indigo ring (#6366f1), 10px, with highlight │
//  │                                              │
//  │          ██       ██                         │
//  │          ██ ██    ██                         │
//  │          ██   ██  ██                         │
//  │          ██     ████                         │
//  │          ██       ██                         │
//  │                                              │
//  └──────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────
function drawNGames(x, y) {
  const S   = 512;
  const cx  = S / 2, cy = S / 2;
  const R   = S / 2 - 3;           // outer radius (leaves 3px transparent edge for AA)
  const dx  = x - cx, dy  = y - cy;
  const d   = Math.sqrt(dx * dx + dy * dy);

  // ── Anti-aliased circle clip ──────────────────────────────────────────────
  if (d > R + 1) return [0, 0, 0, 0];
  // Soft outer AA (1px blend)
  const circleAlpha = d > R ? Math.round((R + 1 - d) * 255) : 255;

  // ── Indigo ring ───────────────────────────────────────────────────────────
  const ringOuter = R;
  const ringInner = R - 14;
  // 2px highlight at very outer edge of ring
  const hiliteInner = R - 3;
  if (d > ringInner) {
    let [r, g, b] = d > hiliteInner ? [140, 143, 255] : [99, 102, 241]; // #6366f1 / lighter
    return [r, g, b, circleAlpha];
  }

  // ── Inner background: dark navy #0f0f1a ──────────────────────────────────
  const BG = [15, 15, 26];

  // ── "N" geometry ─────────────────────────────────────────────────────────
  // Bounding box centered in circle:
  //   horizontal: x ∈ [126, 386]  (width = 260, centered at 256)
  //   vertical:   y ∈ [110, 402]  (height = 292, centered at 256)
  const NL  = 126, NR  = 386;   // left/right outer edge of the N
  const NT  = 110, NB  = 402;   // top/bottom
  const BW  = 52;               // bar width

  // Left bar
  const inLeftBar  = x >= NL && x <= NL + BW && y >= NT && y <= NB;
  // Right bar
  const inRightBar = x >= NR - BW && x <= NR && y >= NT && y <= NB;

  // Diagonal: from (NL, NT) → (NR, NB)
  // Line equation: (NB-NT)*(x-NL) - (NR-NL)*(y-NT) = 0
  //   = 292*(x-126) - 260*(y-110) = 0
  // Perpendicular distance = |292*(x-126) - 260*(y-110)| / sqrt(292²+260²)
  //                        = |...| / sqrt(85264+67600) = |...| / 391.1
  const diagNum  = 292 * (x - NL) - 260 * (y - NT);
  const diagDist = Math.abs(diagNum) / 391.1;
  const halfW    = 28;   // diagonal half-stroke (→ ~56px stroke width)
  // Only draw diagonal within the N's vertical span, but clip from left/right bars
  const inDiag   = diagDist <= halfW + 1 && y >= NT && y <= NB;

  // AA on diagonal edge (1px soft)
  if (inLeftBar || inRightBar) {
    return [255, 255, 255, circleAlpha];
  }
  if (inDiag) {
    const edgeAlpha = diagDist > halfW
      ? Math.round((halfW + 1 - diagDist) * circleAlpha)
      : circleAlpha;
    return [255, 255, 255, edgeAlpha];
  }

  return [...BG, circleAlpha];
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord REST upload
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌  DISCORD_TOKEN not found in .env');
    process.exit(1);
  }

  console.log('🎨  Generating N Games avatar (512×512)…');
  const t0  = Date.now();
  const png = makePNG(512, drawNGames);
  console.log(`    Generated ${png.length} bytes in ${Date.now() - t0}ms`);

  const b64 = `data:image/png;base64,${png.toString('base64')}`;

  console.log('📡  Uploading to Discord…');
  const res  = await fetch('https://discord.com/api/v10/users/@me', {
    method:  'PATCH',
    headers: {
      Authorization:  `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: 'N Games', avatar: b64 }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('❌  Discord API error:', JSON.stringify(data, null, 2));
    // Common: 429 rate limited, 50035 invalid asset
    if (data.code === 50035) console.error('    Hint: avatar may be too large or invalid format.');
    if (res.status === 429) console.error(`    Hint: rate limited — retry in ${data.retry_after}s`);
    process.exit(1);
  }

  console.log(`✅  Bot profile updated!`);
  console.log(`    Username : ${data.username}`);
  console.log(`    Avatar   : https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`);
  console.log();
  console.log('You can change the avatar at any time by editing drawNGames() and re-running npm run setup');
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});

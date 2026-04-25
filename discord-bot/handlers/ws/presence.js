// Handles `presence` WS events.
// Maintains a single pinned "Crew Status" message in the bot channel,
// updating it whenever presence changes (debounced 4s to batch rapid updates).
// The pinned message ID is persisted in data/state.json so bot restarts keep
// editing the same message instead of creating duplicates.

const fs      = require('fs');
const path    = require('path');
const discord = require('../../services/discord');

const DATA_DIR   = process.env.DATA_DIR
  || (fs.existsSync('/data') ? '/data' : path.join(__dirname, '..', '..'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ── State persistence ─────────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(patch) {
  try {
    const current = loadState();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...patch }, null, 2));
  } catch {}
}

// ── In-memory presence cache ──────────────────────────────────────────────────
// profile_id → { online, game_id }
const presenceCache = {};
let debounceTimer = null;

// ── Build and post/edit the status embed ─────────────────────────────────────
async function flushPresence(crew) {
  const members = crew || [];

  const lines = members.map(member => {
    const p      = presenceCache[member.id] || {};
    const online = p.online === true || p.online === 1;
    const game   = p.game_id ? ` · **${p.game_id}**` : '';
    const dot    = online ? '🟢' : '⚫';
    const suit   = member.suit || '';
    return `${dot} ${suit} **${member.name}**${online ? game : ''}`.trim();
  });

  // Also show anyone in the cache who isn't in the crew list (unlikely but safe)
  for (const [id, p] of Object.entries(presenceCache)) {
    if (!members.find(m => m.id === id) && (p.online === true || p.online === 1)) {
      lines.push(`🟢 **${id}** · ${p.game_id || ''}`);
    }
  }

  const onlineCount = Object.values(presenceCache).filter(p => p.online === true || p.online === 1).length;

  const embed = {
    color:       onlineCount > 0 ? 0x80e060 : 0x444455,
    title:       '👥 Crew Status',
    description: lines.join('\n') || 'No crew data.',
    footer:      { text: `${onlineCount} online · updates automatically` },
    timestamp:   new Date().toISOString(),
  };

  const state = loadState();

  if (state.presenceMsgId) {
    const ok = await discord.editMessage(state.presenceMsgId, null, { embeds: [embed] });
    if (ok) return; // done
    // Message was deleted — fall through to create a new one
  }

  // Create fresh message and try to pin it
  const msg = await discord.postAndReturn(embed);
  if (msg) {
    saveState({ presenceMsgId: msg.id });
    try { await msg.pin(); } catch {}
  }
}

module.exports = {
  type: 'presence',
  async handle(payload, { crew }) {
    if (!payload?.profile_id) return;

    presenceCache[payload.profile_id] = {
      online:  payload.online === true || payload.online === 1,
      game_id: payload.game_id || null,
    };

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => flushPresence(crew), 4_000);
  },
};

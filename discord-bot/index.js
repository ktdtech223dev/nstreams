// N Games Discord Bot — entry point
// Auto-discovers WS handlers from handlers/ws/ and slash commands from commands/
// so new features require only adding a file, not touching this file.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs      = require('fs');
const path    = require('path');
const discord = require('./services/discord');
const ws      = require('./services/ws-client');
const poller  = require('./services/github-poller');
const api     = require('./services/launcher-api');

// ── Load crew (refreshed on reconnect) ────────────────────────────────────────
let crew = [];
async function refreshCrew() {
  const data = await api.getCrew();
  if (data?.length) {
    crew = data;
    console.log(`[bot] loaded ${crew.length} crew members`);
  }
}

// ── Auto-load WS handlers ─────────────────────────────────────────────────────
const wsDir      = path.join(__dirname, 'handlers', 'ws');
const wsHandlers = {}; // type → handler

for (const file of fs.readdirSync(wsDir).filter(f => f.endsWith('.js'))) {
  const mod = require(path.join(wsDir, file));
  // A file can export an array (e.g. bet.js has bet_placed + bet_resolved)
  const list = Array.isArray(mod) ? mod : [mod];
  for (const h of list) {
    if (h.type) wsHandlers[h.type] = h;
    console.log(`[ws] registered handler: ${h.type}`);
  }
}

// ── Auto-load slash commands ──────────────────────────────────────────────────
const cmdDir   = path.join(__dirname, 'commands');
const commands = [];

for (const file of fs.readdirSync(cmdDir).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(cmdDir, file));
  commands.push(cmd);
  console.log(`[cmd] registered: /${cmd.data.name}`);
}

// ── Wire WS → handlers ───────────────────────────────────────────────────────
ws.on('*', (payload) => {
  if (!payload?.type) return;
  const handler = wsHandlers[payload.type];
  if (handler) {
    // Wrap in Promise.resolve so sync handlers (e.g. session-digest) don't throw
    Promise.resolve(handler.handle(payload, { crew })).catch(e =>
      console.error(`[ws] handler error (${payload.type}):`, e.message)
    );
  }
});

// ── Slash command interaction handler ─────────────────────────────────────────
discord.client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.find(c => c.data.name === interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction, { crew });
  } catch (e) {
    console.error(`[cmd] /${interaction.commandName} error:`, e.message);
    const msg = { content: '⚠ Something went wrong. Try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  // Validate env
  const required = ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'CHANNEL_BOT'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[bot] missing env vars:', missing.join(', '));
    process.exit(1);
  }

  // Connect Discord
  await discord.login();

  // Register slash commands
  await discord.registerCommands(commands);

  // Load crew then start WS
  await refreshCrew();
  ws.connect();

  // Re-load crew on WS reconnects (server may have updated)
  ws.on('ws_connected' /* not a real event, we fake it via open cb */, refreshCrew);

  // Start session digest hourly flush
  const sessionHandler = wsHandlers['session'];
  if (sessionHandler?.startDigestTimer) {
    sessionHandler.startDigestTimer(() => api.getCrew().then(d => d || crew));
  }

  // Start GitHub poller
  poller.start();

  console.log('[bot] ready');
}

boot().catch(e => {
  console.error('[bot] fatal boot error:', e);
  process.exit(1);
});

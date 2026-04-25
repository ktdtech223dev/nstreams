// Discord.js singleton client — imported by everything that needs to post.
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActivityType,
} = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let botChannelId = null;

client.once('ready', () => {
  console.log(`[discord] logged in as ${client.user.tag}`);
  // Set bot activity: "Playing N Games"
  client.user.setPresence({
    status: 'online',
    activities: [{ name: 'N Games', type: ActivityType.Playing }],
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────
async function login() {
  botChannelId = process.env.CHANNEL_BOT;

  // Register the ready promise BEFORE calling login() so we can never miss the event
  const readyPromise = new Promise(resolve => {
    if (client.isReady()) return resolve();
    client.once('ready', resolve);
  });

  await client.login(process.env.DISCORD_TOKEN);
  await readyPromise;
}

// ── Register guild slash commands ─────────────────────────────────────────────
async function registerCommands(commands) {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.DISCORD_GUILD_ID),
    { body: commands.map(c => c.data.toJSON()) }
  );
  console.log(`[discord] registered ${commands.length} slash commands`);
}

// ── Post an embed — returns the sent Message (or null on failure) ─────────────
async function post(embed, channelId) {
  const id = channelId || botChannelId;
  if (!id) return null;
  try {
    const channel = await client.channels.fetch(id);
    if (!channel?.isTextBased()) return null;
    return await channel.send({ embeds: [embed] });
  } catch (e) {
    console.warn('[discord] post failed:', e.message);
    return null;
  }
}

// Alias — callers that need the Message object use this name for clarity
const postAndReturn = post;

// ── Edit an existing message — returns true on success ────────────────────────
async function editMessage(messageId, channelId, content) {
  try {
    const id = channelId || botChannelId;
    const channel = await client.channels.fetch(id);
    if (!channel?.isTextBased()) return false;
    const msg = await channel.messages.fetch(messageId);
    if (!msg) return false;
    await msg.edit(content);
    return true;
  } catch {
    return false;
  }
}

module.exports = { client, login, registerCommands, post, postAndReturn, editMessage };

// GitHub Releases poller.
// Polls every 1 min with GITHUB_TOKEN, else every 8 min (unauthenticated limit safe).
// Stores last-seen tags in seen-tags.json so restarts don't re-announce old releases.
const fs   = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));

const repos   = require('../config/repos');
const embeds  = require('../embeds');
const discord = require('./discord');

// Persistence: follow same /data convention as the relay
const DATA_DIR  = process.env.DATA_DIR
  || (fs.existsSync('/data') ? '/data' : __dirname);
const TAGS_FILE = path.join(DATA_DIR, 'seen-tags.json');

function loadTags() {
  try { return JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8')); } catch { return {}; }
}
function saveTags(tags) {
  try { fs.writeFileSync(TAGS_FILE, JSON.stringify(tags, null, 2)); } catch {}
}

async function fetchLatestRelease(repo) {
  const headers = { 'User-Agent': 'nstreams-bot/1.0', 'Accept': 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null; // no releases yet
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function trimChangelog(body, maxLen = 2800) {
  if (!body) return null;
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + '\n\n…[see full changelog on GitHub]';
}

async function pollOnce(seenTags) {
  let changed = false;

  await Promise.all(repos.map(async (game) => {
    const release = await fetchLatestRelease(game.repo);
    if (!release?.tag_name) return;

    const tag     = release.tag_name;
    const prevTag = seenTags[game.id];

    if (prevTag === tag) return; // no change

    const isNew = !prevTag; // first time we've ever seen a release for this repo
    seenTags[game.id] = tag;
    changed = true;

    const version     = tag.replace(/^v/, '');
    const changelog   = trimChangelog(release.body);
    const downloadUrl = release.assets?.find(a => a.name.endsWith('.exe'))?.browser_download_url
                      || release.html_url;
    const htmlUrl     = release.html_url;

    const embed = embeds.releaseEmbed({ game, version, changelog, downloadUrl, htmlUrl, isNew });
    await discord.post(embed);
    console.log(`[poller] ${isNew ? 'new game' : 'update'} — ${game.name} ${tag}`);
  }));

  if (changed) saveTags(seenTags);
}

// On cold-start (no seen-tags.json), silently record the current latest
// release for every repo WITHOUT posting to Discord. This prevents the bot
// from re-announcing all existing releases every time Railway restarts.
async function seedSilently(seenTags) {
  await Promise.all(repos.map(async (game) => {
    const release = await fetchLatestRelease(game.repo);
    if (!release?.tag_name) return;
    seenTags[game.id] = release.tag_name;
    console.log(`[poller] seeded ${game.name} @ ${release.tag_name}`);
  }));
  saveTags(seenTags);
  console.log('[poller] cold-start seed complete — watching for new releases');
}

function start() {
  const hasToken    = !!process.env.GITHUB_TOKEN;
  const intervalMs  = hasToken ? 60_000 : 8 * 60_000; // 1 min or 8 min
  const seenTags    = loadTags();
  const isColdStart = Object.keys(seenTags).length === 0;

  console.log(`[poller] starting — polling every ${intervalMs / 1000}s (${hasToken ? 'authenticated' : 'unauthenticated'})`);

  if (isColdStart) {
    // No saved state — seed silently first, then begin regular polling
    console.log('[poller] no seen-tags found — seeding silently, will not re-announce existing releases');
    setTimeout(async () => {
      await seedSilently(seenTags);
      setInterval(() => pollOnce(seenTags), intervalMs);
    }, 10_000);
  } else {
    // Saved state exists — poll normally (only new tags will be announced)
    setTimeout(() => pollOnce(seenTags), 10_000);
    setInterval(() => pollOnce(seenTags), intervalMs);
  }
}

module.exports = { start };

// All Discord embed builders.
// Each returns a plain object (Discord API embed shape) — discord.js EmbedBuilder
// is not used so these are easily testable without a Discord connection.

const COLORS = {
  wall:        null,        // filled from crew member color per-post
  achievement: 0xffd700,   // gold
  session:     0x6366f1,   // indigo
  update:      0x3b82f6,   // blue
  newGame:     0x22c55e,   // green
  seasonEnd:   0xf59e0b,   // amber
  bet:         0xfb923c,   // orange
  nstreams:    0x9d5cff,   // purple
  error:       0xef4444,   // red
};

function ts() { return new Date().toISOString(); }
function hexToInt(hex) {
  return parseInt((hex || '#6366f1').replace('#', ''), 16);
}

// ── Wall post ────────────────────────────────────────────────────────────────
function wallPostEmbed({ post, crew }) {
  const member = (crew || []).find(c => c.id === post.profile_id) || {};
  const color  = hexToInt(member.color);
  const suit   = member.suit || '';
  const name   = post.name || member.name || 'Someone';

  const gameLabel = post.game_id
    ? (post.game_mode ? `${post.game_id} · ${post.game_mode}` : post.game_id)
    : null;

  const reactionStr = Object.entries(post.reactions || {})
    .filter(([, ids]) => ids.length > 0)
    .map(([emoji, ids]) => `${emoji} ${ids.length}`)
    .join('  ');

  return {
    color,
    author: { name: `${suit} ${name} posted on the wall`.trim() },
    description: post.content,
    footer: { text: ['N Games Wall', gameLabel, reactionStr].filter(Boolean).join(' · ') },
    timestamp: post.created_at
      ? new Date(post.created_at * 1000).toISOString()
      : ts(),
  };
}

// ── Achievement unlock ───────────────────────────────────────────────────────
function achievementEmbed({ payload, crew }) {
  const member = (crew || []).find(c => c.id === payload.profile_id) || {};
  const name   = member.name || payload.name || 'Someone';
  const ach    = payload.achievement || payload;
  const icon   = ach.icon || '🏆';
  const reward = ach.np_reward ? ` · **+${ach.np_reward} NP**` : '';

  return {
    color: COLORS.achievement,
    title: `${icon} Achievement Unlocked`,
    description: `**${name}** earned **${ach.name || 'an achievement'}**${reward}\n${ach.description || ''}`,
    footer: { text: 'N Games' },
    timestamp: ts(),
  };
}

// ── Session digest (hourly batch) ────────────────────────────────────────────
function sessionDigestEmbed({ sessions, crew }) {
  // sessions: [{ profile_id, game_id, score, outcome, game_mode }]
  if (!sessions.length) return null;

  const lines = sessions.map(s => {
    const member  = (crew || []).find(c => c.id === s.profile_id) || {};
    const suit    = member.suit || '';
    const name    = member.name || s.profile_id;
    const game    = s.game_id ? ` · ${s.game_id}` : '';
    const score   = s.score != null ? ` — score: **${s.score}**` : '';
    const outcome = s.outcome ? (s.outcome === 'win' ? ' ✅' : ' ❌') : '';
    return `${suit} **${name}**${game}${score}${outcome}`;
  });

  return {
    color: COLORS.session,
    title: '🎮 Session Recap',
    description: lines.join('\n'),
    footer: { text: 'N Games Activity' },
    timestamp: ts(),
  };
}

// ── Bet placed ───────────────────────────────────────────────────────────────
function betPlacedEmbed({ payload, crew }) {
  const bettor = (crew || []).find(c => c.id === payload.bettor_id) || {};
  const target = (crew || []).find(c => c.id === payload.target_id) || {};
  return {
    color: COLORS.bet,
    title: '💰 Bet Placed',
    description: `**${bettor.name || payload.bettor_id}** bet **${payload.amount} NP** that **${target.name || payload.target_id}** ${payload.condition || 'wins the next round'}`,
    footer: { text: 'N Games' },
    timestamp: ts(),
  };
}

// ── Bet resolved ─────────────────────────────────────────────────────────────
function betResolvedEmbed({ payload, crew }) {
  const winner = (crew || []).find(c => c.id === payload.winner_id) || {};
  return {
    color: payload.outcome === 'win' ? COLORS.achievement : COLORS.session,
    title: payload.outcome === 'win' ? '🏆 Bet Won' : '💸 Bet Lost',
    description: `**${winner.name || payload.winner_id}** ${payload.outcome === 'win' ? 'won' : 'lost'} a bet of **${payload.amount} NP**`,
    footer: { text: 'N Games' },
    timestamp: ts(),
  };
}

// ── Season end ceremony ──────────────────────────────────────────────────────
function seasonEndEmbed({ payload, crew }) {
  const standings = (payload.standings || []).map((entry, i) => {
    const member = (crew || []).find(c => c.id === entry.profile_id) || {};
    const medal  = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    return `${medal} **${member.name || entry.profile_id}** — ${entry.score ?? entry.np ?? 0} NP`;
  });

  return {
    color: COLORS.seasonEnd,
    title: `🏁 Season ${payload.season_number || ''} — Final Standings`,
    description: standings.join('\n') || 'No standings data.',
    footer: { text: `N Games · Season ${payload.season_number || ''}` },
    timestamp: ts(),
  };
}

// ── GitHub release / update ──────────────────────────────────────────────────
function releaseEmbed({ game, version, changelog, downloadUrl, htmlUrl, isNew }) {
  const title = isNew
    ? `🆕 New Game — ${game.name}`
    : `🔧 Update — ${game.name} v${version}`;

  const fields = [];
  if (downloadUrl && downloadUrl !== htmlUrl) {
    fields.push({ name: 'Download', value: `[⬇ ${game.name}-${version}.exe](${downloadUrl})`, inline: true });
  }
  fields.push({ name: 'Release page', value: `[↗ GitHub](${htmlUrl})`, inline: true });

  return {
    color: isNew ? COLORS.newGame : game.color || COLORS.update,
    title,
    description: changelog || '_No changelog provided._',
    fields,
    footer: { text: 'N Games Updates' },
    timestamp: ts(),
  };
}

// ── N Streams activity (from webhook, mirrored embed shape) ──────────────────
// These match what electron/server/discord.js sends — defined here for reference
// but the actual firing happens in the Electron app, not the bot.

// ── Title unlocked ───────────────────────────────────────────────────────────
function titleUnlockedEmbed({ payload, crew }) {
  const member = (crew || []).find(c => c.id === payload.profile_id) || {};
  return {
    color: COLORS.achievement,
    title: '✨ Title Unlocked',
    description: `**${member.name || payload.profile_id}** earned the title **"${payload.title || ''}"**`,
    footer: { text: 'N Games' },
    timestamp: ts(),
  };
}

// ── Challenge complete ────────────────────────────────────────────────────────
function challengeCompleteEmbed({ payload, crew }) {
  const member = (crew || []).find(c => c.id === payload.profile_id) || {};
  const ch = payload.challenge || payload;
  return {
    color: COLORS.achievement,
    title: `${ch.type === 'daily' ? '📅' : '📆'} ${ch.type === 'daily' ? 'Daily' : 'Weekly'} Challenge Complete`,
    description: `**${member.name || payload.profile_id}** completed **${ch.name || 'a challenge'}**${ch.np_reward ? ` · **+${ch.np_reward} NP**` : ''}`,
    footer: { text: 'N Games' },
    timestamp: ts(),
  };
}

// ── N Streams /watchlist command ─────────────────────────────────────────────
function nstreamsWatchlistEmbed({ user, rows, statusFilter }) {
  const watching      = rows.filter(r => r.watch_status === 'watching');
  const completed     = rows.filter(r => r.watch_status === 'completed');
  const planToWatch   = rows.filter(r => r.watch_status === 'plan_to_watch');

  function fmt(list, max = 8) {
    if (!list.length) return '_Nothing here yet_';
    return list.slice(0, max)
      .map(r => {
        let line = `• ${r.title}`;
        if (r.watch_status === 'watching' && r.current_episode > 0) {
          line += ` *(S${r.current_season || 1} E${r.current_episode})*`;
        }
        if (r.user_rating) line += ` ★ ${r.user_rating}`;
        return line;
      })
      .join('\n') + (list.length > max ? `\n_…and ${list.length - max} more_` : '');
  }

  const fields = [];
  if (!statusFilter || statusFilter === 'watching') {
    fields.push({ name: `📺 Watching (${watching.length})`, value: fmt(watching), inline: false });
  }
  if (!statusFilter || statusFilter === 'completed') {
    fields.push({ name: `✅ Completed (${completed.length})`, value: fmt(completed), inline: false });
  }
  if (!statusFilter || statusFilter === 'plan_to_watch') {
    fields.push({ name: `🗒 Plan to Watch (${planToWatch.length})`, value: fmt(planToWatch), inline: false });
  }

  return {
    color:  COLORS.nstreams,
    author: { name: `${user.display_name || user.username}'s Watchlist` },
    fields,
    footer: { text: 'N Streams' },
    timestamp: ts(),
  };
}

// ── N Streams /top5 command ──────────────────────────────────────────────────
function nstreamsTop5Embed({ user, rows }) {
  const rated = rows
    .filter(r => r.user_rating > 0)
    .sort((a, b) => b.user_rating - a.user_rating)
    .slice(0, 5);

  const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const desc = rated.length
    ? rated.map((r, i) => `${MEDALS[i]} **${r.title}** — ★ ${r.user_rating}/10`).join('\n')
    : '_No ratings yet._';

  return {
    color:       COLORS.nstreams,
    title:       `⭐ ${user.display_name || user.username}'s Top 5`,
    description: desc,
    footer:      { text: 'N Streams' },
    timestamp:   ts(),
  };
}

module.exports = {
  wallPostEmbed,
  achievementEmbed,
  sessionDigestEmbed,
  betPlacedEmbed,
  betResolvedEmbed,
  seasonEndEmbed,
  releaseEmbed,
  titleUnlockedEmbed,
  challengeCompleteEmbed,
  nstreamsWatchlistEmbed,
  nstreamsTop5Embed,
};

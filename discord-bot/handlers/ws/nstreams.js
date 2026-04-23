/**
 * Handles `nstreams_activity` WS events from the Launcher server.
 *
 * N Streams reports viewing milestones (started watching, season finale,
 * series completion, ratings) to the Launcher via POST /nstreams/activity.
 * The Launcher relays them here as WS broadcasts. We turn them into purple
 * Discord embeds posted to the crew's bot channel.
 */

const { post } = require('../../services/discord');

const PURPLE = 0x9d5cff;

function base(ts) {
  return {
    color:     PURPLE,
    footer:    { text: 'N Streams' },
    timestamp: ts ? new Date(ts).toISOString() : new Date().toISOString(),
  };
}

const TEMPLATES = {
  started_watching({ user_name, content_title, content_type, ts }) {
    return {
      ...base(ts),
      title:       content_type === 'movie'
        ? `🎬 ${user_name} is watching`
        : `📺 ${user_name} started watching`,
      description: `**${content_title}**`,
    };
  },

  season_finale({ user_name, content_title, season, ts }) {
    return {
      ...base(ts),
      title:       `✅ ${user_name} finished a season`,
      description: `**${content_title}** — Season ${season}`,
    };
  },

  completed({ user_name, content_title, total_episodes, ts }) {
    return {
      ...base(ts),
      title:       `🎉 ${user_name} finished!`,
      description: total_episodes
        ? `**${content_title}** (${total_episodes} eps)`
        : `**${content_title}**`,
    };
  },

  rated({ user_name, content_title, rating, ts }) {
    const stars = '⭐'.repeat(Math.min(Math.round(rating / 2), 5));
    return {
      ...base(ts),
      title:       `⭐ ${user_name} rated`,
      description: `**${content_title}** — ${rating}/10 ${stars}`.trim(),
    };
  },
};

module.exports = {
  type: 'nstreams_activity',

  async handle(payload) {
    const template = TEMPLATES[payload.event_type];
    if (!template) return; // unknown event type — ignore

    const embed = template(payload);

    // Attach poster thumbnail when available
    if (payload.poster_path) {
      embed.thumbnail = {
        url: `https://image.tmdb.org/t/p/w200${payload.poster_path}`,
      };
    }

    await post(embed);
  },
};

/**
 * Handles `nstreams_activity` WS events from the Launcher server.
 *
 * N Streams reports viewing milestones (started watching, season finale,
 * series completion, ratings) to the Launcher via POST /nstreams/activity.
 * The Launcher relays them here as WS broadcasts. We turn them into simple
 * one-line purple embeds posted to the crew's bot channel.
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
  started_watching({ user_name, content_title, content_type, release_year, ts }) {
    const isMovie = content_type === 'movie';
    const yearStr = isMovie && release_year ? ` (${release_year})` : '';
    return {
      ...base(ts),
      description: isMovie
        ? `🎬 **${user_name}** started a movie: ${content_title}${yearStr}`
        : `📺 **${user_name}** Started a New Show: ${content_title}`,
    };
  },

  season_finale({ user_name, content_title, season, ts }) {
    return {
      ...base(ts),
      description: `✅ **${user_name}** completed Season ${season} of ${content_title}!`,
    };
  },

  completed({ user_name, content_title, ts }) {
    return {
      ...base(ts),
      description: `🎉 **${user_name}** finished ${content_title}`,
    };
  },

  rated({ user_name, content_title, rating, ts }) {
    return {
      ...base(ts),
      description: `⭐ **${user_name}** rated ${content_title} — ${rating}/10`,
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

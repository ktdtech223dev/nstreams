// Batches game session events and posts an hourly digest.
// Avoids spamming the channel for every individual run.
const embeds  = require('../../embeds');
const discord = require('../../services/discord');

const batch = []; // { profile_id, game_id, score, outcome, game_mode }

// Post digest if there's anything in the batch
async function flush(crew) {
  if (!batch.length) return;
  const toPost = batch.splice(0);
  const embed  = embeds.sessionDigestEmbed({ sessions: toPost, crew });
  if (embed) await discord.post(embed);
}

// Start the hourly flush timer (called from index.js after crew is loaded)
function startDigestTimer(getCrewFn) {
  setInterval(async () => {
    const crew = await getCrewFn();
    await flush(crew || []);
  }, 60 * 60 * 1000); // every hour
}

module.exports = {
  type: 'session',
  handle(payload) {
    // Collect into batch — flush happens hourly
    batch.push({
      profile_id: payload.profile_id,
      game_id:    payload.game_id,
      score:      payload.score ?? null,
      outcome:    payload.outcome ?? null,
      game_mode:  payload.game_mode ?? null,
    });
  },
  startDigestTimer,
};

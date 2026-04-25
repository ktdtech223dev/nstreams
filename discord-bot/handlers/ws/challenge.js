const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = {
  type: 'challenge_complete',
  async handle(payload, { crew }) {
    const embed = embeds.challengeCompleteEmbed({ payload, crew });
    await discord.post(embed);
  },
};

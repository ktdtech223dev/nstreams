const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = {
  type: 'achievement_unlock',
  async handle(payload, { crew }) {
    const embed = embeds.achievementEmbed({ payload, crew });
    await discord.post(embed);
  },
};

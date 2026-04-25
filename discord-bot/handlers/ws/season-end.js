const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = {
  type: 'season_end',
  async handle(payload, { crew }) {
    const embed = embeds.seasonEndEmbed({ payload, crew });
    await discord.post(embed);
  },
};

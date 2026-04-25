const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = {
  type: 'title_unlocked',
  async handle(payload, { crew }) {
    const embed = embeds.titleUnlockedEmbed({ payload, crew });
    await discord.post(embed);
  },
};

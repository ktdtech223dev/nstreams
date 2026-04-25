const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = [
  {
    type: 'bet_placed',
    async handle(payload, { crew }) {
      const embed = embeds.betPlacedEmbed({ payload, crew });
      await discord.post(embed);
    },
  },
  {
    type: 'bet_resolved',
    async handle(payload, { crew }) {
      const embed = embeds.betResolvedEmbed({ payload, crew });
      await discord.post(embed);
    },
  },
];

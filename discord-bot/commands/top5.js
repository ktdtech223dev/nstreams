const { SlashCommandBuilder } = require('discord.js');
const api    = require('../services/launcher-api');
const embeds = require('../embeds');

const CREW_NAMES = ['keshawn', 'sean', 'dart', 'amari', 'arisa', 'tyheim'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('top5')
    .setDescription("See a crew member's top 5 rated shows/movies on N Streams")
    .addStringOption(o => o
      .setName('crew')
      .setDescription('Crew member name (keshawn, sean, dart, amari, arisa, tyheim)')
      .setRequired(true)
      .addChoices(...CREW_NAMES.map(n => ({ name: n, value: n })))),

  async execute(interaction) {
    await interaction.deferReply();

    const username = interaction.options.getString('crew');
    const result   = await api.getNStreamsWatchlist(username, { sort: 'rating' });

    if (!result) {
      return interaction.editReply(
        `❌ Couldn't find **${username}**'s data. They may not be synced to the cloud yet.`
      );
    }

    const { user, rows } = result;
    const embed = embeds.nstreamsTop5Embed({ user, rows });
    await interaction.editReply({ embeds: [embed] });
  },
};

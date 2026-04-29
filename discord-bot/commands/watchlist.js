const { SlashCommandBuilder } = require('discord.js');
const api    = require('../services/launcher-api');
const embeds = require('../embeds');

const CREW_NAMES = ['keshawn', 'sean', 'dart', 'amari', 'arisa', 'tyheim'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription("See a crew member's N Streams watchlist")
    .addStringOption(o => o
      .setName('crew')
      .setDescription('Crew member name (keshawn, sean, dart, amari, arisa, tyheim)')
      .setRequired(true)
      .addChoices(...CREW_NAMES.map(n => ({ name: n, value: n }))))
    .addStringOption(o => o
      .setName('filter')
      .setDescription('Filter by status')
      .addChoices(
        { name: 'All',           value: 'all' },
        { name: 'Watching',      value: 'watching' },
        { name: 'Completed',     value: 'completed' },
        { name: 'Plan to Watch', value: 'plan_to_watch' },
      )),

  async execute(interaction) {
    await interaction.deferReply();

    const username = interaction.options.getString('crew');
    const filter   = interaction.options.getString('filter') || 'all';

    const result = await api.getNStreamsWatchlist(username);
    if (!result) {
      return interaction.editReply(
        `❌ Couldn't find **${username}**'s watchlist. They may not be synced to the cloud yet.`
      );
    }

    const { user, rows } = result;
    const statusFilter   = filter === 'all' ? null : filter;

    const embed = embeds.nstreamsWatchlistEmbed({ user, rows, statusFilter });
    await interaction.editReply({ embeds: [embed] });
  },
};

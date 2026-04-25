const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const api = require('../services/launcher-api');

const CREW_CHOICES = [
  { name: 'Keshawn', value: 'keshawn' },
  { name: 'Sean',    value: 'sean'    },
  { name: 'Dart',    value: 'dart'    },
  { name: 'Amari',   value: 'amari'   },
  { name: 'Ari',     value: 'arisa'   },
  { name: 'Tyheim',  value: 'tyheim'  },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show a crew member\'s stats')
    .addStringOption(o => o
      .setName('player')
      .setDescription('Crew member')
      .setRequired(true)
      .addChoices(...CREW_CHOICES)),

  async execute(interaction, { crew }) {
    await interaction.deferReply();
    const playerId = interaction.options.getString('player');
    const member   = (crew || []).find(c => c.id === playerId);
    const stats    = await api.getStats(playerId);

    if (!stats) {
      return interaction.editReply(`Couldn't load stats for **${member?.name ?? playerId}**. The server may not have this endpoint yet.`);
    }

    const color = parseInt((member?.color || '#6366f1').replace('#', ''), 16);

    const fields = [];
    if (stats.level)     fields.push({ name: 'Level',    value: `${stats.level}`,    inline: true });
    if (stats.np != null) fields.push({ name: 'NP',       value: `${stats.np}`,       inline: true });
    if (stats.xp != null) fields.push({ name: 'XP',       value: `${stats.xp}`,       inline: true });
    if (stats.wins != null) fields.push({ name: 'Wins',   value: `${stats.wins}`,     inline: true });
    if (stats.losses != null) fields.push({ name: 'Losses', value: `${stats.losses}`, inline: true });
    if (stats.title)     fields.push({ name: 'Title',    value: stats.title,          inline: true });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${member?.suit ?? ''} ${member?.name ?? playerId} — Stats`.trim())
      .addFields(fields.length ? fields : [{ name: '\u200b', value: 'No detailed stats available.' }])
      .setFooter({ text: 'N Games' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

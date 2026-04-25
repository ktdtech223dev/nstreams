const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const api = require('../services/launcher-api');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('challenges')
    .setDescription('Show today\'s daily & this week\'s weekly challenge'),

  async execute(interaction, { crew }) {
    await interaction.deferReply();
    const data = await api.getChallenges();

    if (!data) {
      return interaction.editReply('Challenge data not available right now.');
    }

    const challenges = Array.isArray(data) ? data : [data.daily, data.weekly].filter(Boolean);
    if (!challenges.length) {
      return interaction.editReply('No active challenges right now.');
    }

    const fields = challenges.map(ch => ({
      name:   `${ch.type === 'daily' ? '📅 Daily' : '📆 Weekly'} — ${ch.name ?? 'Challenge'}`,
      value:  [
        ch.description ?? '',
        ch.np_reward ? `Reward: **${ch.np_reward} NP**` : '',
        ch.progress_label ?? '',
      ].filter(Boolean).join('\n') || '—',
      inline: false,
    }));

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('🎯 Active Challenges')
      .addFields(fields)
      .setFooter({ text: 'N Games' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

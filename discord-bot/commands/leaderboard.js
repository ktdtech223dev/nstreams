const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const api   = require('../services/launcher-api');
const repos = require('../config/repos');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the N Games leaderboard')
    .addStringOption(o => o
      .setName('game')
      .setDescription('Filter by game (leave blank for overall)')
      .addChoices(...repos.map(r => ({ name: r.name, value: r.id })))),

  async execute(interaction, { crew }) {
    await interaction.deferReply();
    const gameId = interaction.options.getString('game') ?? null;
    const data   = await api.getLeaderboard(gameId);

    if (!data) {
      return interaction.editReply('Leaderboard not available right now.');
    }

    const entries = Array.isArray(data) ? data : data.entries ?? [];
    const lines   = entries.slice(0, 10).map((entry, i) => {
      const member = (crew || []).find(c => c.id === (entry.profile_id || entry.id)) || {};
      const medal  = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
      const score  = entry.score ?? entry.np ?? entry.wins ?? '—';
      return `${medal} ${member.suit ?? ''} **${member.name ?? entry.profile_id}** — ${score}`;
    });

    const gameLabel = gameId ? (repos.find(r => r.id === gameId)?.name ?? gameId) : 'All Games';

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`🏆 Leaderboard — ${gameLabel}`)
      .setDescription(lines.join('\n') || 'No entries yet.')
      .setFooter({ text: 'N Games' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const api = require('../services/launcher-api');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('season')
    .setDescription('Show the current season standings'),

  async execute(interaction, { crew }) {
    await interaction.deferReply();
    const data = await api.getSeason();

    if (!data) {
      return interaction.editReply('Season data not available right now.');
    }

    const standings = (data.standings || data.leaderboard || []).slice(0, 10);
    const lines = standings.map((entry, i) => {
      const member = (crew || []).find(c => c.id === (entry.profile_id || entry.id)) || {};
      const medal  = ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;
      const score  = entry.score ?? entry.np ?? '—';
      return `${medal} ${member.suit ?? ''} **${member.name ?? entry.profile_id}** — ${score}`;
    });

    const daysLeft = data.days_remaining ?? null;
    const footer = ['N Games', daysLeft != null ? `${daysLeft} days remaining` : null]
      .filter(Boolean).join(' · ');

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`🏆 Season ${data.season_number ?? ''} Standings`.trim())
      .setDescription(lines.join('\n') || 'No standings yet.')
      .setFooter({ text: footer })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

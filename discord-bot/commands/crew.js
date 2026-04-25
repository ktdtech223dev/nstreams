const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const api = require('../services/launcher-api');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('crew')
    .setDescription('See who\'s online and what they\'re playing'),

  async execute(interaction, { crew }) {
    await interaction.deferReply();
    const presence = await api.getPresence();

    if (!presence) {
      return interaction.editReply('Could not reach the N Games server right now.');
    }

    const lines = (crew || []).map(member => {
      const p      = presence.find(r => r.profile_id === member.id);
      const online = p?.online === 1;
      const game   = p?.game_id ? ` · ${p.game_id}` : '';
      const dot    = online ? '🟢' : '⚫';
      return `${dot} ${member.suit} **${member.name}**${online ? game : ' — offline'}`;
    });

    const online = presence.filter(p => p.online === 1).length;

    const embed = new EmbedBuilder()
      .setColor(online > 0 ? 0x80e060 : 0x444444)
      .setTitle('👥 Crew Status')
      .setDescription(lines.join('\n') || 'No crew data.')
      .setFooter({ text: `${online} online` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

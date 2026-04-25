const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the N Games bot is alive'),

  async execute(interaction) {
    const sent = await interaction.deferReply({ fetchReply: true });
    const ms   = sent.createdTimestamp - interaction.createdTimestamp;

    const embed = new EmbedBuilder()
      .setColor(0x80e060)
      .setTitle('🏓 Pong!')
      .addFields(
        { name: 'Roundtrip',   value: `${ms}ms`,                                     inline: true },
        { name: 'API latency', value: `${Math.round(interaction.client.ws.ping)}ms`, inline: true },
      )
      .setFooter({ text: 'N Games Bot' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

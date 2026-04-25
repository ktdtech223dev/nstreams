const { SlashCommandBuilder } = require('discord.js');
const api     = require('../services/launcher-api');
const embeds  = require('../embeds');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wall')
    .setDescription('Show the latest N Games crew wall posts')
    .addIntegerOption(o => o
      .setName('count')
      .setDescription('Number of posts to show (default 5, max 10)')
      .setMinValue(1).setMaxValue(10)),

  async execute(interaction, { crew }) {
    await interaction.deferReply();
    const count = interaction.options.getInteger('count') ?? 5;
    const posts = await api.getWall(count);

    if (!posts?.length) {
      return interaction.editReply('No wall posts found.');
    }

    const embedList = posts.slice(0, count).map(post => embeds.wallPostEmbed({ post, crew }));
    await interaction.editReply({ embeds: embedList.slice(0, 10) }); // Discord max 10 embeds
  },
};

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const COMMANDS = [
  { name: '/ping',        desc: 'Check if the bot is alive and see latency' },
  { name: '/crew',        desc: 'See who\'s online and what they\'re playing right now' },
  { name: '/wall',        desc: 'Show the latest N Games crew wall posts' },
  { name: '/stats',       desc: 'View a crew member\'s level, NP, wins and more' },
  { name: '/leaderboard', desc: 'Show the overall or per-game leaderboard' },
  { name: '/challenges',  desc: 'Show today\'s daily and this week\'s weekly challenge' },
  { name: '/season',      desc: 'Show the current season standings' },
  { name: '/help',        desc: 'Show this help message' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all N Games bot commands'),

  async execute(interaction) {
    const lines = COMMANDS.map(c => `**${c.name}** — ${c.desc}`);

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle('♠ N Games Bot — Commands')
      .setDescription(lines.join('\n'))
      .addFields({
        name:   '📡 Live updates',
        value:  'Wall posts, achievements, game updates, season finales and crew activity post here automatically — no command needed.',
        inline: false,
      })
      .setFooter({ text: 'N Games' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

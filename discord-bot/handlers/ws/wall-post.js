const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = {
  type: 'wall_post',
  async handle(payload, { crew }) {
    const post = payload.post || payload;
    if (!post?.content) return;
    const embed = embeds.wallPostEmbed({ post, crew });
    await discord.post(embed);
  },
};

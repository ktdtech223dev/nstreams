const embeds  = require('../../embeds');
const discord = require('../../services/discord');

module.exports = {
  type: 'wall_post',
  async handle(payload, { crew }) {
    const post = payload.post || payload;
    if (!post?.content) return;
    const embed = embeds.wallPostEmbed({ post, crew });
    // Pass @everyone through as the message content so Discord actually pings
    const everyoneContent = post.content.includes('@everyone') ? '@everyone' : undefined;
    await discord.post(embed, null, everyoneContent);
  },
};

export default {
  name: "ping",
  description: "Check the bot's latency.",
  module: "general",
  aliases: ["latency"],
  async execute(ctx) {
    const latency = Date.now() - ctx.source.createdTimestamp;
    await ctx.reply(`Pong! \`${latency}ms\` · WebSocket \`${Math.round(ctx.client.ws.ping)}ms\``);
  },
};

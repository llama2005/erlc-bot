import { EmbedBuilder } from "discord.js";
import { COLORS, EMOJI } from "../../lib/style.js";

export default {
  name: "ping",
  description: "Check the bot's latency.",
  module: "general",
  aliases: ["latency"],
  async execute(ctx) {
    const latency = Date.now() - ctx.source.createdTimestamp;
    const ws = Math.round(ctx.client.ws.ping);
    const dot = latency < 300 ? EMOJI.online : latency < 700 ? EMOJI.idle : EMOJI.offline;
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setDescription(`${dot} **Pong!**`)
          .addFields(
            { name: "Round-trip", value: `\`${latency}ms\``, inline: true },
            { name: "WebSocket", value: `\`${ws}ms\``, inline: true },
          ),
      ],
    });
  },
};

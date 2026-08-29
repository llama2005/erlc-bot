import os from "node:os";
import { EmbedBuilder, version as djsVersion } from "discord.js";
import { COLORS } from "../../lib/style.js";
import { formatDuration } from "../../lib/util.js";

export default {
  name: "about",
  description: "Information about the bot.",
  module: "general",
  aliases: ["info", "botinfo"],
  async execute(ctx) {
    const c = ctx.client;
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: c.user.username, iconURL: c.user.displayAvatarURL() })
      .setDescription("A modular ER:LC + Discord moderation bot with shifts, case logging, and a Claude-powered assistant.")
      .addFields(
        { name: "Servers", value: `${c.guilds.cache.size}`, inline: true },
        { name: "Users", value: `${c.users.cache.size}`, inline: true },
        { name: "Uptime", value: formatDuration(c.uptime), inline: true },
        { name: "WebSocket", value: `${Math.round(c.ws.ping)}ms`, inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "discord.js", value: `v${djsVersion}`, inline: true },
        { name: "Host", value: `${os.type()} ${os.arch()} · ${os.cpus().length} cores`, inline: false },
      );
    await ctx.reply({ embeds: [embed] });
  },
};

import os from "node:os";
import { EmbedBuilder, version as djsVersion } from "discord.js";
import { config } from "../../config.js";
import { COLORS } from "../../lib/style.js";
import { formatDuration } from "../../lib/util.js";

const inviteUrl = (clientId) =>
  `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=1101927862502`;

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
      .setDescription("A modular ER:LC + Discord moderation bot with shifts, case logging, and an AI assistant.")
      .addFields(
        { name: "Servers", value: `${c.guilds.cache.size}`, inline: true },
        { name: "Users", value: `${c.users.cache.size}`, inline: true },
        { name: "Uptime", value: formatDuration(c.uptime), inline: true },
        { name: "WebSocket", value: `${Math.round(c.ws.ping)}ms`, inline: true },
        { name: "Node", value: process.version, inline: true },
        { name: "discord.js", value: `v${djsVersion}`, inline: true },
        { name: "Host", value: `${os.type()} ${os.arch()} · ${os.cpus().length} cores`, inline: false },
      );

    const dash = (config.links.dashboard || "").replace(/\/$/, "");
    const links = [
      `[Invite](${inviteUrl(c.user.id)})`,
      dash && `[Dashboard](${dash})`,
      dash && `[Setup guide](${dash}/guide)`,
      config.links.support && `[Support](${config.links.support})`,
      dash && `[Privacy](${dash}/privacy)`,
      dash && `[Terms](${dash}/terms)`,
    ].filter(Boolean);
    if (links.length) embed.addFields({ name: "Links", value: links.join(" · ") });

    await ctx.reply({ embeds: [embed] });
  },
};

import { EmbedBuilder, time, ChannelType } from "discord.js";
import { COLORS } from "../../lib/style.js";

export default {
  name: "serverinfo",
  description: "Info about this Discord server.",
  module: "utility",
  guildOnly: true,
  defer: true,
  aliases: ["guildinfo"],
  async execute(ctx) {
    const g = ctx.guild;
    const channels = g.channels.cache;
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: g.name, iconURL: g.iconURL() ?? undefined })
      .setThumbnail(g.iconURL({ size: 256 }))
      .addFields(
        { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
        { name: "Created", value: time(g.createdAt, "R"), inline: true },
        { name: "Members", value: String(g.memberCount), inline: true },
        { name: "Roles", value: String(g.roles.cache.size), inline: true },
        { name: "Text channels", value: String(channels.filter((c) => c.type === ChannelType.GuildText).size), inline: true },
        { name: "Voice channels", value: String(channels.filter((c) => c.type === ChannelType.GuildVoice).size), inline: true },
        { name: "Boosts", value: `${g.premiumSubscriptionCount ?? 0} (tier ${g.premiumTier})`, inline: true },
        { name: "Emojis", value: String(g.emojis.cache.size), inline: true },
        { name: "ID", value: `\`${g.id}\``, inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  },
};

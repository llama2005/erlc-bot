import { EmbedBuilder, time } from "discord.js";
import { COLORS } from "../../lib/style.js";
import { getLinkByDiscord } from "../../lib/links.js";

export default {
  name: "userinfo",
  description: "Info about a member.",
  module: "utility",
  guildOnly: true,
  defer: true,
  aliases: ["whoisdiscord", "member"],
  args: [{ name: "user", type: "member", required: false, description: "Member (default: you)" }],
  async execute(ctx) {
    const m = ctx.args.user ?? (await ctx.guild.members.fetch(ctx.author.id).catch(() => null));
    if (!m) return ctx.reply("Couldn't find that member.");
    const u = m.user;
    const link = await getLinkByDiscord(u.id);
    const roles = m.roles.cache.filter((r) => r.name !== "@everyone").sort((a, b) => b.position - a.position);

    const embed = new EmbedBuilder()
      .setColor(m.displayColor || COLORS.primary)
      .setAuthor({ name: u.tag, iconURL: u.displayAvatarURL() })
      .setThumbnail(u.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "ID", value: `\`${u.id}\``, inline: true },
        { name: "Account created", value: time(u.createdAt, "R"), inline: true },
        { name: "Joined server", value: m.joinedAt ? time(m.joinedAt, "R") : "?", inline: true },
        { name: "Roblox link", value: link ? `[${link.roblox_name}](https://www.roblox.com/users/${link.roblox_id}/profile)` : "not linked", inline: true },
        { name: "Bot", value: u.bot ? "yes" : "no", inline: true },
        { name: `Roles — ${roles.size}`, value: roles.size ? roles.map((r) => `<@&${r.id}>`).join(" ").slice(0, 1024) : "none" },
      );
    if (m.isCommunicationDisabled?.()) embed.addFields({ name: "Timed out until", value: time(m.communicationDisabledUntil, "R") });
    await ctx.reply({ embeds: [embed] });
  },
};

import { EmbedBuilder, time } from "discord.js";
import { resolveDiscordLink, resolveRobloxLink } from "../../lib/resolveLink.js";
import { userByUsername, headshotUrl } from "../../lib/roblox.js";

export default {
  name: "whois",
  description: "Show the Roblox↔Discord link for a user.",
  module: "connections",
  aliases: ["lookuplink"],
  defer: true,
  ratelimit: { scope: "user", uses: 10, per: 15_000 },
  args: [{ name: "user", type: "string", required: true, description: "@mention, Discord ID, or Roblox username" }],
  async execute(ctx) {
    const raw = ctx.args.user.trim();
    const mentionId = raw.match(/^<@!?(\d+)>$/)?.[1] || (/^\d{15,25}$/.test(raw) ? raw : null);

    let link;
    if (mentionId) {
      link = await resolveDiscordLink(mentionId, ctx.guild?.id);
      if (!link) return ctx.reply({ content: `<@${mentionId}> hasn't linked a Roblox account.`, ephemeral: true });
    } else {
      const hit = await userByUsername(raw);
      if (!hit) return ctx.reply({ content: `No Roblox user called \`${raw}\`.`, ephemeral: true });
      link = await resolveRobloxLink(hit.id, ctx.guild?.id);
      if (!link)
        return ctx.reply({ content: `No Discord user is linked to **${hit.name}** (\`${hit.id}\`).`, ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x00a2ff)
      .setThumbnail(await headshotUrl(link.roblox_id).catch(() => null))
      .setURL(`https://www.roblox.com/users/${link.roblox_id}/profile`)
      .setTitle(link.roblox_name || link.roblox_id)
      .addFields(
        { name: "Discord", value: `<@${link.discord_id}>`, inline: true },
        { name: "Roblox ID", value: `\`${link.roblox_id}\``, inline: true },
        link.linked_at
          ? { name: "Linked", value: time(Math.floor(link.linked_at / 1000), "R"), inline: true }
          : { name: "Source", value: "Bloxlink", inline: true },
      );
    await ctx.reply({ embeds: [embed] });
  },
};

import { EmbedBuilder, time } from "discord.js";
import { resolvePlayer } from "../../lib/erlcModeration.js";
import { lookup as robloxLookup } from "../../lib/roblox.js";
import { getSubjectCases, subjectStats } from "../../lib/cases.js";
import { getLinkByRoblox } from "../../lib/links.js";
import { COLORS, actionEmoji, err } from "../../lib/style.js";
import { erlcKeyOrNull, PLAYER_ARG } from "./_shared.js";

const DAY = 86_400_000;

export default {
  name: "lookup",
  description: "Full cross-referenced profile: Roblox account, cases, linked Discord, risk flags.",
  module: "moderation",
  guildOnly: true,
  defer: true,
  aliases: ["profile", "check"],
  permission: "case.view",
  ratelimit: { scope: "user", uses: 8, per: 15_000 },
  args: [PLAYER_ARG],
  async execute(ctx) {
    const target = await resolvePlayer(erlcKeyOrNull(ctx), ctx.args.player);
    if (target?.unlinkedDiscordId)
      return ctx.reply({ content: err(`<@${target.unlinkedDiscordId}> hasn't linked a Roblox account.`), ephemeral: true });
    if (!target) return ctx.reply({ content: err(`No match for \`${ctx.args.player}\`.`), ephemeral: true });

    const [rblx, cases, stats, link] = await Promise.all([
      robloxLookup(target.id).catch(() => null),
      getSubjectCases(ctx.guild.id, "roblox", target.id),
      subjectStats(ctx.guild.id, "roblox", target.id),
      getLinkByRoblox(target.id),
    ]);

    const createdMs = rblx?.created ? new Date(rblx.created).getTime() : null;
    const ageDays = createdMs ? Math.floor((Date.now() - createdMs) / DAY) : null;

    const flags = [];
    if (ageDays != null && ageDays < 30) flags.push("🆕 account < 30 days old");
    if (rblx?.isBanned) flags.push("🔨 Roblox-banned account");
    if ((stats.ban || 0) + (stats.kick || 0) >= 3) flags.push("⚠️ 3+ kicks/bans on record");
    if (!link) flags.push("🔗 no linked Discord account");
    if (cases.some((c) => c.type === "bolo" && !c.voided)) flags.push("🔍 active BOLO");

    const breakdown =
      Object.entries(stats)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${actionEmoji(t)} ${n} ${t}`)
        .join("   ") || "clean";

    const embed = new EmbedBuilder()
      .setColor(flags.length ? COLORS.warn : COLORS.success)
      .setAuthor({ name: `${rblx?.displayName ?? target.name} (@${rblx?.name ?? target.name})`, url: `https://www.roblox.com/users/${target.id}/profile` })
      .setThumbnail(rblx?.headshot ?? null)
      .addFields(
        { name: "Roblox ID", value: `\`${target.id}\``, inline: true },
        { name: "Account age", value: ageDays != null ? `${ageDays} days` : "?", inline: true },
        { name: "Created", value: createdMs ? time(Math.floor(createdMs / 1000), "D") : "?", inline: true },
        { name: "In server now", value: target.online ? "🟢 yes" : "⚪ no", inline: true },
        { name: "Linked Discord", value: link ? `<@${link.discord_id}>` : "—", inline: true },
        { name: "Roblox groups", value: rblx?.groups?.length ? String(rblx.groups.length) : "0", inline: true },
        { name: `Cases — ${cases.length}`, value: breakdown },
      );

    if (flags.length) embed.addFields({ name: "⚑ Flags", value: flags.join("\n") });
    if (cases.length)
      embed.addFields({
        name: "Recent cases",
        value: cases
          .slice(0, 5)
          .map((c) => `${c.voided ? "~~" : ""}\`#${c.case_number}\` ${actionEmoji(c.type)} ${c.type} — ${c.reason || "—"} · <@${c.moderator_id}> · ${time(Math.floor(c.created_at / 1000), "R")}${c.voided ? "~~" : ""}`)
          .join("\n")
          .slice(0, 1024),
      });
    embed.setFooter({ text: `/history ${rblx?.name ?? target.name} for the full record` });

    await ctx.reply({ embeds: [embed] });
  },
};

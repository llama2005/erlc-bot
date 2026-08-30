import { EmbedBuilder } from "discord.js";
import { COLORS } from "../../lib/style.js";
import { formatDuration } from "../../lib/util.js";
import { moderatorCaseStats } from "../../lib/modstats.js";
import { userShiftStats } from "../../lib/shifts.js";
import { isOnLoa } from "../../lib/loa.js";
import { actionEmoji } from "../../lib/style.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default {
  name: "modstats",
  description: "Moderator activity — cases issued and shift time.",
  module: "shifts",
  guildOnly: true,
  defer: true,
  aliases: ["modactivity", "activity"],
  permission: "shift.self",
  args: [
    { name: "user", type: "user", required: false, description: "Whose stats (default: you)" },
    { name: "period", type: "duration", required: false, description: "Window, e.g. 30d (default 7d)" },
  ],
  async execute(ctx) {
    const user = ctx.args.user ?? ctx.author;
    const window = ctx.args.period || WEEK;
    const since = Date.now() - window;
    const cfg = ctx.config;

    const [cases, shift, onLoa] = await Promise.all([
      moderatorCaseStats(ctx.guild.id, user.id, since),
      userShiftStats(ctx.guild.id, user.id, since),
      isOnLoa(ctx.guild.id, user.id),
    ]);

    const breakdown =
      Object.entries(cases.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${actionEmoji(t)} ${n} ${t}`)
        .join("   ") || "none";

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: `Moderator stats · ${user.username ?? user.tag}`, iconURL: user.displayAvatarURL?.() })
      .setDescription(onLoa ? "🌴 currently on approved LOA" : null)
      .addFields(
        { name: "Cases issued", value: `**${cases.total}**\n${breakdown}` },
        { name: "Shift time", value: `\`${formatDuration(shift.total || 0)}\` · ${shift.sessions || 0} shifts`, inline: true },
      )
      .setFooter({ text: `Last ${formatDuration(window)}` });

    const quotaBits = [];
    if (cfg.weeklyCaseQuota > 0) {
      const scaled = Math.round((cfg.weeklyCaseQuota * window) / WEEK);
      quotaBits.push(`${cases.total >= scaled ? "✅" : "❌"} cases ${cases.total}/${scaled}`);
    }
    if (cfg.weeklyShiftQuota > 0) {
      const scaled = Math.round((cfg.weeklyShiftQuota * window) / WEEK);
      quotaBits.push(`${(shift.total || 0) >= scaled ? "✅" : "❌"} shift ${formatDuration(shift.total || 0)}/${formatDuration(scaled)}`);
    }
    if (quotaBits.length) embed.addFields({ name: "Quota", value: quotaBits.join(" · "), inline: true });

    await ctx.reply({ embeds: [embed] });
  },
};

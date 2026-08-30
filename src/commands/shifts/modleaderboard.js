import { EmbedBuilder } from "discord.js";
import { COLORS } from "../../lib/style.js";
import { caseLeaderboard } from "../../lib/modstats.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

export default {
  name: "modleaderboard",
  description: "Top moderators by cases issued.",
  module: "shifts",
  guildOnly: true,
  defer: true,
  aliases: ["modlb"],
  permission: "shift.self",
  args: [{ name: "period", type: "duration", required: false, description: "Window, e.g. 30d" }],
  async execute(ctx) {
    const since = Date.now() - (ctx.args.period || WEEK);
    const rows = await caseLeaderboard(ctx.guild.id, since);
    if (!rows.length) return ctx.reply("No moderation activity in that window.");
    const medal = ["🥇", "🥈", "🥉"];
    await ctx.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("Moderator leaderboard — cases")
          .setDescription(rows.slice(0, 15).map((r, i) => `${medal[i] ?? `\`${i + 1}.\``} <@${r.moderator_id}> — **${r.cases}**`).join("\n"))
          .setFooter({ text: `Since ${new Date(since).toISOString().slice(0, 10)}` }),
      ],
    });
  },
};

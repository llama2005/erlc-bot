import { time } from "discord.js";
import { okEmbed, err } from "../../lib/style.js";
import { formatDuration } from "../../lib/util.js";
import { addReminder, listReminders } from "../../lib/reminders.js";

export default {
  name: "remindme",
  description: "Get pinged after a delay.",
  module: "general",
  aliases: ["remind", "reminder"],
  ephemeral: true,
  ratelimit: { scope: "user", uses: 10, per: 60_000 },
  args: [
    { name: "when", type: "duration", required: true, description: "e.g. 30m, 2h, 1d" },
    { name: "text", type: "text", required: true, description: "What to remind you about" },
  ],
  async execute(ctx) {
    if (ctx.args.when < 30_000) return ctx.reply({ content: err("Minimum is 30 seconds."), ephemeral: true });
    if (ctx.args.when > 60 * 24 * 60 * 60 * 1000) return ctx.reply({ content: err("Maximum is 60 days."), ephemeral: true });
    const dueAt = Date.now() + ctx.args.when;
    await addReminder({
      userId: ctx.author.id,
      channelId: ctx.channel.id,
      guildId: ctx.guild?.id,
      text: ctx.args.text.slice(0, 500),
      dueAt,
    });
    await ctx.reply({
      embeds: [okEmbed(`I'll remind you ${time(Math.floor(dueAt / 1000), "R")} — in ${formatDuration(ctx.args.when)}.\n> ${ctx.args.text.slice(0, 300)}`)],
      ephemeral: true,
    });
  },
};

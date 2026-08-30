import { PollLayoutType } from "discord.js";
import { err } from "../../lib/style.js";
import { parseDuration } from "../../lib/util.js";

export default {
  name: "poll",
  description: "Create a native Discord poll.",
  module: "utility",
  guildOnly: true,
  userPermissions: ["SendMessages"],
  args: [
    { name: "question", type: "string", required: true, description: "The poll question" },
    { name: "options", type: "text", required: true, description: "Choices separated by | (2–10)" },
    { name: "duration", type: "duration", required: false, description: "How long, e.g. 1d (default 1d, max 7d)" },
    { name: "multi", type: "bool", required: false, description: "Allow selecting multiple answers" },
  ],
  async execute(ctx) {
    const answers = ctx.args.options
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (answers.length < 2) return ctx.reply({ content: err("Give at least 2 options separated by `|`."), ephemeral: true });

    const hours = Math.min(168, Math.max(1, Math.round((ctx.args.duration || 86_400_000) / 3_600_000)));

    const payload = {
      poll: {
        question: { text: ctx.args.question.slice(0, 300) },
        answers: answers.map((text) => ({ text: text.slice(0, 55) })),
        duration: hours,
        allowMultiselect: !!ctx.args.multi,
        layoutType: PollLayoutType.Default,
      },
    };

    // Polls can't be attached to an edited/deferred reply — post as a follow-up message.
    if (ctx.isInteraction) {
      await ctx.source.followUp(payload);
      await ctx.source.editReply({ content: "📊 Poll created." });
    } else {
      await ctx.channel.send(payload);
    }
  },
};

import { askAI, clearHistory } from "../../lib/ai.js";

export default {
  name: "ai",
  description: "Ask the AI a question.",
  module: "general",
  aliases: ["ask", "chat"],
  defer: true,
  ephemeral: false,
  ratelimit: { scope: "user", uses: 5, per: 30_000 },
  args: [{ name: "prompt", type: "text", required: true, description: "What to ask" }],
  async execute(ctx) {
    if (!ctx.config.aiEnabled) {
      await ctx.reply({ content: "The AI feature is disabled on this server.", ephemeral: true });
      return;
    }
    if (ctx.args.prompt.trim().toLowerCase() === "reset") {
      clearHistory(ctx.channel.id);
      await ctx.reply("Conversation history for this channel cleared.");
      return;
    }
    const answer = await askAI(ctx.channel.id, ctx.args.prompt);
    await ctx.reply(answer);
  },
};

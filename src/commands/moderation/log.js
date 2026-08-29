import { runAction, erlcStaff, ingameForType, PLAYER_ARG } from "./_shared.js";
import { listModTypes, getModType } from "../../lib/modTypes.js";
import { err } from "../../lib/style.js";

export default {
  name: "log",
  description: "Log a Roblox moderation of any type (generic form of /warn, /ban, …).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  aliases: ["moderate", "rlog"],
  permission: "mod.warn",
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [
    PLAYER_ARG,
    { name: "type", type: "string", required: true, description: "Moderation type", autocomplete: "modTypes" },
    { name: "reason", type: "text", required: false, description: "Reason" },
  ],
  async execute(ctx) {
    const type = ctx.args.type.toLowerCase();
    if (!(await getModType(ctx.guild.id, type))) {
      const names = (await listModTypes(ctx.guild.id)).map((t) => t.name).join(", ");
      return ctx.reply({ content: err(`Unknown type \`${type}\`. Available: ${names}`), ephemeral: true });
    }
    await runAction(ctx, type, { reason: ctx.args.reason, ingame: await ingameForType(ctx.guild.id, type) });
  },
};

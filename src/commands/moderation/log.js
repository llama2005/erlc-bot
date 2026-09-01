import { runAction, PLAYER_ARG, SERVER_ARG } from "./_shared.js";
import { listModTypes, getModType } from "../../lib/modTypes.js";
import { err } from "../../lib/style.js";

export default {
  name: "log",
  description: "Record a moderation you carried out in-game (no in-game command is run).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  aliases: ["moderate", "rlog"],
  permission: "mod.warn",
  ratelimit: { scope: "user", uses: 8, per: 15_000 },
  args: [
    PLAYER_ARG,
    { name: "type", type: "string", required: true, description: "warn / kick / ban / jail / … (a moderation type)", autocomplete: "modTypes" },
    { name: "reason", type: "text", required: false, description: "Why" },
    { name: "proof", type: "string", required: false, description: "Evidence link (screenshot / clip)" },
    SERVER_ARG,
  ],
  async execute(ctx) {
    const type = ctx.args.type.toLowerCase();
    if (!(await getModType(ctx.guild.id, type))) {
      const names = (await listModTypes(ctx.guild.id)).map((t) => t.name).join(", ");
      return ctx.reply({ content: err(`Unknown type \`${type}\`. Available: ${names}`), ephemeral: true });
    }
    await runAction(ctx, type, { reason: ctx.args.reason, recordOnly: true });
  },
};

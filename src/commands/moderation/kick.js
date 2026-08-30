import { runAction, erlcStaff, PLAYER_ARG, SERVER_ARG, BOLO_ARG } from "./_shared.js";

export default {
  name: "kick",
  description: "Kick a player from the ER:LC server (PM + :kick + logged case).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  permission: "mod.kick",
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: true, description: "Reason" }, SERVER_ARG, BOLO_ARG],
  execute: (ctx) => runAction(ctx, "kick", { reason: ctx.args.reason, ingame: (t) => `:kick ${t.name}` }),
};

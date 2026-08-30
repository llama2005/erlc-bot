import { runAction, erlcStaff, PLAYER_ARG, SERVER_ARG } from "./_shared.js";

export default {
  name: "unjail",
  description: "Release a jailed player in the ER:LC server (:unjail + logged case).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  permission: "mod.jail",
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: false, description: "Reason" }, SERVER_ARG],
  execute: (ctx) => runAction(ctx, "unjail", { reason: ctx.args.reason, ingame: (t) => `:unjail ${t.name}` }),
};

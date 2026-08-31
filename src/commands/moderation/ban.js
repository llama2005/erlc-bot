import { runAction, erlcStaff, PLAYER_ARG, SERVER_ARG, BOLO_ARG } from "./_shared.js";

export default {
  name: "ban",
  description: "Ban a player from the ER:LC server (:ban + logged case; works offline).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  permission: "mod.ban",
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: false, description: "Reason" }, SERVER_ARG, BOLO_ARG],
  execute: (ctx) => runAction(ctx, "ban", { reason: ctx.args.reason, ingame: (t) => `:ban ${t.name}` }),
};

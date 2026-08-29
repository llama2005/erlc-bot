import { runAction, erlcStaff, PLAYER_ARG } from "./_shared.js";

export default {
  name: "unban",
  description: "Unban a player from the ER:LC server (:unban + logged case).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  check: erlcStaff,
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: false, description: "Reason" }],
  execute: (ctx) => runAction(ctx, "unban", { reason: ctx.args.reason, ingame: (t) => `:unban ${t.name}` }),
};

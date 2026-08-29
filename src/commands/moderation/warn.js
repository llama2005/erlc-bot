import { runAction, erlcStaff, PLAYER_ARG } from "./_shared.js";

export default {
  name: "warn",
  description: "Warn a player in-game (PM + logged case).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  check: erlcStaff,
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: true, description: "Reason" }],
  execute: (ctx) => runAction(ctx, "warn", { reason: ctx.args.reason }),
};

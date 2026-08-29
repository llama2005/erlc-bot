import { runAction, erlcStaff, PLAYER_ARG } from "./_shared.js";

export default {
  name: "jail",
  description: "Jail a player in the ER:LC server (PM + :jail + logged case).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  check: erlcStaff,
  ratelimit: { scope: "user", uses: 5, per: 15_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: true, description: "Reason" }],
  execute: (ctx) => runAction(ctx, "jail", { reason: ctx.args.reason, ingame: (t) => `:jail ${t.name}` }),
};

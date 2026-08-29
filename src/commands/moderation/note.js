import { runAction, erlcStaff, PLAYER_ARG } from "./_shared.js";

export default {
  name: "note",
  description: "Add a moderation note to a player's history (no in-game action).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  check: erlcStaff,
  ratelimit: { scope: "user", uses: 10, per: 15_000 },
  args: [PLAYER_ARG, { name: "text", type: "text", required: true, description: "Note text" }],
  execute: (ctx) => runAction(ctx, "note", { reason: ctx.args.text }),
};

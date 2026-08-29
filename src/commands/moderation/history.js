import { resolvePlayer } from "../../lib/erlcModeration.js";
import { historyView } from "../../lib/historyView.js";
import { err } from "../../lib/style.js";
import { erlcKeyOrNull, erlcStaff, PLAYER_ARG } from "./_shared.js";

export default {
  name: "history",
  description: "Show a player's ER:LC moderation history (all cases, paginated).",
  module: "moderation",
  guildOnly: true,
  defer: true,
  aliases: ["modlogs", "record", "modhistory"],
  check: erlcStaff,
  ratelimit: { scope: "user", uses: 10, per: 15_000 },
  args: [PLAYER_ARG],
  async execute(ctx) {
    const target = await resolvePlayer(erlcKeyOrNull(ctx), ctx.args.player);
    if (target?.unlinkedDiscordId)
      return ctx.reply({ content: err(`<@${target.unlinkedDiscordId}> hasn't linked a Roblox account (\`/verify\`).`), ephemeral: true });
    if (!target) return ctx.reply({ content: err(`No match for \`${ctx.args.player}\`.`), ephemeral: true });

    await ctx.reply(await historyView(ctx.guild, "roblox", target.id, target.name));
  },
};

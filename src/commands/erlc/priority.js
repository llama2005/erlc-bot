import { EmbedBuilder } from "discord.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolveSendable } from "../../lib/modlog.js";
import { COLORS, ok } from "../../lib/style.js";
import { getTemplate, renderPayload } from "../../lib/templates.js";
import { erlcKeyOrNull } from "../moderation/_shared.js";

const activeTimers = new Map(); // guildId -> timeout

export default {
  name: "priority",
  description: "Announce a priority timer (in Discord + in-game).",
  module: "erlc",
  guildOnly: true,
  defer: true,
  aliases: ["prio", "pt"],
  permission: "erlc.message",
  args: [
    { name: "minutes", type: "int", required: true, description: "How long the priority lasts" },
    { name: "reason", type: "text", required: false, description: "e.g. pursuit, scene, event" },
  ],
  async execute(ctx) {
    const mins = Math.min(60, Math.max(1, ctx.args.minutes));
    const key = erlcKeyOrNull(ctx);
    const reason = ctx.args.reason?.trim();
    const vars = { minutes: mins, reason: reason || "general priority", staff: `<@${ctx.author.id}>`, staffname: ctx.author.tag ?? ctx.author.username };

    const tpl = await getTemplate(ctx.guild.id, "priority");
    const payload = renderPayload(tpl, vars);

    const { channel } = await resolveSendable(ctx.client, ctx.config.sessionChannel);
    const target = channel ?? ctx.channel;
    await target.send(payload);

    let hinted = false;
    if (key) {
      try {
        await erlc.command(key, `:h Priority active for ${mins} min${reason ? ` — ${reason}` : ""}. No interfering.`);
        hinted = true;
      } catch (e) {
        if (!(e instanceof ErlcError)) throw e;
      }
      clearTimeout(activeTimers.get(ctx.guild.id));
      activeTimers.set(
        ctx.guild.id,
        setTimeout(async () => {
          erlc.command(key, ":h Priority has ended.").catch(() => {});
          const endTpl = await getTemplate(ctx.guild.id, "priority_end").catch(() => null);
          if (endTpl) target.send(renderPayload(endTpl, vars)).catch(() => {});
          activeTimers.delete(ctx.guild.id);
        }, mins * 60_000).unref?.() ?? undefined,
      );
    }

    await ctx.reply(hinted ? ok(`Priority announced (in-game hint sent). Auto-ends in ${mins}m.`) : ok("Priority announced in Discord."));
  },
};

import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolveSendable } from "../../lib/modlog.js";
import { okEmbed } from "../../lib/style.js";
import { getTemplate, renderPayload } from "../../lib/templates.js";
import { erlcServerFor, SERVER_ARG } from "./_shared.js";

const activeTimers = new Map(); // `${guildId}:${serverId}` -> timeout

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
    SERVER_ARG,
  ],
  async execute(ctx) {
    const mins = Math.min(60, Math.max(1, ctx.args.minutes));
    const server = await erlcServerFor(ctx).catch(() => null);
    const key = server?.api_key ?? null;
    const timerKey = `${ctx.guild.id}:${server?.id ?? 0}`;
    const reason = ctx.args.reason?.trim();
    const vars = { minutes: mins, reason: reason || "general priority", staff: `<@${ctx.author.id}>`, staffname: ctx.author.tag ?? ctx.author.username };

    const tpl = await getTemplate(ctx.guild.id, "priority");
    const payload = renderPayload(tpl, vars);

    const { channel } = await resolveSendable(ctx.client, ctx.config.sessionChannel, ctx.guild.id);
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
      clearTimeout(activeTimers.get(timerKey));
      activeTimers.set(
        timerKey,
        setTimeout(async () => {
          erlc.command(key, ":h Priority has ended.").catch(() => {});
          const endTpl = await getTemplate(ctx.guild.id, "priority_end").catch(() => null);
          if (endTpl) target.send(renderPayload(endTpl, vars)).catch(() => {});
          activeTimers.delete(timerKey);
        }, mins * 60_000).unref?.() ?? undefined,
      );
    }

    await ctx.reply({
      embeds: [
        okEmbed(
          hinted
            ? `Priority announced — in-game hint sent, auto-ends in **${mins}m**.`
            : `Priority announced in Discord${key ? "" : " (no ER:LC server connected, so no in-game hint)"}.`,
        ),
      ],
    });
  },
};

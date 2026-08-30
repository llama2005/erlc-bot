import { EmbedBuilder } from "discord.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolveSendable } from "../../lib/modlog.js";
import { COLORS, ok, err } from "../../lib/style.js";
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

    const embed = new EmbedBuilder()
      .setColor(COLORS.warn)
      .setTitle("🚨 Priority active")
      .setDescription(`A priority is in effect for **${mins} minute${mins === 1 ? "" : "s"}**.${reason ? `\n**Reason:** ${reason}` : ""}\nRespect the scene — no interfering.`)
      .setFooter({ text: `Called by ${ctx.author.tag ?? ctx.author.username}` })
      .setTimestamp();

    const { channel } = await resolveSendable(ctx.client, ctx.config.sessionChannel);
    await (channel ?? ctx.channel).send({ embeds: [embed] });

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
        setTimeout(() => {
          erlc.command(key, ":h Priority has ended.").catch(() => {});
          (channel ?? ctx.channel).send({ embeds: [new EmbedBuilder().setColor(COLORS.success).setTitle("✅ Priority ended")] }).catch(() => {});
          activeTimers.delete(ctx.guild.id);
        }, mins * 60_000).unref?.() ?? undefined,
      );
    }

    await ctx.reply(hinted ? ok(`Priority announced (in-game hint sent). Auto-ends in ${mins}m.`) : ok("Priority announced in Discord."));
  },
};

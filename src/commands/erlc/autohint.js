import { EmbedBuilder } from "discord.js";
import { COLORS, ok, err } from "../../lib/style.js";
import { parseDuration, formatDuration } from "../../lib/util.js";
import { listAutohints, addAutohint, removeAutohint, toggleAutohint } from "../../lib/autohint.js";

export default {
  name: "autohint",
  description: "Recurring in-game :h messages (rules reminders, ads, …).",
  module: "erlc",
  guildOnly: true,
  ephemeral: true,
  permission: "config",
  aliases: ["autohints"],
  subcommands: {
    list: {
      description: "Show configured auto-hints.",
      defer: true,
      async execute(ctx) {
        const rows = await listAutohints(ctx.guild.id);
        if (!rows.length) return ctx.reply({ content: "No auto-hints. Add one with `/autohint add`.", ephemeral: true });
        const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle("Auto-hints").setDescription(
          rows.map((h) => `\`#${h.id}\` ${h.enabled ? "🟢" : "⚪"} every ${formatDuration(Number(h.interval_ms))}\n> ${h.message}`).join("\n\n"),
        );
        await ctx.reply({ embeds: [embed], ephemeral: true });
      },
    },
    add: {
      description: "Add a recurring hint.",
      defer: true,
      args: [
        { name: "interval", type: "duration", required: true, description: "e.g. 15m, 1h" },
        { name: "message", type: "text", required: true, description: "Hint text" },
      ],
      async execute(ctx) {
        const ms = ctx.args.interval;
        if (ms < 60_000) return ctx.reply({ content: err("Minimum interval is 1 minute."), ephemeral: true });
        const row = await addAutohint(ctx.guild.id, ctx.args.message.slice(0, 250), ms);
        await ctx.reply(ok(`Auto-hint #${row.id} added — every ${formatDuration(ms)}.`));
      },
    },
    remove: {
      description: "Delete an auto-hint.",
      defer: true,
      args: [{ name: "id", type: "int", required: true, description: "Auto-hint number" }],
      async execute(ctx) {
        await ctx.reply((await removeAutohint(ctx.guild.id, ctx.args.id)) ? ok(`Removed auto-hint #${ctx.args.id}.`) : err("No such auto-hint."));
      },
    },
    toggle: {
      description: "Enable/disable an auto-hint.",
      defer: true,
      args: [
        { name: "id", type: "int", required: true, description: "Auto-hint number" },
        { name: "on", type: "bool", required: true, description: "Enabled?" },
      ],
      async execute(ctx) {
        await ctx.reply(
          (await toggleAutohint(ctx.guild.id, ctx.args.id, ctx.args.on)) ? ok(`Auto-hint #${ctx.args.id} ${ctx.args.on ? "enabled" : "disabled"}.`) : err("No such auto-hint."),
        );
      },
    },
  },
};

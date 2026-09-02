import { EmbedBuilder } from "discord.js";
import { COLORS, okEmbed, err } from "../../lib/style.js";
import { parseDuration, formatDuration } from "../../lib/util.js";
import { listAutohints, addAutohint, removeAutohint, toggleAutohint } from "../../lib/autohint.js";
import { resolveServer } from "../../lib/erlcServers.js";
import { SERVER_ARG } from "./_shared.js";

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
        if (!rows.length)
          return ctx.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle("Auto-hints").setDescription("None yet. Add one with `/autohint add`.")],
            ephemeral: true,
          });
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
        { ...SERVER_ARG, description: "Which ER:LC server (default: all of them)" },
      ],
      async execute(ctx) {
        const ms = ctx.args.interval;
        if (ms < 60_000) return ctx.reply({ content: err("Minimum interval is 1 minute."), ephemeral: true });
        let serverId = null;
        if (ctx.args.server) {
          const { server, matched } = await resolveServer(ctx.guild.id, ctx.args.server);
          if (!server)
            return ctx.reply({ content: err(matched ? "ER:LC isn't connected here yet." : `No server called \`${ctx.args.server}\`.`), ephemeral: true });
          serverId = server.id;
        }
        const row = await addAutohint(ctx.guild.id, ctx.args.message.slice(0, 250), ms, serverId);
        const where = serverId ? ` on \`${(await resolveServer(ctx.guild.id, String(serverId))).server?.label}\`` : "";
        await ctx.reply({ embeds: [okEmbed(`Auto-hint **#${row.id}** added — every ${formatDuration(ms)}${where}.`)], ephemeral: true });
      },
    },
    remove: {
      description: "Delete an auto-hint.",
      defer: true,
      args: [{ name: "id", type: "int", required: true, description: "Auto-hint number" }],
      async execute(ctx) {
        await ctx.reply(
          (await removeAutohint(ctx.guild.id, ctx.args.id))
            ? { embeds: [okEmbed(`Removed auto-hint **#${ctx.args.id}**.`)], ephemeral: true }
            : { content: err("No such auto-hint."), ephemeral: true },
        );
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
          (await toggleAutohint(ctx.guild.id, ctx.args.id, ctx.args.on))
            ? { embeds: [okEmbed(`Auto-hint **#${ctx.args.id}** ${ctx.args.on ? "enabled" : "disabled"}.`)], ephemeral: true }
            : { content: err("No such auto-hint."), ephemeral: true },
        );
      },
    },
  },
};

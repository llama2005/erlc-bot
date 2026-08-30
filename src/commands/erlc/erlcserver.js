import { EmbedBuilder } from "discord.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { COLORS, ok, err } from "../../lib/style.js";
import {
  getServers,
  resolveServer,
  addServer,
  removeServer,
  renameServer,
  setDefaultServer,
} from "../../lib/erlcServers.js";

const LABEL_ARG = { name: "label", type: "string", required: true, description: "The server's name (e.g. Main, Training)" };

export default {
  name: "erlcserver",
  description: "Connect and manage this server's ER:LC private servers.",
  module: "erlc",
  guildOnly: true,
  ephemeral: true,
  permission: "config",
  aliases: ["erlcservers", "prcserver"],
  redactArgs: ["key"],
  defaultSubcommand: "list",
  subcommands: {
    list: {
      description: "Show the connected ER:LC servers.",
      defer: true,
      async execute(ctx) {
        const servers = await getServers(ctx.guild.id);
        if (!servers.length)
          return ctx.reply({ content: "No ER:LC servers connected. Add one with `/erlcserver add <key> [label]`.", ephemeral: true });
        const embed = new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle(`ER:LC servers · ${ctx.guild.name}`)
          .setDescription(
            servers
              .map((s) => `${s.is_default ? "⭐" : "•"} **${s.label}** — key \`…${String(s.api_key).slice(-4)}\``)
              .join("\n"),
          )
          .setFooter({ text: "⭐ = primary (used when no server is specified)" });
        await ctx.reply({ embeds: [embed], ephemeral: true });
      },
    },
    add: {
      description: "Connect an ER:LC private server by its Server-Key.",
      defer: true,
      ephemeral: true,
      args: [
        { name: "key", type: "string", required: true, description: "The ER:LC Server-Key (from the private-server API settings)" },
        { name: "label", type: "string", required: false, description: "A name for it (default: Main, then Server 2, …)" },
      ],
      async execute(ctx) {
        if (!ctx.isInteraction) await ctx.source.delete().catch(() => {});
        const key = ctx.args.key.trim();
        const existing = await getServers(ctx.guild.id);
        if (existing.some((s) => s.api_key === key))
          return ctx.reply({ content: err("That key is already connected."), ephemeral: true });

        // sanity-check the key against the PRC API before saving
        try {
          await erlc.server(key);
        } catch (e) {
          return ctx.reply({
            content: err(e instanceof ErlcError ? `That key was rejected: ${e.message}` : "Couldn't reach the ER:LC API to verify that key — try again shortly."),
            ephemeral: true,
          });
        }

        const label = (ctx.args.label || (existing.length === 0 ? "Main" : `Server ${existing.length + 1}`)).slice(0, 40);
        if (existing.some((s) => s.label.toLowerCase() === label.toLowerCase()))
          return ctx.reply({ content: err(`There's already a server called \`${label}\`.`), ephemeral: true });

        const row = await addServer(ctx.guild.id, label, key);
        await ctx.reply({
          content: ok(`Connected **${row.label}**${row.is_default ? " (now the primary server)" : ""}. Target it with \`server:${row.label}\` on any ER:LC command.`),
          ephemeral: true,
        });
      },
    },
    remove: {
      description: "Disconnect an ER:LC server.",
      defer: true,
      args: [LABEL_ARG],
      async execute(ctx) {
        const { server } = await resolveServer(ctx.guild.id, ctx.args.label);
        if (!server) return ctx.reply({ content: err(`No server called \`${ctx.args.label}\`.`), ephemeral: true });
        await removeServer(ctx.guild.id, server.id);
        const remaining = await getServers(ctx.guild.id);
        const promoted = remaining.find((s) => s.is_default);
        await ctx.reply(ok(`Removed **${server.label}**.${promoted && remaining.length ? ` **${promoted.label}** is now primary.` : ""}`));
      },
    },
    rename: {
      description: "Rename an ER:LC server.",
      defer: true,
      args: [
        { name: "label", type: "string", required: true, description: "Current name" },
        { name: "name", type: "string", required: true, description: "New name" },
      ],
      async execute(ctx) {
        const { server } = await resolveServer(ctx.guild.id, ctx.args.label);
        if (!server) return ctx.reply({ content: err(`No server called \`${ctx.args.label}\`.`), ephemeral: true });
        const name = ctx.args.name.trim().slice(0, 40);
        if ((await getServers(ctx.guild.id)).some((s) => s.id !== server.id && s.label.toLowerCase() === name.toLowerCase()))
          return ctx.reply({ content: err(`There's already a server called \`${name}\`.`), ephemeral: true });
        await renameServer(ctx.guild.id, server.id, name);
        await ctx.reply(ok(`Renamed **${server.label}** → **${name}**.`));
      },
    },
    default: {
      description: "Set which server commands use when none is specified.",
      defer: true,
      aliases: ["primary"],
      args: [LABEL_ARG],
      async execute(ctx) {
        const { server } = await resolveServer(ctx.guild.id, ctx.args.label);
        if (!server) return ctx.reply({ content: err(`No server called \`${ctx.args.label}\`.`), ephemeral: true });
        await setDefaultServer(ctx.guild.id, server.id);
        await ctx.reply(ok(`**${server.label}** is now the primary ER:LC server.`));
      },
    },
  },
};

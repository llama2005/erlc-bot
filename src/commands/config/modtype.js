import { EmbedBuilder } from "discord.js";
import { listModTypes, addModType, removeModType, BUILTIN_TYPES } from "../../lib/modTypes.js";
import { COLORS, ok, err } from "../../lib/style.js";

const BUILTIN_NAMES = new Set(BUILTIN_TYPES.map((t) => t.name));

export default {
  name: "modtype",
  description: "Manage this server's Roblox moderation types (used by /log).",
  module: "config",
  guildOnly: true,
  ephemeral: true,
  userPermissions: ["ManageGuild"],
  aliases: ["modtypes"],
  subcommands: {
    list: {
      description: "List all moderation types.",
      async execute(ctx) {
        const types = await listModTypes(ctx.guild.id);
        const embed = new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("Moderation types")
          .setDescription(
            types
              .map((t) => `• **${t.name}**${t.is_ban ? " · ban" : ""}${t.ingame_cmd ? ` · \`${t.ingame_cmd}\`` : ""}${BUILTIN_NAMES.has(t.name) ? " _(built-in)_" : ""}`)
              .join("\n"),
          );
        await ctx.reply({ embeds: [embed], ephemeral: true });
      },
    },
    add: {
      description: "Add or update a moderation type.",
      args: [
        { name: "name", type: "string", required: true, description: "Type name (one word)" },
        { name: "ingame", type: "string", required: false, description: "In-game command template, e.g. ':jail {player}'" },
        { name: "ban", type: "bool", required: false, description: "Treat as a ban (used by ban-request)" },
      ],
      async execute(ctx) {
        const name = ctx.args.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!name) return ctx.reply({ content: err("Give a valid one-word name."), ephemeral: true });
        await addModType(ctx.guild.id, name, { isBan: !!ctx.args.ban, ingameCmd: ctx.args.ingame || null });
        await ctx.reply(ok(`Moderation type **${name}** saved.`));
      },
    },
    remove: {
      description: "Remove a custom moderation type.",
      args: [{ name: "name", type: "string", required: true, description: "Type name", autocomplete: "modTypes" }],
      async execute(ctx) {
        const name = ctx.args.name.toLowerCase();
        if (BUILTIN_NAMES.has(name) && !(await listModTypes(ctx.guild.id)).some((t) => t.name === name && !BUILTIN_TYPES.includes(t)))
          return ctx.reply({ content: err(`\`${name}\` is a built-in type and can't be removed (you can override it with \`add\`).`), ephemeral: true });
        await ctx.reply((await removeModType(ctx.guild.id, name)) ? ok(`Removed **${name}**.`) : err(`No custom type \`${name}\`.`));
      },
    },
  },
};

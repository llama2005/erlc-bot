import { listShiftTypes, addShiftType, removeShiftType } from "../../lib/shifts.js";
import { okEmbed, infoEmbed, err } from "../../lib/style.js";

export default {
  name: "shifttype",
  description: "Manage this server's shift types.",
  module: "shifts",
  guildOnly: true,
  ephemeral: true,
  aliases: ["shifttypes"],
  permission: "config",
  subcommands: {
    list: {
      description: "List shift types.",
      async execute(ctx) {
        const types = await listShiftTypes(ctx.guild.id);
        await ctx.reply({
          embeds: [infoEmbed(types.length ? types.map((t) => `• **${t}**`).join("\n") : "_None yet — add one with `/shifttype add`._", "Shift types")],
          ephemeral: true,
        });
      },
    },
    add: {
      description: "Add a shift type.",
      args: [{ name: "name", type: "string", required: true, description: "One word" }],
      async execute(ctx) {
        const name = ctx.args.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!name) return ctx.reply({ content: err("Give a valid one-word name."), ephemeral: true });
        await addShiftType(ctx.guild.id, name);
        await ctx.reply({ embeds: [okEmbed(`Shift type **${name}** added.`)], ephemeral: true });
      },
    },
    remove: {
      description: "Remove a shift type.",
      args: [{ name: "name", type: "string", required: true, description: "Type name", autocomplete: "shiftTypes" }],
      async execute(ctx) {
        const removed = await removeShiftType(ctx.guild.id, ctx.args.name.toLowerCase());
        await ctx.reply(
          removed
            ? { embeds: [okEmbed(`Removed shift type **${ctx.args.name}**.`)], ephemeral: true }
            : { content: err("No such shift type."), ephemeral: true },
        );
      },
    },
  },
};

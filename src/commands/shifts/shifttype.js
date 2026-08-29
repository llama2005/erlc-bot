import { listShiftTypes, addShiftType, removeShiftType } from "../../lib/shifts.js";
import { manageGuild } from "../../lib/checks.js";
import { ok, err } from "../../lib/style.js";

export default {
  name: "shifttype",
  description: "Manage this server's shift types.",
  module: "shifts",
  guildOnly: true,
  ephemeral: true,
  aliases: ["shifttypes"],
  check: manageGuild,
  subcommands: {
    list: {
      description: "List shift types.",
      async execute(ctx) {
        await ctx.reply(`Shift types: ${(await listShiftTypes(ctx.guild.id)).map((t) => `\`${t}\``).join(", ")}`);
      },
    },
    add: {
      description: "Add a shift type.",
      args: [{ name: "name", type: "string", required: true, description: "One word" }],
      async execute(ctx) {
        const name = ctx.args.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!name) return ctx.reply({ content: err("Give a valid one-word name."), ephemeral: true });
        await addShiftType(ctx.guild.id, name);
        await ctx.reply(ok(`Shift type **${name}** added.`));
      },
    },
    remove: {
      description: "Remove a shift type.",
      args: [{ name: "name", type: "string", required: true, description: "Type name", autocomplete: "shiftTypes" }],
      async execute(ctx) {
        await ctx.reply((await removeShiftType(ctx.guild.id, ctx.args.name.toLowerCase())) ? ok(`Removed **${ctx.args.name}**.`) : err("No such shift type."));
      },
    },
  },
};

import { EmbedBuilder } from "discord.js";
import { usageString } from "../../lib/args.js";

export default {
  name: "help",
  description: "List commands, or show details for one.",
  module: "general",
  aliases: ["commands", "h"],
  args: [{ name: "command", type: "string", required: false, description: "Command to explain" }],
  async execute(ctx) {
    const manager = ctx.client.manager;
    const cfg = ctx.config;
    const prefix = cfg.prefix;

    if (ctx.args.command) {
      const cmd = manager.resolve(ctx.args.command.toLowerCase());
      if (!cmd) {
        await ctx.reply({ content: `No command called \`${ctx.args.command}\`.`, ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`${prefix}${cmd.name}`)
        .setDescription(cmd.description || "No description.")
        .addFields(
          { name: "Module", value: cmd.module, inline: true },
          { name: "Aliases", value: cmd.aliases?.length ? cmd.aliases.join(", ") : "none", inline: true },
        );
      if (cmd.subcommands) {
        embed.addFields({
          name: "Subcommands",
          value: Object.entries(cmd.subcommands)
            .map(([n, s]) => `\`${n} ${usageString(s.args ?? [])}\` — ${s.description || ""}`)
            .join("\n")
            .slice(0, 1024),
        });
      } else {
        embed.addFields({ name: "Usage", value: `\`${prefix}${cmd.name} ${usageString(cmd.args)}\`` });
      }
      if (cmd.userPermissions?.length)
        embed.addFields({ name: "Requires", value: cmd.userPermissions.join(", ") });
      await ctx.reply({ embeds: [embed] });
      return;
    }

    const byModule = new Map();
    for (const cmd of manager.commands.values()) {
      if (ctx.guild && (cfg.disabledCommands.includes(cmd.name) || cfg.disabledModules.includes(cmd.module))) continue;
      if (cmd.ownerOnly && !ctx.isOwner) continue;
      if (!byModule.has(cmd.module)) byModule.set(cmd.module, []);
      byModule.get(cmd.module).push(cmd.name);
    }

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("Commands")
      .setDescription(`Prefix: \`${prefix}\` · also works as slash commands · \`${prefix}help <command>\` for details`);
    for (const [mod, names] of [...byModule].sort()) {
      embed.addFields({ name: mod, value: names.sort().map((n) => `\`${n}\``).join(", ") });
    }
    await ctx.reply({ embeds: [embed] });
  },
};

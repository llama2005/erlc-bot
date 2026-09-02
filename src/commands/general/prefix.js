import { setGuildConfig } from "../../lib/guildConfig.js";
import { manageGuild } from "../../lib/checks.js";
import { okEmbed, infoEmbed, err } from "../../lib/style.js";

export default {
  name: "prefix",
  description: "View or set the server's command prefix.",
  module: "general",
  guildOnly: true,
  aliases: ["pre"],
  args: [{ name: "prefix", type: "string", required: false, description: "New prefix (1-5 chars)" }],
  async execute(ctx) {
    if (!ctx.args.prefix)
      return ctx.reply({ embeds: [infoEmbed(`This server's prefix is \`${ctx.config.prefix}\`.`)] });

    const gate = manageGuild(ctx);
    if (gate !== true) return ctx.reply({ content: err(gate), ephemeral: true });

    const p = ctx.args.prefix.trim();
    if (p.length > 5 || /[{}]/.test(p)) return ctx.reply({ content: err("Prefix must be 1-5 characters and contain no braces."), ephemeral: true });

    await setGuildConfig(ctx.guild.id, { prefix: p });
    await ctx.reply({ embeds: [okEmbed(`Prefix set to \`${p}\`. Slash commands are unaffected.`)] });
  },
};

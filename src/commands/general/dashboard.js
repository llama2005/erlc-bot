import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { config } from "../../config.js";
import { COLORS } from "../../lib/style.js";

export default {
  name: "dashboard",
  description: "Get a link to the web dashboard.",
  module: "general",
  aliases: ["panel", "web"],
  async execute(ctx) {
    const dash = (config.links.dashboard || "").replace(/\/$/, "");
    if (!dash) return ctx.reply("No dashboard is configured for this bot.");

    const url = ctx.guild ? `${dash}/dashboard/${ctx.guild.id}` : `${dash}/dashboard`;
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setDescription(
        ctx.guild
          ? `[Open the dashboard for **${ctx.guild.name}**](${url})\nYou'll need **Manage Server** to see it.`
          : `[Open the dashboard](${url})\nLog in with Discord to see the servers you manage.`,
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open dashboard").setStyle(ButtonStyle.Link).setURL(url),
    );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { config } from "../../config.js";
import { COLORS } from "../../lib/style.js";

export default {
  name: "website",
  description: "Get a link to the website.",
  module: "general",
  aliases: ["site", "home"],
  async execute(ctx) {
    const site = (config.links.dashboard || "").replace(/\/$/, "");
    if (!site) return ctx.reply("No website is configured for this bot.");

    const embed = new EmbedBuilder().setColor(COLORS.primary).setDescription(`[Visit the website](${site})`);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Open website").setStyle(ButtonStyle.Link).setURL(site),
    );

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

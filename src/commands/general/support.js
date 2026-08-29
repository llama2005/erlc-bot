import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } from "discord.js";
import { config } from "../../config.js";
import { COLORS } from "../../lib/style.js";

export default {
  name: "support",
  description: "Get help and useful links.",
  module: "general",
  aliases: ["invite"],
  async execute(ctx) {
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${ctx.client.user.id}&permissions=${
      new PermissionsBitField([
        "ViewChannel", "SendMessages", "EmbedLinks", "ManageMessages",
        "KickMembers", "BanMembers", "ModerateMembers", "ManageRoles", "ReadMessageHistory",
      ]).bitfield
    }&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle("Need help?")
      .setDescription(
        [
          `• Run \`/help\` for the command list, \`/help <command>\` for details.`,
          config.links.docs && `• [Documentation](${config.links.docs})`,
          config.links.support && `• [Support server](${config.links.support})`,
        ]
          .filter(Boolean)
          .join("\n"),
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Invite the bot").setStyle(ButtonStyle.Link).setURL(inviteUrl),
    );
    if (config.links.support)
      row.addComponents(new ButtonBuilder().setLabel("Support server").setStyle(ButtonStyle.Link).setURL(config.links.support));

    await ctx.reply({ embeds: [embed], components: [row] });
  },
};

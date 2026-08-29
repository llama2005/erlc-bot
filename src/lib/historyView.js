import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, time } from "discord.js";
import { getSubjectCases, subjectStats } from "./cases.js";
import { registerComponent } from "./components.js";
import { COLORS } from "./style.js";

const PER_PAGE = 8;

/** Paginated moderation-history view for one subject. Works for both platforms. */
export async function historyView(guild, platform, subjectId, displayName, page = 0) {
  const cases = await getSubjectCases(guild.id, platform, subjectId);
  const label = platform === "roblox" ? "ER:LC" : "Discord";

  if (!cases.length) {
    return {
      embeds: [new EmbedBuilder().setColor(COLORS.neutral).setDescription(`**${displayName}** has no ${label} moderation history.`)],
      components: [],
    };
  }

  const pages = Math.ceil(cases.length / PER_PAGE);
  page = Math.max(0, Math.min(page, pages - 1));
  const slice = cases.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const stats = await subjectStats(guild.id, platform, subjectId);
  const totals = Object.entries(stats).map(([t, n]) => `**${n}** ${t}`).join(" · ") || "none";

  const lines = slice.map((c) => {
    const w = c.voided ? "~~" : "";
    return `${w}\`#${c.case_number}\` **${c.type}** — ${c.reason || "—"}${w}\n  <@${c.moderator_id}> · ${time(Math.floor(c.created_at / 1000), "R")}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x34495e)
    .setAuthor({ name: `History · ${displayName}` })
    .setDescription(lines.join("\n").slice(0, 4000))
    .addFields({ name: "Totals (excluding voided)", value: totals })
    .setFooter({
      text: `${platform === "roblox" ? "Roblox" : "Discord"} ID ${subjectId} · page ${page + 1}/${pages} · ${cases.length} cases stored`,
    });
  if (platform === "roblox") embed.setURL(`https://www.roblox.com/users/${subjectId}/profile`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hist:${platform}:${subjectId}:${page - 1}`).setLabel("← Prev").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`hist:${platform}:${subjectId}:${page + 1}`).setLabel("Next →").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );

  return { embeds: [embed], components: pages > 1 ? [row] : [] };
}

registerComponent("hist", async (interaction, [platform, subjectId, pageStr]) => {
  await interaction.deferUpdate();
  const cases = await getSubjectCases(interaction.guild.id, platform, subjectId);
  const name = cases[0]?.subject_name ?? subjectId;
  await interaction.editReply(await historyView(interaction.guild, platform, subjectId, name, Number(pageStr) || 0));
});

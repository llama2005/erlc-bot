import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, time } from "discord.js";
import { getSubjectCases, subjectStats } from "./cases.js";
import { registerComponent } from "./components.js";
import { headshotUrl } from "./roblox.js";
import { COLORS, actionEmoji, actionVerb } from "./style.js";

const PER_PAGE = 6;

/** Paginated moderation-history view for one subject. Works for both platforms. */
export async function historyView(guild, platform, subjectId, displayName, page = 0) {
  const cases = await getSubjectCases(guild.id, platform, subjectId);
  const isRoblox = platform === "roblox";
  const profileUrl = isRoblox ? `https://www.roblox.com/users/${subjectId}/profile` : null;
  const thumb = isRoblox ? await headshotUrl(subjectId).catch(() => null) : null;

  if (!cases.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setAuthor({ name: `History · ${displayName}`, url: profileUrl ?? undefined })
          .setThumbnail(thumb)
          .setDescription(`✅ **${displayName}** has a clean record — no ${isRoblox ? "ER:LC" : "Discord"} moderation history.`),
      ],
      components: [],
    };
  }

  const pages = Math.ceil(cases.length / PER_PAGE);
  page = Math.max(0, Math.min(page, pages - 1));
  const slice = cases.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  const stats = await subjectStats(guild.id, platform, subjectId); // non-voided, by type
  const activeTotal = Object.values(stats).reduce((a, b) => a + b, 0);
  const breakdown =
    Object.entries(stats)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${actionEmoji(t)} **${n}** ${t}`)
      .join("   ") || "none active";

  const oldest = cases[cases.length - 1];
  const newest = cases[0];

  const blocks = slice.map((c) => {
    const head = `${c.voided ? "~~" : ""}**\`#${c.case_number}\`  ${actionEmoji(c.type)} ${actionVerb(c.type)}**${c.voided ? " · voided~~" : ""}`;
    const reason = (c.reason || "*no reason given*").replace(/\n+/g, " ").slice(0, 300);
    const meta = [
      `by <@${c.moderator_id}>`,
      time(Math.floor(c.created_at / 1000), "d"),
      time(Math.floor(c.created_at / 1000), "R"),
      isRoblox && !c.executed ? "⚠ not executed in-game" : null,
      c.duration_ms ? `⏱ ${Math.round(c.duration_ms / 60000)}m` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return `${head}\n> ${reason}\n${meta}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setAuthor({ name: `Moderation history · ${displayName}`, url: profileUrl ?? undefined })
    .setThumbnail(thumb)
    .setDescription(
      [
        `**${cases.length}** total case${cases.length === 1 ? "" : "s"}` +
          (cases.length !== activeTotal ? ` (${cases.length - activeTotal} voided)` : ""),
        breakdown,
        `First: ${time(Math.floor(oldest.created_at / 1000), "D")}  ·  Latest: ${time(Math.floor(newest.created_at / 1000), "R")}`,
      ].join("\n"),
    )
    .addFields({ name: "​", value: blocks.join("\n\n").slice(0, 4000) })
    .setFooter({ text: `${isRoblox ? "Roblox" : "Discord"} ID ${subjectId}  ·  page ${page + 1}/${pages}  ·  stored permanently` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`hist:${platform}:${subjectId}:${page - 1}`).setLabel("Newer").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`hist:${platform}:${subjectId}:${page + 1}`).setLabel("Older").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );

  return { embeds: [embed], components: pages > 1 ? [row] : [] };
}

registerComponent("hist", async (interaction, [platform, subjectId, pageStr]) => {
  await interaction.deferUpdate();
  const cases = await getSubjectCases(interaction.guild.id, platform, subjectId);
  const name = cases[0]?.subject_name ?? subjectId;
  await interaction.editReply(await historyView(interaction.guild, platform, subjectId, name, Number(pageStr) || 0));
});

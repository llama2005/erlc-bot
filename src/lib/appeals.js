import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { one, many, query } from "./pg.js";
import { COLORS } from "./style.js";

/** The Approve & unban / Deny review row for a ban appeal. */
export function appealReviewButtons(id, done = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appeal:approve:${id}`).setLabel("Approve & unban").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(`appeal:deny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(done),
  );
}

/** Canonical ban-appeal embed rebuilt from a DB row — reflects `status` + `reviewed_by`. */
export function appealEmbed(row, { priors = null, caseNumber = null } = {}) {
  const approved = row.status === "approved";
  const denied = row.status === "denied";
  const [title, color] = approved
    ? ["Ban appeal — APPROVED", COLORS.success]
    : denied
      ? ["Ban appeal — DENIED", COLORS.danger]
      : ["Ban appeal — pending", COLORS.primary];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      `From <@${row.user_id}>${row.roblox_name ? ` · Roblox **${row.roblox_name}** \`${row.roblox_id}\`` : " · *no Roblox account linked*"}`,
    )
    .addFields({ name: "Appeal", value: (row.reason || "—").slice(0, 1024) })
    .setFooter({ text: `Appeal #${row.id}` });

  if (priors)
    embed.addFields({
      name: "Prior cases",
      value: priors.length ? priors.slice(0, 6).map((c) => `\`#${c.case_number}\` ${c.type} — ${c.reason || "—"}`).join("\n") : "none on record",
    });
  if (row.reviewed_by && (approved || denied))
    embed.addFields({ name: approved ? "Approved by" : "Denied by", value: `<@${row.reviewed_by}>`, inline: true });
  if (caseNumber) embed.addFields({ name: "Case", value: `#${caseNumber}`, inline: true });
  return embed;
}

export const createAppeal = ({ guildId, userId, robloxId, robloxName, reason }) =>
  one(
    `INSERT INTO appeals (guild_id, user_id, roblox_id, roblox_name, reason, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [guildId, userId, robloxId ?? null, robloxName ?? null, reason, Date.now()],
  );

export const getAppeal = (id) => one("SELECT * FROM appeals WHERE id=$1", [id]);
export const attachAppealMessage = (id, messageId, channelId) =>
  query("UPDATE appeals SET message_id=$1, channel_id=$2 WHERE id=$3", [messageId, channelId, id]);
export const listAppeals = (guildId, status = "pending") =>
  many("SELECT * FROM appeals WHERE guild_id=$1 AND status=$2 ORDER BY created_at", [guildId, status]);
export const pendingAppealForUser = (guildId, userId) =>
  one("SELECT id FROM appeals WHERE guild_id=$1 AND user_id=$2 AND status='pending'", [guildId, userId]);
export const resolveAppeal = async (id, status, reviewedBy) =>
  (await query("UPDATE appeals SET status=$1, reviewed_by=$2 WHERE id=$3 AND status='pending'", [status, reviewedBy, id])).rowCount > 0;

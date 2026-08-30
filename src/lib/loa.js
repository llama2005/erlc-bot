import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, time } from "discord.js";
import { one, many, query } from "./pg.js";
import { COLORS, EMOJI, statusField } from "./style.js";
import { formatDuration } from "./util.js";

/** The Approve / Deny review row for an LOA request. */
export function loaReviewButtons(id, done = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(`loa:deny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(done),
  );
}

/** Canonical LOA embed rebuilt from a DB row — reflects `status` + `reviewed_by`. */
export function loaEmbed(row) {
  const approved = row.status === "active" || (row.status === "pending" && row.reviewed_by);
  const denied = row.status === "denied";
  const ended = row.status === "ended";
  const [title, color] = approved
    ? ["LOA — APPROVED", COLORS.success]
    : denied
      ? ["LOA — DENIED", COLORS.danger]
      : ended
        ? ["LOA — ENDED", COLORS.neutral]
        : ["LOA — pending review", COLORS.warn];

  const state = approved ? "approved" : denied ? "denied" : ended ? "ended" : "pending";
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`<@${row.user_id}> requested leave.`)
    .addFields(
      { name: "From", value: time(Math.floor(row.starts_at / 1000), "D"), inline: true },
      { name: "Until", value: time(Math.floor(row.ends_at / 1000), "D"), inline: true },
      { name: "Length", value: formatDuration(row.ends_at - row.starts_at), inline: true },
      { name: "Reason", value: `${EMOJI.reason} ${row.reason || "*none given*"}` },
      statusField(state, { byId: row.reviewed_by, at: row.reviewed_at }),
    )
    .setFooter({ text: `LOA: ${row.id}` });
  return embed;
}

export const createLoa = ({ guildId, userId, reason, startsAt, endsAt }) =>
  one(
    `INSERT INTO loa (guild_id, user_id, reason, starts_at, ends_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [guildId, userId, reason || null, startsAt, endsAt, Date.now()],
  );

export const getLoa = (id) => one("SELECT * FROM loa WHERE id=$1", [id]);
export const attachLoaMessage = (id, messageId, channelId) =>
  query("UPDATE loa SET message_id=$1, channel_id=$2 WHERE id=$3", [messageId, channelId, id]);

export const listLoa = (guildId, status) =>
  status
    ? many("SELECT * FROM loa WHERE guild_id=$1 AND status=$2 ORDER BY ends_at", [guildId, status])
    : many("SELECT * FROM loa WHERE guild_id=$1 AND status IN ('pending','active') ORDER BY ends_at", [guildId]);

/** Is this user currently on an approved, in-window LOA? */
export const isOnLoa = async (guildId, userId) =>
  (await one(
    "SELECT 1 FROM loa WHERE guild_id=$1 AND user_id=$2 AND status='active' AND starts_at<=$3 AND ends_at>$3 LIMIT 1",
    [guildId, userId, Date.now()],
  )) != null;

export const setLoaStatus = async (id, status, reviewedBy) =>
  (
    await query("UPDATE loa SET status=$1, reviewed_by=$2, reviewed_at=$3 WHERE id=$4 AND status IN ('pending','active')", [
      status,
      reviewedBy ?? null,
      Date.now(),
      id,
    ])
  ).rowCount > 0;

/** Auto-activate started LOAs and auto-end finished ones. Returns rows that changed. */
export async function tickLoa() {
  const now = Date.now();
  const activated = await many(
    "UPDATE loa SET status='active' WHERE status='pending' AND starts_at<=$1 AND ends_at>$1 RETURNING *",
    [now],
  );
  const ended = await many("UPDATE loa SET status='ended' WHERE status IN ('pending','active') AND ends_at<=$1 RETURNING *", [now]);
  return { activated, ended };
}

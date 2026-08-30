import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { one, many, query } from "./pg.js";
import { getGuildConfig } from "./guildConfig.js";
import { resolveSendable } from "./modlog.js";
import { headshotUrl } from "./roblox.js";
import { EMOJI, robloxUserField, statusField } from "./style.js";

const PENDING_COLOR = 0x3498db;
const APPROVED_COLOR = 0x2ecc71;
const DENIED_COLOR = 0xe74c3c;

export async function createBanRequest({ guildId, robloxId, robloxName, reason, requestedBy, sourceCase = null }) {
  return one(
    `INSERT INTO ban_requests (guild_id, roblox_id, roblox_name, reason, requested_by, source_case, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [guildId, String(robloxId), robloxName, reason || null, requestedBy, sourceCase, Date.now()],
  );
}

export const getBanRequest = (id) => one("SELECT * FROM ban_requests WHERE id=$1", [id]);
export const listPendingBanRequests = (guildId) =>
  many("SELECT * FROM ban_requests WHERE guild_id=$1 AND status='pending' ORDER BY created_at", [guildId]);
export const attachMessage = (id, messageId, channelId) =>
  query("UPDATE ban_requests SET message_id=$1, channel_id=$2 WHERE id=$3", [messageId, channelId, id]);
export const resolveBanRequest = async (id, status, resolvedBy) =>
  (await query("UPDATE ban_requests SET status=$1, resolved_by=$2, resolved_at=$3 WHERE id=$4 AND status='pending'", [status, resolvedBy, Date.now(), id])).rowCount > 0;
export const hasPendingRequest = async (guildId, robloxId) =>
  (await one("SELECT 1 FROM ban_requests WHERE guild_id=$1 AND roblox_id=$2 AND status='pending' LIMIT 1", [guildId, String(robloxId)])) != null;

export function banRequestButtons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`banreq:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`banreq:deny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

export async function banRequestEmbed(req, { caseNumber = null } = {}) {
  const approved = req.status === "approved";
  const denied = req.status === "denied";
  const [title, color] = approved
    ? ["Ban request — APPROVED", APPROVED_COLOR]
    : denied
      ? ["Ban request — DENIED", DENIED_COLOR]
      : ["Ban request — pending", PENDING_COLOR];

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setURL(`https://www.roblox.com/users/${req.roblox_id}/profile`)
    .setThumbnail(await headshotUrl(req.roblox_id).catch(() => null))
    .addFields(
      robloxUserField({ name: req.roblox_name, id: req.roblox_id }),
      { name: "Reason", value: `${EMOJI.reason} ${req.reason || "*no reason given*"}`.slice(0, 1024) },
      { name: "Requested by", value: `<@${req.requested_by}>`, inline: true },
      statusField(req.status, { byId: req.resolved_by, at: req.resolved_at }),
    );
  if (caseNumber) embed.addFields({ name: "Case", value: `#${caseNumber}`, inline: true });
  embed.setFooter({ text: `Request: ${req.id}${req.source_case ? ` · from case #${req.source_case}` : ""}` });
  return embed;
}

/**
 * File a ban request end-to-end: dedupe → create row → post embed+buttons → remember the message.
 * @returns {Promise<{ req: object } | { skipped: "pending" | "no-channel" }>}
 */
export async function fileBanRequest({ guild, client, robloxId, robloxName, reason, requestedBy, sourceCase = null, fallbackChannelId = null }) {
  if (await hasPendingRequest(guild.id, robloxId)) return { skipped: "pending" };

  const cfg = getGuildConfig(guild.id);
  const destId = cfg.banreqChannel || cfg.modlogChannel || fallbackChannelId;
  const { channel } = await resolveSendable(client ?? guild.client, destId, guild.id);
  if (!channel) return { skipped: "no-channel" };

  const req = await createBanRequest({ guildId: guild.id, robloxId, robloxName, reason, requestedBy, sourceCase });
  const msg = await channel.send({ embeds: [await banRequestEmbed(req)], components: [banRequestButtons(req.id)] });
  await attachMessage(req.id, msg.id, channel.id);
  return { req };
}

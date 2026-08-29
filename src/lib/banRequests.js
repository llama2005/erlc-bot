import { one, many, query } from "./pg.js";

export async function createBanRequest({ guildId, robloxId, robloxName, reason, requestedBy }) {
  return one(
    `INSERT INTO ban_requests (guild_id, roblox_id, roblox_name, reason, requested_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [guildId, String(robloxId), robloxName, reason || null, requestedBy, Date.now()],
  );
}

export const getBanRequest = (id) => one("SELECT * FROM ban_requests WHERE id=$1", [id]);
export const listPendingBanRequests = (guildId) =>
  many("SELECT * FROM ban_requests WHERE guild_id=$1 AND status='pending' ORDER BY created_at", [guildId]);
export const attachMessage = (id, messageId, channelId) =>
  query("UPDATE ban_requests SET message_id=$1, channel_id=$2 WHERE id=$3", [messageId, channelId, id]);
export const resolveBanRequest = async (id, status, resolvedBy) =>
  (await query("UPDATE ban_requests SET status=$1, resolved_by=$2 WHERE id=$3 AND status='pending'", [status, resolvedBy, id])).rowCount > 0;
export const hasPendingRequest = async (guildId, robloxId) =>
  (await one("SELECT 1 FROM ban_requests WHERE guild_id=$1 AND roblox_id=$2 AND status='pending' LIMIT 1", [guildId, String(robloxId)])) != null;

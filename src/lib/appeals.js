import { one, many, query } from "./pg.js";

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

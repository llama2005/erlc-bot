import { one, many, query } from "./pg.js";

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
  (await query("UPDATE loa SET status=$1, reviewed_by=$2 WHERE id=$3 AND status IN ('pending','active')", [status, reviewedBy ?? null, id])).rowCount > 0;

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

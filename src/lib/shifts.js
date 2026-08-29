import { one, many, query } from "./pg.js";

// --- shift types ---
export async function listShiftTypes(guildId) {
  const rows = await many("SELECT name FROM shift_types WHERE guild_id=$1 ORDER BY name", [guildId]);
  return rows.length ? rows.map((r) => r.name) : ["default"];
}
export const addShiftType = async (guildId, name) =>
  (await query("INSERT INTO shift_types (guild_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING", [guildId, name.toLowerCase()])).rowCount > 0;
export const removeShiftType = async (guildId, name) =>
  (await query("DELETE FROM shift_types WHERE guild_id=$1 AND name=$2", [guildId, name.toLowerCase()])).rowCount > 0;

// --- shifts ---
export const getActiveShift = (guildId, userId) =>
  one("SELECT * FROM shifts WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NULL", [guildId, userId]);

export async function startShift(guildId, userId, type = "default") {
  if (await getActiveShift(guildId, userId)) return null;
  await query("INSERT INTO shifts (guild_id, user_id, shift_type, started_at) VALUES ($1,$2,$3,$4)", [guildId, userId, type, Date.now()]);
  return getActiveShift(guildId, userId);
}

export async function endShift(guildId, userId) {
  const s = await getActiveShift(guildId, userId);
  if (!s) return null;
  const duration = Date.now() - s.started_at;
  await query("UPDATE shifts SET ended_at=$1, duration_ms=$2 WHERE id=$3", [Date.now(), duration, s.id]);
  return { ...s, ended_at: Date.now(), duration_ms: duration };
}

export const listActiveShifts = (guildId) =>
  many("SELECT * FROM shifts WHERE guild_id=$1 AND ended_at IS NULL ORDER BY started_at", [guildId]);
export const recentShifts = (guildId, userId, limit = 5) =>
  many("SELECT * FROM shifts WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT $3", [guildId, userId, limit]);

export const leaderboard = (guildId, since, type = "") =>
  many(
    `SELECT user_id, SUM(duration_ms)::bigint AS total, COUNT(*)::int AS sessions
     FROM shifts
     WHERE guild_id=$1 AND ended_at IS NOT NULL AND started_at >= $2 AND ($3 = '' OR shift_type = $3)
     GROUP BY user_id ORDER BY total DESC LIMIT 25`,
    [guildId, since, type],
  );

export async function userShiftStats(guildId, userId, since, type = "") {
  return (
    (await one(
      `SELECT COALESCE(SUM(duration_ms),0)::bigint AS total, COUNT(*)::int AS sessions
       FROM shifts
       WHERE guild_id=$1 AND user_id=$2 AND ended_at IS NOT NULL AND started_at >= $3 AND ($4 = '' OR shift_type = $4)`,
      [guildId, userId, since, type],
    )) ?? { total: 0, sessions: 0 }
  );
}

export const wipeShifts = async (guildId, userId) =>
  (await query("DELETE FROM shifts WHERE guild_id=$1 AND user_id=$2", [guildId, userId])).rowCount;

export async function adjustShiftTime(guildId, userId, deltaMs) {
  const now = Date.now();
  await query("INSERT INTO shifts (guild_id, user_id, shift_type, started_at, ended_at, duration_ms) VALUES ($1,$2,'default',$3,$3,$4)", [guildId, userId, now, deltaMs]);
}

/** % change in logged time this window vs the previous window of equal length. */
export async function weeklyTrend(guildId, userId, windowMs) {
  const now = Date.now();
  const cur = (await userShiftStats(guildId, userId, now - windowMs)).total || 0;
  const twoAgo = (await userShiftStats(guildId, userId, now - 2 * windowMs)).total || 0;
  const prev = twoAgo - cur;
  if (prev <= 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

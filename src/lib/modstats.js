import { many, one } from "./pg.js";

/** Cases a moderator issued in a window, with a per-type breakdown. */
export async function moderatorCaseStats(guildId, modId, since) {
  const rows = await many(
    "SELECT type, COUNT(*)::int AS n FROM mod_cases WHERE guild_id=$1 AND moderator_id=$2 AND created_at>=$3 GROUP BY type",
    [guildId, modId, since],
  );
  const byType = Object.fromEntries(rows.map((r) => [r.type, r.n]));
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  return { total, byType };
}

/** Top moderators by case count in a window. */
export const caseLeaderboard = (guildId, since) =>
  many(
    `SELECT moderator_id, COUNT(*)::int AS cases
     FROM mod_cases WHERE guild_id=$1 AND created_at>=$2
     GROUP BY moderator_id ORDER BY cases DESC LIMIT 25`,
    [guildId, since],
  );

/** Everyone who did staff work (a case OR a completed shift) in the window. */
export async function activeStaff(guildId, since) {
  const rows = await many(
    `SELECT moderator_id AS uid FROM mod_cases WHERE guild_id=$1 AND created_at>=$2
     UNION
     SELECT user_id AS uid FROM shifts WHERE guild_id=$1 AND ended_at IS NOT NULL AND started_at>=$2`,
    [guildId, since],
  );
  return [...new Set(rows.map((r) => r.uid))];
}

import { one, many, query, tx } from "./pg.js";

export const ROBLOX_TYPES = ["warn", "kick", "ban", "unban", "jail", "unjail", "note", "bolo"];
export const DISCORD_TYPES = ["warn", "kick", "ban", "unban", "timeout", "unmute", "softban", "note"];

export async function createCase({
  guildId,
  platform,
  subjectId,
  subjectName,
  type,
  reason,
  durationMs = null,
  moderatorId,
  moderatorTag,
  executed = true,
  erlcServerId = null,
}) {
  return tx(async (c) => {
    const {
      rows: [ctr],
    } = await c.query(
      `INSERT INTO guild_counters (guild_id, next_case) VALUES ($1, 2)
       ON CONFLICT (guild_id) DO UPDATE SET next_case = guild_counters.next_case + 1
       RETURNING next_case`,
      [guildId],
    );
    const caseNumber = ctr.next_case - 1;

    await c.query(
      `INSERT INTO mod_cases
        (guild_id, case_number, platform, subject_id, subject_name, type, reason, duration_ms,
         moderator_id, moderator_tag, created_at, executed, erlc_server_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        guildId,
        caseNumber,
        platform,
        String(subjectId),
        subjectName,
        type,
        reason || null,
        durationMs,
        moderatorId,
        moderatorTag || null,
        Date.now(),
        executed,
        erlcServerId,
      ],
    );
    return (await c.query("SELECT * FROM mod_cases WHERE guild_id=$1 AND case_number=$2", [guildId, caseNumber])).rows[0];
  });
}

export const getCase = (g, n) => one("SELECT * FROM mod_cases WHERE guild_id=$1 AND case_number=$2", [g, n]);
export const getSubjectCases = (g, p, s) =>
  many("SELECT * FROM mod_cases WHERE guild_id=$1 AND platform=$2 AND subject_id=$3 ORDER BY case_number DESC", [g, p, String(s)]);
export const getLastCaseByMod = (g, m) =>
  one("SELECT * FROM mod_cases WHERE guild_id=$1 AND moderator_id=$2 ORDER BY case_number DESC LIMIT 1", [g, m]);
export const getLastCase = (g) => one("SELECT * FROM mod_cases WHERE guild_id=$1 ORDER BY case_number DESC LIMIT 1", [g]);
export const getRecentCases = (g, limit = 25) =>
  many("SELECT * FROM mod_cases WHERE guild_id=$1 ORDER BY case_number DESC LIMIT $2", [g, limit]);

export const editReason = async (g, n, r) =>
  (await query("UPDATE mod_cases SET reason=$1 WHERE guild_id=$2 AND case_number=$3", [r, g, n])).rowCount > 0;
export const editType = async (g, n, t) =>
  (await query("UPDATE mod_cases SET type=$1 WHERE guild_id=$2 AND case_number=$3", [t, g, n])).rowCount > 0;
export const markExecuted = async (g, n, e) =>
  (await query("UPDATE mod_cases SET executed=$1 WHERE guild_id=$2 AND case_number=$3", [e, g, n])).rowCount > 0;
export const voidCase = async (g, n, by, r) =>
  (await query("UPDATE mod_cases SET voided=true, voided_by=$1, voided_reason=$2 WHERE guild_id=$3 AND case_number=$4 AND voided=false", [by, r || null, g, n])).rowCount > 0;

/** Non-voided case counts by type for a subject. */
export async function subjectStats(g, p, s) {
  const rows = await many(
    "SELECT type, COUNT(*)::int AS n FROM mod_cases WHERE guild_id=$1 AND platform=$2 AND subject_id=$3 AND voided=false GROUP BY type",
    [g, p, String(s)],
  );
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

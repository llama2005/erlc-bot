// Data layer for the operator ("ultimate admin") panel. Operators = config.ownerIds.
import { one, many, pool } from "../src/lib/pg.js";
import { config } from "../src/config.js";

export const isOperator = (userId) => !!userId && config.ownerIds.includes(String(userId));

export async function adminOverview() {
  const t0 = Date.now();
  const [
    guilds,
    members,
    cases,
    casesWeek,
    shifts,
    links,
    banreqs,
    appeals,
    loa,
    locks,
    topByMembers,
    topByCases,
    recentGuilds,
  ] = await Promise.all([
    one("SELECT count(*)::int n FROM bot_guilds WHERE removed_at IS NULL"),
    one("SELECT COALESCE(SUM(member_count),0)::bigint n FROM bot_guilds WHERE removed_at IS NULL"),
    one("SELECT count(*)::int n FROM mod_cases"),
    one("SELECT count(*)::int n FROM mod_cases WHERE created_at > $1", [Date.now() - 7 * 864e5]),
    one("SELECT count(*)::int n FROM shifts WHERE ended_at IS NOT NULL"),
    one("SELECT count(*)::int n FROM roblox_links"),
    one("SELECT count(*)::int n FROM ban_requests WHERE status='pending'"),
    one("SELECT count(*)::int n FROM appeals WHERE status='pending'"),
    one("SELECT count(*)::int n FROM loa WHERE status IN ('pending','active')"),
    one("SELECT count(*)::int n FROM bot_actions WHERE type='lock' AND acknowledged_at IS NULL"),
    many("SELECT guild_id, name, member_count FROM bot_guilds WHERE removed_at IS NULL ORDER BY member_count DESC NULLS LAST LIMIT 8"),
    many(
      `SELECT b.guild_id, b.name, count(m.*)::int cases
         FROM bot_guilds b LEFT JOIN mod_cases m ON m.guild_id = b.guild_id
        WHERE b.removed_at IS NULL GROUP BY b.guild_id, b.name ORDER BY cases DESC LIMIT 8`,
    ),
    many("SELECT guild_id, name, member_count, updated_at FROM bot_guilds WHERE removed_at IS NULL ORDER BY updated_at DESC LIMIT 8"),
  ]);

  return {
    dbMs: Date.now() - t0,
    version: (process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || "dev",
    uptime: Math.round(process.uptime()),
    stats: {
      guilds: guilds.n,
      members: Number(members.n),
      cases: cases.n,
      casesWeek: casesWeek.n,
      shifts: shifts.n,
      links: links.n,
      banreqs: banreqs.n,
      appeals: appeals.n,
      loa: loa.n,
      locks: locks.n,
    },
    topByMembers,
    topByCases,
    recentGuilds,
  };
}

export async function adminGuilds(q = "") {
  const rows = await many(
    `SELECT b.guild_id, b.name, b.member_count, b.owner_id, b.updated_at,
            (SELECT count(*)::int FROM mod_cases c WHERE c.guild_id = b.guild_id) cases,
            (SELECT count(*)::int FROM erlc_servers e WHERE e.guild_id = b.guild_id) erlc_servers
       FROM bot_guilds b
      WHERE b.removed_at IS NULL
      ORDER BY b.member_count DESC NULLS LAST`,
  );
  if (!q) return rows;
  const ql = q.toLowerCase();
  return rows.filter((r) => (r.name || "").toLowerCase().includes(ql) || r.guild_id.includes(q) || (r.owner_id || "").includes(q));
}

export const activeLocks = () =>
  many(
    `SELECT a.*, (SELECT string_agg(url, ' | ') FROM bot_action_proof p WHERE p.action_id = a.id) proof
       FROM bot_actions a
      WHERE a.type='lock' AND a.acknowledged_at IS NULL
      ORDER BY a.created_at DESC`,
  );

export const dbSelect1 = () => pool.query("SELECT 1");

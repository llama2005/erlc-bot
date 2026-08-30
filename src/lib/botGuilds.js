import { one, many, query, tx, GUILD_SCOPED_TABLES } from "./pg.js";

export async function syncBotGuild(guild) {
  await query(
    `INSERT INTO bot_guilds (guild_id, name, icon, member_count, owner_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (guild_id) DO UPDATE SET
       name=EXCLUDED.name, icon=EXCLUDED.icon, member_count=EXCLUDED.member_count,
       owner_id=EXCLUDED.owner_id, updated_at=EXCLUDED.updated_at, removed_at=NULL`,
    [guild.id, guild.name ?? null, guild.icon ?? null, guild.memberCount ?? null, guild.ownerId ?? null, Date.now()],
  );
}

/** Bot left / was kicked — keep the row (and the guild's data) for a grace period, then the purge job wipes it. */
export const removeBotGuild = (guildId) =>
  query("UPDATE bot_guilds SET removed_at=$2 WHERE guild_id=$1 AND removed_at IS NULL", [guildId, Date.now()]);

export const listBotGuilds = () => many("SELECT * FROM bot_guilds WHERE removed_at IS NULL ORDER BY name");
export const getBotGuild = (guildId) =>
  one("SELECT * FROM bot_guilds WHERE guild_id=$1 AND removed_at IS NULL", [guildId]);

/** Reconcile the whole table with the client's current guild list. */
export async function syncAllBotGuilds(client) {
  for (const g of client.guilds.cache.values()) await syncBotGuild(g);
  const ids = [...client.guilds.cache.keys()];
  if (ids.length)
    await query(
      "UPDATE bot_guilds SET removed_at=$2 WHERE guild_id <> ALL($1::text[]) AND removed_at IS NULL",
      [ids, Date.now()],
    );
}

/** Guilds removed longer ago than `cutoff` (ms epoch) — ready for a hard purge. */
export const listPurgeableGuilds = (cutoff) =>
  many("SELECT guild_id FROM bot_guilds WHERE removed_at IS NOT NULL AND removed_at < $1", [cutoff]);

/**
 * Hard-delete every guild-scoped row for one guild.
 * @param {{ dropBotGuild?: boolean }} opts  dropBotGuild: also remove the bot_guilds row
 *   (30-day purge of a departed guild). Omit for an in-place `/data delete` while the bot is still present.
 * @returns {Promise<number>} rows deleted across all tables
 */
export async function purgeGuildData(guildId, { dropBotGuild = false } = {}) {
  return tx(async (c) => {
    let rows = 0;
    for (const t of GUILD_SCOPED_TABLES) {
      const r = await c.query(`DELETE FROM ${t} WHERE guild_id=$1`, [guildId]);
      rows += r.rowCount ?? 0;
    }
    if (dropBotGuild) await c.query("DELETE FROM bot_guilds WHERE guild_id=$1", [guildId]);
    return rows;
  });
}

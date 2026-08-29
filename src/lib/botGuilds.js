import { one, many, query } from "./pg.js";

export async function syncBotGuild(guild) {
  await query(
    `INSERT INTO bot_guilds (guild_id, name, icon, member_count, owner_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (guild_id) DO UPDATE SET
       name=EXCLUDED.name, icon=EXCLUDED.icon, member_count=EXCLUDED.member_count,
       owner_id=EXCLUDED.owner_id, updated_at=EXCLUDED.updated_at`,
    [guild.id, guild.name ?? null, guild.icon ?? null, guild.memberCount ?? null, guild.ownerId ?? null, Date.now()],
  );
}

export const removeBotGuild = (guildId) => query("DELETE FROM bot_guilds WHERE guild_id=$1", [guildId]);
export const listBotGuilds = () => many("SELECT * FROM bot_guilds ORDER BY name");
export const getBotGuild = (guildId) => one("SELECT * FROM bot_guilds WHERE guild_id=$1", [guildId]);

/** Reconcile the whole table with the client's current guild list. */
export async function syncAllBotGuilds(client) {
  for (const g of client.guilds.cache.values()) await syncBotGuild(g);
  const ids = [...client.guilds.cache.keys()];
  if (ids.length) await query("DELETE FROM bot_guilds WHERE guild_id <> ALL($1::text[])", [ids]);
}

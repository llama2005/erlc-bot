import { one, many, query } from "./pg.js";

export const BUILTIN_TYPES = [
  { name: "warn", is_ban: false, ingame_cmd: null },
  { name: "kick", is_ban: false, ingame_cmd: ":kick {player}" },
  { name: "ban", is_ban: true, ingame_cmd: ":ban {player}" },
  { name: "unban", is_ban: false, ingame_cmd: ":unban {player}" },
  { name: "jail", is_ban: false, ingame_cmd: ":jail {player}" },
  { name: "unjail", is_ban: false, ingame_cmd: ":unjail {player}" },
  { name: "bolo", is_ban: false, ingame_cmd: null },
  { name: "note", is_ban: false, ingame_cmd: null },
];

/** All types for a guild: built-ins merged with custom (custom wins on name clash). */
export async function listModTypes(guildId) {
  const custom = await many("SELECT * FROM mod_types WHERE guild_id=$1", [guildId]);
  const byName = new Map(BUILTIN_TYPES.map((t) => [t.name, t]));
  for (const c of custom) byName.set(c.name, c);
  return [...byName.values()];
}

export async function getModType(guildId, name) {
  const n = String(name || "").toLowerCase();
  return (await one("SELECT * FROM mod_types WHERE guild_id=$1 AND name=$2", [guildId, n])) ?? BUILTIN_TYPES.find((t) => t.name === n) ?? null;
}

export async function addModType(guildId, name, { isBan = false, ingameCmd = null } = {}) {
  await query(
    `INSERT INTO mod_types (guild_id, name, is_ban, ingame_cmd) VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, name) DO UPDATE SET is_ban=EXCLUDED.is_ban, ingame_cmd=EXCLUDED.ingame_cmd`,
    [guildId, name.toLowerCase(), isBan, ingameCmd],
  );
}

export const removeModType = async (guildId, name) =>
  (await query("DELETE FROM mod_types WHERE guild_id=$1 AND name=$2", [guildId, name.toLowerCase()])).rowCount > 0;

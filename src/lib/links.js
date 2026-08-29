import { one, query } from "./pg.js";

export const getLinkByDiscord = (discordId) => one("SELECT * FROM roblox_links WHERE discord_id=$1", [discordId]);
export const getLinkByRoblox = (robloxId) => one("SELECT * FROM roblox_links WHERE roblox_id=$1", [String(robloxId)]);

export async function setLink(discordId, robloxId, robloxName) {
  await query(
    `INSERT INTO roblox_links (discord_id, roblox_id, roblox_name, linked_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (discord_id) DO UPDATE SET roblox_id=EXCLUDED.roblox_id, roblox_name=EXCLUDED.roblox_name, linked_at=EXCLUDED.linked_at`,
    [discordId, String(robloxId), robloxName, Date.now()],
  );
  return getLinkByDiscord(discordId);
}

export const removeLink = async (discordId) =>
  (await query("DELETE FROM roblox_links WHERE discord_id=$1", [discordId])).rowCount > 0;

// --- pending verifications (in-memory) ---
const pending = new Map();
const WORDS =
  "alpha bravo civic delta echo falcon golf hotel india juliet kilo lima metro nova oscar papa quebec radar sierra tango umbra victor whiskey xray yankee zulu".split(" ");

export function startVerification(discordId, robloxId, robloxName) {
  const code = Array.from({ length: 4 }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join(" ");
  pending.set(discordId, { robloxId, robloxName, code, expires: Date.now() + 15 * 60 * 1000 });
  return code;
}

export function getPending(discordId) {
  const p = pending.get(discordId);
  if (!p) return null;
  if (Date.now() > p.expires) {
    pending.delete(discordId);
    return null;
  }
  return p;
}

export const clearPending = (discordId) => pending.delete(discordId);

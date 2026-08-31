import { getLinkByDiscord, getLinkByRoblox } from "./links.js";
import { bloxlinkDiscordToRoblox, bloxlinkRobloxToDiscord } from "./bloxlink.js";
import { userById } from "./roblox.js";

// Our /verify table first; Bloxlink as a fallback for the (many) ER:LC communities that
// verify with Bloxlink instead. Return shape matches a roblox_links row so callers are
// unchanged, with `source` added.

/** @returns {Promise<{ discord_id, roblox_id, roblox_name, source: "verify"|"bloxlink" } | null>} */
export async function resolveDiscordLink(discordId, guildId) {
  const row = await getLinkByDiscord(discordId).catch(() => null);
  if (row) return { ...row, source: "verify" };
  const bl = await bloxlinkDiscordToRoblox(discordId, guildId);
  if (!bl) return null;
  const name = bl.robloxName || (await userById(bl.robloxId).then((u) => u?.name).catch(() => null));
  return { discord_id: String(discordId), roblox_id: bl.robloxId, roblox_name: name, source: "bloxlink" };
}

/** @returns {Promise<{ discord_id, roblox_id, roblox_name, source } | null>} */
export async function resolveRobloxLink(robloxId, guildId) {
  const row = await getLinkByRoblox(robloxId).catch(() => null);
  if (row) return { ...row, source: "verify" };
  const discordId = await bloxlinkRobloxToDiscord(robloxId, guildId);
  if (!discordId) return null;
  const name = await userById(robloxId).then((u) => u?.name).catch(() => null);
  return { discord_id: discordId, roblox_id: String(robloxId), roblox_name: name, source: "bloxlink" };
}

import { config } from "../config.js";

// Bloxlink public API (https://blox.link dashboard for a key). Enabled only when
// BLOXLINK_API_KEY is set — otherwise every function returns null and nothing changes.
const BASE = "https://api.blox.link/v4/public";
const cache = new Map(); // `d2r:<id>` | `r2d:<id>` -> { value, expires }
const TTL = 60 * 60_000;

async function get(path) {
  if (!config.bloxlinkApiKey) return null;
  try {
    const res = await fetch(BASE + path, { headers: { Authorization: config.bloxlinkApiKey } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function cached(k, fn) {
  const hit = cache.get(k);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return fn().then((value) => {
    cache.set(k, { value, expires: Date.now() + TTL });
    return value;
  });
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
}, 15 * 60_000).unref?.();

/** Discord id -> { robloxId, robloxName } via Bloxlink, or null. Guild-scoped when guildId given. */
export function bloxlinkDiscordToRoblox(discordId, guildId) {
  return cached(`d2r:${guildId || ""}:${discordId}`, async () => {
    const data =
      (guildId && (await get(`/guilds/${guildId}/discord-to-roblox/${discordId}`))) ||
      (await get(`/discord-to-roblox/${discordId}`));
    const id = data?.robloxID || data?.resolved?.roblox?.id;
    if (!id) return null;
    return { robloxId: String(id), robloxName: data?.resolved?.roblox?.name || data?.resolved?.roblox?.displayName || null };
  });
}

/** Roblox id -> Discord id via Bloxlink, or null. */
export function bloxlinkRobloxToDiscord(robloxId, guildId) {
  return cached(`r2d:${guildId || ""}:${robloxId}`, async () => {
    const data =
      (guildId && (await get(`/guilds/${guildId}/roblox-to-discord/${robloxId}`))) ||
      (await get(`/roblox-to-discord/${robloxId}`));
    const discordId = data?.discordIDs?.[0] || data?.discordID;
    return discordId ? String(discordId) : null;
  });
}

export const bloxlinkEnabled = () => !!config.bloxlinkApiKey;

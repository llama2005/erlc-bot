import { ActivityType } from "discord.js";

const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

/** Set the bot's "Watching N guilds and M users!" presence from the live cache. */
function apply(client) {
  if (!client.user) return;
  const guilds = client.guilds.cache.size;
  const users = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
  client.user.setPresence({
    status: "online",
    activities: [{ name: `${plural(guilds, "guild")} and ${plural(users, "user")}!`, type: ActivityType.Watching }],
  });
}

let debounce = null;

/**
 * Refresh the presence after a short delay. GuildCreate/GuildDelete can arrive in
 * bursts and Discord rate-limits presence updates (~5 / 20s), so coalesce them.
 */
export function bumpPresence(client) {
  clearTimeout(debounce);
  debounce = setTimeout(() => apply(client), 3_000);
  debounce.unref?.();
}

/** Apply once now and keep it fresh (member counts drift as people join/leave servers). */
export function startPresence(client, { intervalMs = 10 * 60_000 } = {}) {
  apply(client);
  const iv = setInterval(() => apply(client), intervalMs);
  iv.unref?.();
}

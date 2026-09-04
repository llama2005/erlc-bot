import { ActivityType } from "discord.js";
import { config } from "../config.js";

const fmt = (n) => n.toLocaleString("en-US");
const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

/** Set the bot's "Watching N guilds and M users!" presence. Aggregates across shards. */
async function apply(client) {
  if (!client.user) return;
  let guilds = client.guilds.cache.size;
  let users = client.guilds.cache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
  if (client.shard) {
    try {
      const per = await client.shard.broadcastEval((c) => ({
        g: c.guilds.cache.size,
        u: c.guilds.cache.reduce((s, x) => s + (x.memberCount || 0), 0),
      }));
      guilds = per.reduce((s, x) => s + x.g, 0);
      users = per.reduce((s, x) => s + x.u, 0);
    } catch {
      /* fall back to this shard's own numbers */
    }
  }
  guilds = Math.max(guilds, config.display.minGuilds || 0);
  users = Math.max(users, config.display.minMembers || 0);
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
  debounce = setTimeout(() => apply(client).catch(() => {}), 3_000);
  debounce.unref?.();
}

/** Apply once now and keep it fresh (member counts drift as people join/leave servers). */
export function startPresence(client, { intervalMs = 10 * 60_000 } = {}) {
  apply(client).catch(() => {});
  const iv = setInterval(() => apply(client).catch(() => {}), intervalMs);
  iv.unref?.();
}

import { erlc, splitPlayer } from "./erlc.js";
import { defaultServer } from "./erlcServers.js";
import { listModTypes } from "./modTypes.js";

// Short-lived cache so rapid keystrokes don't hammer the ER:LC API.
const CACHE_TTL = 5000;
const playerCache = new Map(); // guildId -> { at, players }

/** Drop cached player lists for guilds the bot is no longer in. */
export function prunePlayerCache(activeGuildIds) {
  const keep = new Set(activeGuildIds);
  for (const id of playerCache.keys()) if (!keep.has(id)) playerCache.delete(id);
}

async function livePlayers(guildId) {
  const cached = playerCache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.players;

  // Autocomplete can't see a sibling `server:` value, so suggest from the primary server.
  const key = defaultServer(guildId)?.api_key;
  if (!key) return [];

  let list = [];
  try {
    list = await erlc.players(key);
  } catch {
    list = [];
  }
  const players = (Array.isArray(list) ? list : []).map((p) => ({
    ...splitPlayer(p.Player),
    team: p.Team,
    permission: p.Permission,
  }));
  playerCache.set(guildId, { at: Date.now(), players });
  return players;
}

export const autocompleteProviders = {
  /** Suggests players currently in the ER:LC server. */
  async erlcPlayers(interaction, focused) {
    const q = String(focused || "").toLowerCase();
    const players = await livePlayers(interaction.guildId);
    return players
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((p) => ({
        name: `${p.name}${p.team ? ` — ${p.team}` : ""}${p.permission && p.permission !== "Normal" ? ` (${p.permission})` : ""}`.slice(0, 100),
        value: p.name,
      }));
  },

  /** Suggests this guild's moderation types. */
  async modTypes(interaction, focused) {
    const q = String(focused || "").toLowerCase();
    return (await listModTypes(interaction.guildId))
      .filter((t) => !q || t.name.includes(q))
      .slice(0, 25)
      .map((t) => ({ name: t.is_ban ? `${t.name} (ban)` : t.name, value: t.name }));
  },

  /** /config setting names. */
  async configSettings(interaction, focused) {
    const { CONFIG_SETTING_NAMES } = await import("../commands/config/config.js");
    const q = String(focused || "").toLowerCase();
    return CONFIG_SETTING_NAMES.filter((n) => !q || n.includes(q))
      .slice(0, 25)
      .map((n) => ({ name: n, value: n }));
  },

  /** Permission nodes for /permgroup. */
  async permNodes(interaction, focused) {
    const { NODES } = await import("./permissions.js");
    const q = String(focused || "").toLowerCase();
    return ["*", ...Object.keys(NODES)]
      .filter((n) => !q || n.includes(q))
      .slice(0, 25)
      .map((n) => ({ name: n === "*" ? "* (everything)" : n, value: n }));
  },

  /** Suggests VSM `:` commands the invoker is allowed to run. */
  async erlcCommands(interaction, focused) {
    const { catalogByTier, TIER_RANK } = await import("./erlcCommands.js");
    const { hasPermissionInteraction } = await import("./permissions.js");
    const canOwner = !!interaction.memberPermissions?.has("ManageGuild") || !!interaction.client.ownerIds?.includes(interaction.user.id);
    const canAdmin = canOwner || (await hasPermissionInteraction(interaction, "erlc.command"));
    const maxRank = canOwner ? 3 : canAdmin ? 2 : 1;

    const cat = catalogByTier();
    const all = [...cat.mod, ...cat.admin, ...cat.owner].filter((e) => TIER_RANK[e.tier] <= maxRank);
    const q = String(focused || "").replace(/^:+/, "").trim().split(/\s+/)[0].toLowerCase();
    return all
      .filter((e) => !q || e.name.startsWith(q))
      .slice(0, 25)
      .map((e) => ({ name: `:${e.name} ${e.usage}`.slice(0, 100).trim(), value: `${e.name} ` }));
  },

  /** Suggests this guild's connected ER:LC servers. */
  async erlcServers(interaction, focused) {
    const { getServers } = await import("./erlcServers.js");
    const q = String(focused || "").toLowerCase();
    return (await getServers(interaction.guildId))
      .filter((s) => !q || s.label.toLowerCase().includes(q))
      .slice(0, 25)
      .map((s) => ({ name: `${s.label}${s.is_default ? " (primary)" : ""}`.slice(0, 100), value: s.label }));
  },

  /** Suggests this guild's shift types. */
  async shiftTypes(interaction, focused) {
    const { listShiftTypes } = await import("./shifts.js");
    const q = String(focused || "").toLowerCase();
    return (await listShiftTypes(interaction.guildId))
      .filter((t) => !q || t.includes(q))
      .slice(0, 25)
      .map((t) => ({ name: t, value: t }));
  },
};

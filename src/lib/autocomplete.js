import { config } from "../config.js";
import { erlc, splitPlayer } from "./erlc.js";
import { getGuildConfig } from "./guildConfig.js";
import { listModTypes } from "./modTypes.js";

// Short-lived cache so rapid keystrokes don't hammer the ER:LC API.
const CACHE_TTL = 5000;
const playerCache = new Map(); // guildId -> { at, players }

async function livePlayers(guildId) {
  const cached = playerCache.get(guildId);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.players;

  const cfg = getGuildConfig(guildId);
  const key = cfg.erlcKey || config.erlc.devKey;
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

  /** Permission nodes for /permgroup. */
  async permNodes(interaction, focused) {
    const { NODES } = await import("./permissions.js");
    const q = String(focused || "").toLowerCase();
    return ["*", ...Object.keys(NODES)]
      .filter((n) => !q || n.includes(q))
      .slice(0, 25)
      .map((n) => ({ name: n === "*" ? "* (everything)" : n, value: n }));
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

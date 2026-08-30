/**
 * The ER:LC Virtual Server Management (`:`) command catalog used by `/erlc command`.
 * Tiers: mod (erlc.message) → admin (erlc.command) → owner (Manage Server).
 * `redirect` commands have a dedicated logging command and are blocked here.
 */
const CATALOG = {
  // --- mod tier — utility / RP, no case needed ---
  hint: { tier: "mod", minArgs: 1, usage: "[message]" },
  message: { tier: "mod", minArgs: 1, usage: "[message]" },
  pm: { tier: "mod", minArgs: 2, usage: "[player] [message]" },
  priority: { tier: "mod", minArgs: 1, usage: "[minutes]" },
  peacetime: { tier: "mod", minArgs: 1, usage: "[on/off | minutes]" },
  time: { tier: "mod", minArgs: 1, usage: "[0-24]" },
  startfire: { tier: "mod", minArgs: 0, usage: "(location)" },
  stopfire: { tier: "mod", minArgs: 0, usage: "" },
  refresh: { tier: "mod", minArgs: 1, usage: "[player]" },
  heal: { tier: "mod", minArgs: 1, usage: "[player]" },
  respawn: { tier: "mod", minArgs: 1, usage: "[player]" },
  load: { tier: "mod", minArgs: 1, usage: "[player]" },
  down: { tier: "mod", minArgs: 1, usage: "[player]" },
  wanted: { tier: "mod", minArgs: 1, usage: "[player]" },
  unwanted: { tier: "mod", minArgs: 1, usage: "[player]" },
  kill: { tier: "mod", minArgs: 1, usage: "[player]" },

  // --- have a dedicated logging command — blocked here ---
  kick: { redirect: "/kick" },
  jail: { redirect: "/jail" },
  arrest: { redirect: "/jail" },
  unjail: { redirect: "/unjail" },
  free: { redirect: "/unjail" },
  ban: { redirect: "/ban" },
  unban: { redirect: "/unban" },

  // --- admin tier ---
  weather: { tier: "admin", minArgs: 1, usage: "[clear|rain|fog|snow|thunderstorm]" },
  mod: { tier: "admin", minArgs: 1, usage: "[player/id]" },
  unmod: { tier: "admin", minArgs: 1, usage: "[player/id]" },
  loadlayout: { tier: "admin", minArgs: 1, usage: "[layout]" },
  unloadlayout: { tier: "admin", minArgs: 1, usage: "[layout]" },
  shutdown: { tier: "admin", minArgs: 0, usage: "" },

  // --- owner tier (Manage Server) ---
  admin: { tier: "owner", minArgs: 1, usage: "[player/id]" },
  unadmin: { tier: "owner", minArgs: 1, usage: "[player/id]" },
};

const ALIASES = {
  h: "hint",
  m: "message",
  privatemessage: "pm",
  prty: "priority",
  prio: "priority",
  pt: "peacetime",
};

export const TIER_NODE = { mod: "erlc.message", admin: "erlc.command" }; // owner handled inline
export const TIER_RANK = { mod: 1, admin: 2, owner: 3 };

/** Look up a `:` command by name or alias. Returns `{ name, ...entry }` or null. */
export function resolveErlcCommand(input) {
  const name = ALIASES[input] ?? input;
  const entry = CATALOG[name];
  return entry ? { name, ...entry } : null;
}

/** Runnable (non-redirect) commands grouped by tier, for the list embed. */
export function catalogByTier() {
  const out = { mod: [], admin: [], owner: [] };
  for (const [name, e] of Object.entries(CATALOG)) if (!e.redirect) out[e.tier].push({ name, ...e });
  return out;
}

import { one, many, query, notify, listen } from "./pg.js";
import { config } from "../config.js";

// Sync reads are served from this cache; it's warmed at startup and kept fresh on write.
const cache = new Map();

const COLUMNS = {
  prefix: { col: "prefix", def: () => config.defaultPrefix, store: (v) => (v === config.defaultPrefix ? null : v) },
  disabledCommands: { col: "disabled_commands", def: () => [] },
  disabledModules: { col: "disabled_modules", def: () => [] },
  modlogChannel: { col: "modlog_channel", def: () => null },
  commandLogChannel: { col: "command_log_channel", def: () => null },
  aiEnabled: { col: "ai_enabled", def: () => true },
  reasonRequired: { col: "reason_required", def: () => false },
  erlcKey: { col: "erlc_key", def: () => null },
  erlcStaffRole: { col: "erlc_staff_role", def: () => null },
  erlcAdminRole: { col: "erlc_admin_role", def: () => null },
  shiftRole: { col: "shift_role", def: () => null },
  banreqChannel: { col: "banreq_channel", def: () => null },
  joinLogChannel: { col: "join_log_channel", def: () => null },
  killLogChannel: { col: "kill_log_channel", def: () => null },
  ingameLogChannel: { col: "ingame_log_channel", def: () => null },
  modcallLogChannel: { col: "modcall_log_channel", def: () => null },
  sessionChannel: { col: "session_channel", def: () => null },
  sessionPingRole: { col: "session_ping_role", def: () => null },
  staffAlertChannel: { col: "staff_alert_channel", def: () => null },
  loaChannel: { col: "loa_channel", def: () => null },
  appealChannel: { col: "appeal_channel", def: () => null },
  quotaChannel: { col: "quota_channel", def: () => null },
  statusChannel: { col: "status_channel", def: () => null },
  announceChannel: { col: "announce_channel", def: () => null },
  ticketCategory: { col: "ticket_category", def: () => null },
  ticketStaffRole: { col: "ticket_staff_role", def: () => null },
  weeklyShiftQuota: { col: "weekly_shift_quota", def: () => 0 },
  weeklyCaseQuota: { col: "weekly_case_quota", def: () => 0 },
  ingameAutolog: { col: "ingame_autolog", def: () => true },
  ingameWarnTrigger: { col: "ingame_warn_trigger", def: () => "warn" },
};

function hydrate(row) {
  const out = { guildId: row.guild_id };
  for (const [key, meta] of Object.entries(COLUMNS)) {
    const raw = row[meta.col];
    out[key] = raw === null || raw === undefined ? meta.def() : raw;
  }
  return out;
}

function defaults(guildId) {
  const out = { guildId };
  for (const [key, meta] of Object.entries(COLUMNS)) out[key] = meta.def();
  return out;
}

/** Load every guild's config into the cache. Call once at startup. */
export async function warmGuildConfigs() {
  for (const row of await many("SELECT * FROM guild_config")) cache.set(row.guild_id, hydrate(row));
  return cache.size;
}

/** Ensure one guild is in the cache (call before handling its interactions). */
export async function ensureGuildConfig(guildId) {
  if (!guildId || cache.has(guildId)) return;
  await refreshGuildConfig(guildId);
}

/** Force a reload from the database (use where you need guaranteed-fresh data, e.g. the dashboard). */
export async function refreshGuildConfig(guildId) {
  if (!guildId) return defaults(null);
  const row = await one("SELECT * FROM guild_config WHERE guild_id = $1", [guildId]);
  const cfg = row ? hydrate(row) : defaults(guildId);
  cache.set(guildId, cfg);
  return cfg;
}

/** Synchronous — reads the cache (defaults if the guild isn't loaded yet). */
export function getGuildConfig(guildId) {
  if (!guildId) return defaults(null);
  return cache.get(guildId) ?? defaults(guildId);
}

/** Async — upserts the change and refreshes the cache. */
export async function setGuildConfig(guildId, patch) {
  const next = { ...getGuildConfig(guildId), ...patch, guildId };
  const setCols = [];
  const vals = [];
  for (const [key, meta] of Object.entries(COLUMNS)) {
    setCols.push(meta.col);
    vals.push(meta.store ? meta.store(next[key]) : next[key]);
  }
  const placeholders = setCols.map((_, i) => `$${i + 2}`);
  const conflict = setCols.map((c) => `${c} = EXCLUDED.${c}`);
  await query(
    `INSERT INTO guild_config (guild_id, ${setCols.join(", ")}) VALUES ($1, ${placeholders.join(", ")})
     ON CONFLICT (guild_id) DO UPDATE SET ${conflict.join(", ")}`,
    [guildId, ...vals],
  );
  cache.set(guildId, next);
  await notify("guild_config", guildId).catch(() => {});
  return next;
}

/** Keep this process's cache fresh when another process (e.g. the web dashboard) writes config. */
export async function startConfigSync() {
  await listen("guild_config", (guildId) => {
    cache.delete(guildId);
    ensureGuildConfig(guildId).catch(() => {});
  });
}

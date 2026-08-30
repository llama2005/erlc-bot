import { many, one, query, notify, listen } from "./pg.js";
import { config } from "../config.js";

// guildId -> ErlcServer[] (ordered: default first, then by created_at)
const cache = new Map();

// Dev/self-host convenience: a single ERLC_KEY env acts as one implicit server when
// no real ones are configured (never in production — see config.isDev).
const devServer = (guildId) =>
  config.isDev && config.erlc.devKey
    ? [{ id: 0, guild_id: guildId, label: "Dev", api_key: config.erlc.devKey, is_default: true, created_at: 0 }]
    : [];

const order = (rows) =>
  [...rows].sort((a, b) => Number(b.is_default) - Number(a.is_default) || Number(a.created_at) - Number(b.created_at));

async function load(guildId) {
  const rows = order(await many("SELECT * FROM erlc_servers WHERE guild_id=$1", [guildId]));
  cache.set(guildId, rows);
  return rows;
}

/** Warm the cache for every guild that has ≥1 server. Call once at startup. */
export async function warmErlcServers() {
  cache.clear();
  for (const row of await many("SELECT * FROM erlc_servers")) {
    const list = cache.get(row.guild_id) ?? [];
    list.push(row);
    cache.set(row.guild_id, list);
  }
  for (const [g, list] of cache) cache.set(g, order(list));
  return cache.size;
}

/** Async — ensures the guild's servers are loaded. */
export async function getServers(guildId) {
  if (!guildId) return [];
  const rows = cache.get(guildId) ?? (await load(guildId));
  return rows.length ? rows : devServer(guildId);
}

/** Sync — cache only (empty if not loaded yet). */
export const listServers = (guildId) => {
  const rows = cache.get(guildId) ?? [];
  return rows.length ? rows : devServer(guildId);
};

/** The primary server: the `is_default` one, else the first (list is default-first ordered), else null. */
export function defaultServer(guildId) {
  const list = listServers(guildId);
  return list.find((s) => s.is_default) ?? list[0] ?? null;
}

/**
 * Resolve a `server:` argument to one of the guild's servers.
 * @returns {{ server: object|null, matched: boolean }}
 *   matched:false + server:null when `arg` was given but nothing matched;
 *   matched:true + server:null when the guild simply has no servers.
 */
export async function resolveServer(guildId, arg) {
  const list = await getServers(guildId);
  const q = (arg ?? "").trim();
  if (!q) return { server: list.find((s) => s.is_default) ?? list[0] ?? null, matched: true };
  const lc = q.toLowerCase();
  const byId = list.find((s) => String(s.id) === q);
  if (byId) return { server: byId, matched: true };
  const exact = list.find((s) => s.label.toLowerCase() === lc);
  if (exact) return { server: exact, matched: true };
  const byLabel = list.find((s) => s.label.toLowerCase().includes(lc));
  return byLabel ? { server: byLabel, matched: true } : { server: null, matched: false };
}

export async function addServer(guildId, label, apiKey) {
  const existing = await getServers(guildId);
  const isDefault = existing.length === 0;
  const row = await one(
    "INSERT INTO erlc_servers (guild_id, label, api_key, is_default, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [guildId, label, apiKey, isDefault, Date.now()],
  );
  await load(guildId);
  await notify("erlc_servers", guildId).catch(() => {});
  return row;
}

export async function removeServer(guildId, id) {
  const removed = await one("DELETE FROM erlc_servers WHERE guild_id=$1 AND id=$2 RETURNING *", [guildId, id]);
  if (removed) {
    await query("DELETE FROM erlc_log_cursor WHERE server_id=$1", [id]).catch(() => {});
    await query("DELETE FROM erlc_server_status WHERE server_id=$1", [id]).catch(() => {});
    if (removed.is_default) {
      // promote the oldest remaining server
      const next = await one("SELECT id FROM erlc_servers WHERE guild_id=$1 ORDER BY created_at LIMIT 1", [guildId]);
      if (next) await query("UPDATE erlc_servers SET is_default=true WHERE id=$1", [next.id]);
    }
    await load(guildId);
    await notify("erlc_servers", guildId).catch(() => {});
  }
  return removed;
}

export async function renameServer(guildId, id, label) {
  const r = await query("UPDATE erlc_servers SET label=$3 WHERE guild_id=$1 AND id=$2", [guildId, id, label]);
  if (r.rowCount) {
    await load(guildId);
    await notify("erlc_servers", guildId).catch(() => {});
  }
  return r.rowCount > 0;
}

export async function setDefaultServer(guildId, id) {
  const r = await query(
    "UPDATE erlc_servers SET is_default = (id = $2) WHERE guild_id = $1",
    [guildId, id],
  );
  if (r.rowCount) {
    await load(guildId);
    await notify("erlc_servers", guildId).catch(() => {});
  }
  return r.rowCount > 0;
}

export async function startErlcServerSync() {
  await listen("erlc_servers", (guildId) => load(guildId).catch(() => {}));
}

export function forgetErlcServers(guildId) {
  cache.delete(guildId);
}

export function pruneErlcServerCache(activeGuildIds) {
  const keep = new Set(activeGuildIds);
  for (const id of cache.keys()) if (!keep.has(id)) cache.delete(id);
}

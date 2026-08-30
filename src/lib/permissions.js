import { one, many, query, notify, listen } from "./pg.js";
import { getGuildConfig } from "./guildConfig.js";

/**
 * Permission nodes — the granular capabilities a role can be granted.
 * `*` grants everything.
 */
export const NODES = {
  "case.view": "View moderation cases and history",
  "case.manage": "Edit reason/type and void ANY case (own cases are always editable)",
  "mod.warn": "Warn / note / BOLO players",
  "mod.kick": "Kick players in-game",
  "mod.jail": "Jail / unjail players",
  "mod.ban": "Ban / unban players directly",
  "mod.banreq": "Submit ban requests for approval",
  "mod.banreq.approve": "Approve or deny ban requests",
  "erlc.read": "Read ER:LC status, players, queue, logs",
  "erlc.message": "Send in-game PMs / hints / messages",
  "erlc.command": "Run raw in-game :commands",
  "session": "Post SSU / SSD announcements",
  "shift.self": "Clock in/out and view own shift stats",
  "shift.admin": "Adjust / wipe other users' shift time, run shift activity",
  "config": "Change server settings and permission groups",
};

/** What the built-in `erlc-role` (staff) grants when no custom group covers the member. */
const STAFF_BUNDLE = new Set([
  "case.view",
  "mod.warn",
  "mod.kick",
  "mod.jail",
  "mod.banreq",
  "erlc.read",
  "erlc.message",
  "session",
  "shift.self",
]);

/** What the built-in `erlc-admin-role` grants. */
const ADMIN_BUNDLE = new Set(Object.keys(NODES)); // everything except `config` stays Manage-Server-gated below
ADMIN_BUNDLE.delete("config");

// ---- storage: named, role-linked permission groups ----

const cache = new Map(); // guildId -> [{ role_id, name, nodes: string[] }]

async function loadGroups(guildId) {
  const rows = await many("SELECT role_id, name, nodes FROM perm_groups WHERE guild_id=$1", [guildId]);
  cache.set(guildId, rows);
  return rows;
}

export async function getPermGroups(guildId) {
  return cache.get(guildId) ?? (await loadGroups(guildId));
}

export async function upsertPermGroup(guildId, roleId, name, nodes) {
  await query(
    `INSERT INTO perm_groups (guild_id, role_id, name, nodes) VALUES ($1,$2,$3,$4)
     ON CONFLICT (guild_id, role_id) DO UPDATE SET name=EXCLUDED.name, nodes=EXCLUDED.nodes`,
    [guildId, roleId, name, nodes],
  );
  await loadGroups(guildId);
  await notify("perm_groups", guildId).catch(() => {});
}

export async function deletePermGroup(guildId, roleId) {
  const r = await query("DELETE FROM perm_groups WHERE guild_id=$1 AND role_id=$2", [guildId, roleId]);
  await loadGroups(guildId);
  await notify("perm_groups", guildId).catch(() => {});
  return r.rowCount > 0;
}

export async function startPermSync() {
  await listen("perm_groups", (guildId) => loadGroups(guildId).catch(() => {}));
}

/** Forget one guild's cached perm groups (e.g. after a data wipe). */
export function forgetPermGroups(guildId) {
  cache.delete(guildId);
}

/** Drop cached perm groups for guilds the bot is no longer in. */
export function prunePermCache(activeGuildIds) {
  const keep = new Set(activeGuildIds);
  for (const id of cache.keys()) if (!keep.has(id)) cache.delete(id);
  return cache.size;
}

// ---- the check ----

function memberRoleIds(ctx) {
  const c = ctx.member?.roles?.cache;
  return c ? [...c.keys()] : [];
}

/**
 * Does the invoking member hold `node` in this guild?
 * Order: owner / Manage Server → admin role → any matching perm group → staff bundle.
 */
export async function hasPermission(ctx, node) {
  if (!ctx.guild) return false;
  if (ctx.isOwner || ctx.permissions.has("ManageGuild")) return true;

  const cfg = getGuildConfig(ctx.guild.id);
  const roleIds = new Set(memberRoleIds(ctx));

  if (cfg.erlcAdminRole && roleIds.has(cfg.erlcAdminRole) && ADMIN_BUNDLE.has(node)) return true;

  for (const g of await getPermGroups(ctx.guild.id)) {
    if (!roleIds.has(g.role_id)) continue;
    if (g.nodes.includes("*") || g.nodes.includes(node)) return true;
  }

  if (cfg.erlcStaffRole && roleIds.has(cfg.erlcStaffRole) && STAFF_BUNDLE.has(node)) return true;

  return false;
}

/** hasPermission for a raw component/modal interaction (no Context object). */
export function hasPermissionInteraction(interaction, node) {
  const ctx = {
    guild: interaction.guild,
    isOwner: interaction.client?.ownerIds?.includes(interaction.user.id),
    permissions: interaction.memberPermissions ?? { has: () => false },
    member: interaction.member,
  };
  return hasPermission(ctx, node);
}

/** A `check` function for a command: `check: requirePermission("mod.kick")`. */
export function requirePermission(node) {
  return async (ctx) => {
    if (await hasPermission(ctx, node)) return true;
    return `You don't have permission for this (\`${node}\`). An admin can grant it with \`/permgroup\` or on the dashboard.`;
  };
}

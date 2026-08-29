// Reusable command `check` functions. Each returns `true` or a string reason for denial.

/** Server owner / Manage Server bypass, otherwise the guild's configured ER:LC staff role. */
export function erlcStaff(ctx) {
  if (ctx.isOwner) return true;
  if (ctx.permissions.has("ManageGuild")) return true;
  const roleId = ctx.config.erlcStaffRole;
  if (roleId && ctx.member?.roles?.cache?.has(roleId)) return true;
  return roleId
    ? "You need the ER:LC staff role (or Manage Server) to use this."
    : "This requires Manage Server until a staff role is set with `config erlc-role @role`.";
}

/** Manage Server (or owner) only. */
export function manageGuild(ctx) {
  return ctx.isOwner || ctx.permissions.has("ManageGuild")
    ? true
    : "This requires the **Manage Server** permission.";
}

/** Senior staff: owner / Manage Server / the configured ER:LC admin role. */
export function erlcAdmin(ctx) {
  if (ctx.isOwner) return true;
  if (ctx.permissions.has("ManageGuild")) return true;
  const roleId = ctx.config.erlcAdminRole;
  if (roleId && ctx.member?.roles?.cache?.has(roleId)) return true;
  return roleId
    ? "You need the ER:LC **admin** role (or Manage Server) for this."
    : "This requires Manage Server until an admin role is set with `config erlc-admin-role @role`.";
}

/** True/false variant of {@link erlcAdmin} for use inside command bodies. */
export function isErlcAdmin(ctx) {
  return erlcAdmin(ctx) === true;
}


import { getGuildConfig } from "./guildConfig.js";

/** Add or remove the configured on-duty role for a member (best-effort). */
export async function applyShiftRole(guild, userId, add) {
  const roleId = getGuildConfig(guild.id).shiftRole;
  if (!roleId || !guild.members.me?.permissions.has("ManageRoles")) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await (add ? member.roles.add(roleId) : member.roles.remove(roleId)).catch(() => {});
}

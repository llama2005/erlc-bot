import { resolveErlcKey } from "../../config.js";

export { erlcStaff, manageGuild } from "../../lib/checks.js";

/** Resolve the ER:LC Server-Key for this guild (guild-configured; dev fallback only outside prod). */
export function erlcKey(ctx) {
  return resolveErlcKey(ctx.config);
}

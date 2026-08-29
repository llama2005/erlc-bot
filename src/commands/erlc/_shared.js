import { config } from "../../config.js";

export { erlcStaff, manageGuild } from "../../lib/checks.js";

/** Resolve the ER:LC Server-Key for this guild (guild-configured, else the bot-wide fallback). */
export function erlcKey(ctx) {
  return ctx.config.erlcKey || config.erlc.devKey || null;
}

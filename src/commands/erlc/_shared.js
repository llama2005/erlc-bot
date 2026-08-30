import { ErlcError } from "../../lib/erlc.js";
import { resolveServer } from "../../lib/erlcServers.js";

export { erlcStaff, manageGuild } from "../../lib/checks.js";

/** Optional `server:` argument — attach to any command that talks to an ER:LC server. */
export const SERVER_ARG = {
  name: "server",
  type: "string",
  required: false,
  description: "Which ER:LC server (default: the primary one)",
  autocomplete: "erlcServers",
};

const NOT_CONNECTED =
  "ER:LC isn't connected for this server yet — an admin can add one with `/erlcserver add` or on the dashboard.";

/**
 * Resolve `ctx.args.server` to one of the guild's ER:LC servers.
 * @returns {{ id: number, label: string, api_key: string }}
 * @throws {ErlcError} when nothing is connected, or the given name matches nothing.
 */
export async function erlcServerFor(ctx) {
  const { server, matched } = await resolveServer(ctx.guild.id, ctx.args?.server);
  if (server) return server;
  throw new ErlcError(
    matched ? NOT_CONNECTED : `No ER:LC server called \`${ctx.args.server}\`. Use \`/erlcserver list\` to see them.`,
  );
}

/** Just the Server-Key, or null (no throw) — for paths where ER:LC is optional. */
export async function erlcKeyFor(ctx) {
  const { server } = await resolveServer(ctx.guild.id, ctx.args?.server);
  return server?.api_key ?? null;
}

import { erlc, splitPlayer, ErlcError } from "./erlc.js";
import { userById, userByUsername } from "./roblox.js";
import { getLinkByDiscord } from "./links.js";

/**
 * Resolve a player reference (in-game name, @name, numeric ID, or "name:id") to a
 * Roblox identity, checking the live server first.
 * @returns {Promise<{id: string|null, name: string, online: boolean, team?: string, permission?: string} | null>}
 */
export async function resolvePlayer(key, input) {
  const raw = String(input).trim().replace(/^@/, "");
  if (!raw) return null;

  // Discord mention / ID → linked Roblox account
  const discordId = raw.match(/^<@!?(\d+)>$/)?.[1] || (/^\d{17,20}$/.test(raw) ? raw : null);
  let linkedId = null;
  let searchName = raw;
  if (discordId) {
    const link = await getLinkByDiscord(discordId);
    if (!link) return { unlinkedDiscordId: discordId };
    linkedId = link.roblox_id;
    searchName = link.roblox_name;
  }

  // "name:id" shorthand
  const colon = searchName.match(/^(.+):(\d{2,})$/);
  if (colon) return { id: colon[2], name: colon[1], online: false };

  let players = [];
  try {
    players = await erlc.players(key);
  } catch {
    players = [];
  }
  const parsed = (Array.isArray(players) ? players : []).map((p) => ({ ...splitPlayer(p.Player), team: p.Team, permission: p.Permission }));

  const lower = searchName.toLowerCase();
  const online = linkedId
    ? parsed.find((p) => p.id === linkedId)
    : parsed.find((p) => p.name.toLowerCase() === lower) ||
      parsed.find((p) => p.name.toLowerCase().startsWith(lower)) ||
      parsed.find((p) => p.name.toLowerCase().includes(lower));
  if (online) return { ...online, online: true };

  if (linkedId) return { id: linkedId, name: searchName, online: false };

  // Not in the server — fall back to a Roblox lookup so we can still log / ban.
  if (/^\d{2,}$/.test(raw)) {
    const u = await userById(raw).catch(() => null);
    if (u) return { id: String(u.id), name: u.name, online: false };
  }
  const hit = await userByUsername(raw).catch(() => null);
  if (hit) return { id: String(hit.id), name: hit.name, online: false };

  return null;
}

/** Send an in-game PM (best-effort — returns false if it fails). */
export async function pm(key, playerName, message) {
  try {
    await erlc.command(key, `:pm ${playerName} ${message}`);
    return true;
  } catch (err) {
    if (err instanceof ErlcError) return false;
    throw err;
  }
}

const VERB = {
  warn: "warned",
  kick: "kicked",
  ban: "banned",
  unban: "unbanned",
  jail: "jailed",
  unjail: "released",
};

/** Standard in-game notification text for an action. */
export function notifyText(type, { reason, moderatorTag, caseNumber }) {
  const parts = [`[SERVER] You were ${VERB[type] || type} by ${moderatorTag}.`];
  if (reason) parts.push(`Reason: ${reason}`);
  parts.push(`(Case #${caseNumber})`);
  return parts.join(" ");
}

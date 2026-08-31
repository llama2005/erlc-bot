import { erlc, splitPlayer } from "./erlc.js";
import { getGuildConfig } from "./guildConfig.js";
import { resolveRobloxLink } from "./resolveLink.js";
import { startShift, endShift } from "./shifts.js";
import { logShiftEvent } from "./shiftLog.js";
import { applyShiftRole } from "./shiftRole.js";
import { formatDuration } from "./util.js";
import { isEnabled } from "./flags.js";

// ER:LC only logs valid `:` commands (`:pm`, `:kick`, …) in /server/commandlogs — a
// bare `!clockin` / `:clockin` never reaches the API. So the reliable trigger is a PM:
//   :pm <anyone> clockin      → clocks IN the person who ran it
//   :pm <anyone> clockout     → clocks them OUT
// Bare forms are still matched in case a server's setup happens to surface them.
const IN = String.raw`clock\s*in|ci|on\s*duty`;
const OUT = String.raw`clock\s*out|co|off\s*duty`;
const IN_RE = new RegExp(String.raw`^(?::pm\s+\S+\s+|[!:.\/]*\s*)(?:${IN})\s*$`, "i");
const OUT_RE = new RegExp(String.raw`^(?::pm\s+\S+\s+|[!:.\/]*\s*)(?:${OUT})\s*$`, "i");

/**
 * React to `:pm <x> clockin` / `:pm <x> clockout` typed in-game (fresh /server/commandlogs
 * entries). Maps the Roblox player who ran it to their linked Discord account and
 * starts/ends the shift, confirming both in-game and by Discord DM.
 */
export async function handleIngameShifts(client, guildId, server, entries) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.ingameShiftCommands || !isEnabled("ingame-shifts", { guildId })) return;
  const guild = client.guilds.cache.get(guildId);

  for (const e of entries) {
    const cmd = String(e.Command || "").trim();
    const isIn = IN_RE.test(cmd);
    const isOut = OUT_RE.test(cmd);
    if (!isIn && !isOut) continue;

    const { name, id } = splitPlayer(e.Player);
    const link = id ? await resolveRobloxLink(id).catch(() => null) : null;
    if (!link?.discord_id) {
      await pm(server, name, "Link your Discord with /verify first, then you can clock in here.").catch(() => {});
      continue;
    }
    const uid = link.discord_id;

    if (isIn) {
      const s = await startShift(guildId, uid, "default");
      if (!s) {
        await pm(server, name, "You're already clocked in.").catch(() => {});
        continue;
      }
      if (guild) {
        await applyShiftRole(guild, uid, true);
        await logShiftEvent(client, guildId, { kind: "in", userId: uid, type: "default", shift: s });
      }
      await pm(server, name, "You're now clocked in.").catch(() => {});
      await dm(client, uid, `You clocked in from **${guild?.name ?? "the game"}**.`);
    } else {
      const s = await endShift(guildId, uid);
      if (!s) {
        await pm(server, name, "You're not clocked in.").catch(() => {});
        continue;
      }
      if (guild) {
        await applyShiftRole(guild, uid, false);
        await logShiftEvent(client, guildId, { kind: "out", userId: uid, shift: s });
      }
      const dur = formatDuration(s.duration_ms);
      await pm(server, name, `Clocked out — ${dur} this shift.`).catch(() => {});
      await dm(client, uid, `You clocked out from **${guild?.name ?? "the game"}** — **${dur}** this shift.`);
    }
  }
}

// erlc.command self-throttles (1/5s per key), so this just queues.
const pm = (server, playerName, message) => erlc.command(server.api_key, `:pm ${playerName} ${message}`);

async function dm(client, userId, content) {
  const user = await client.users.fetch(userId).catch(() => null);
  await user?.send(content).catch(() => {});
}

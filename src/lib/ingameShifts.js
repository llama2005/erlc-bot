import { erlc, splitPlayer } from "./erlc.js";
import { getGuildConfig } from "./guildConfig.js";
import { getLinkByRoblox } from "./links.js";
import { startShift, endShift } from "./shifts.js";
import { logShiftEvent } from "./shiftLog.js";
import { applyShiftRole } from "./shiftRole.js";
import { formatDuration } from "./util.js";

// Prefix-agnostic so we catch whatever ER:LC surfaces in the command logs:
// "!clockin", ":clockin", "clock in", "clockin", "ci", and also ":pm <x> clockin".
const CLEAN = (s) => String(s || "").trim().replace(/^:pm\s+\S+\s+/i, "").replace(/^[!:./]+\s*/, "").trim().toLowerCase();
const IN_RE = /^(clock\s*in|ci|on\s*duty)$/;
const OUT_RE = /^(clock\s*out|co|off\s*duty)$/;

/**
 * React to `!clockin` / `!clockout` typed in-game (from fresh /server/commandlogs entries).
 * Maps the Roblox player to their linked Discord account and starts/ends the shift.
 */
export async function handleIngameShifts(client, guildId, server, entries) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.ingameShiftCommands) return;
  const guild = client.guilds.cache.get(guildId);

  for (const e of entries) {
    const c = CLEAN(e.Command);
    const isIn = IN_RE.test(c);
    const isOut = OUT_RE.test(c);
    if (!isIn && !isOut) continue;

    const { name, id } = splitPlayer(e.Player);
    const link = id ? await getLinkByRoblox(id).catch(() => null) : null;
    if (!link?.discord_id) {
      await pm(server, name, "You must link your Discord account with /verify before you can clock in here.").catch(() => {});
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
      await pm(server, name, "You're now clocked in. ✅").catch(() => {});
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
      await pm(server, name, `Clocked out — ${formatDuration(s.duration_ms)} this shift. ✅`).catch(() => {});
    }
  }
}

// erlc.command self-throttles (1/5s per key), so this just queues.
const pm = (server, playerName, message) => erlc.command(server.api_key, `:pm ${playerName} ${message}`);

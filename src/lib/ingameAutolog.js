import { splitPlayer } from "./erlc.js";
import { getGuildConfig } from "./guildConfig.js";
import { query } from "./pg.js";
import { resolveRobloxLink } from "./resolveLink.js";
import { userByUsername } from "./roblox.js";
import { createCase } from "./cases.js";
import { subjectStats } from "./cases.js";
import { headshotUrl } from "./roblox.js";
import { logCase } from "./caseLog.js";
import { fileBanRequest } from "./banRequests.js";
import { caseEmbed } from "./style.js";

const ACTION_RE = /^:(kick|ban|unban|jail|unjail)\s+(.+?)\s*$/i;
const BOLO_TYPES = new Set(["kick", "ban"]);

/** Resolve an in-game name to {id,name}. Tries the live player list, then a Roblox lookup. */
async function resolveTarget(rawName, players) {
  const q = rawName.trim().toLowerCase();
  const hit = (players || []).map((p) => splitPlayer(p.Player)).find((p) => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q));
  if (hit?.id) return hit;
  const u = await userByUsername(rawName.trim()).catch(() => null);
  if (u) return { id: String(u.id), name: u.name };
  return { id: null, name: rawName.trim() };
}

/** Resolve the staff member who ran the command to a moderator identity. */
async function resolveModerator(entryPlayer) {
  const { name, id } = splitPlayer(entryPlayer);
  const link = id ? await resolveRobloxLink(id).catch(() => null) : null;
  return link
    ? { moderatorId: link.discord_id, moderatorTag: `${name} (in-game)` }
    : { moderatorId: id || name, moderatorTag: `${name} (in-game)` };
}

/**
 * Look at fresh /server/commandlogs entries and auto-create moderation cases for
 * `:kick` / `:ban` / … and for `:pm <player> <trigger> <reason>` warns.
 * Returns the number of cases created.
 */
export async function autologCommandEntries(client, guildId, serverId, entries, players) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.ingameAutolog) return 0;
  const trigger = (cfg.ingameWarnTrigger || "warn").toLowerCase();
  const pmWarnRe = new RegExp(`^:pm\\s+(\\S+)\\s+${trigger}\\b\\s*(.*)$`, "i");

  let created = 0;
  for (const e of entries) {
    const rawCmd = String(e.Command || "").trim();
    const bolo = /(^|\s)--bolo(\s|$)/i.test(rawCmd);
    const cmd = rawCmd.replace(/\s--\w+\b/gi, "").trim(); // drop any --flags before parsing
    let type = null;
    let targetName = null;
    let reason = null;

    const m = cmd.match(ACTION_RE);
    if (m) {
      type = m[1].toLowerCase();
      targetName = m[2].split(/\s+/)[0]; // first token after the command
    } else {
      const pm = cmd.match(pmWarnRe);
      if (pm) {
        type = "warn";
        targetName = pm[1];
        reason = pm[2]?.trim() || null;
      }
    }
    if (!type || !targetName) continue;

    const target = await resolveTarget(targetName, players);
    const { moderatorId, moderatorTag } = await resolveModerator(e.Player);

    const c = await createCase({
      guildId,
      platform: "roblox",
      subjectId: target.id ?? targetName,
      subjectName: target.name,
      type,
      reason: reason || `In-game \`${cmd}\``,
      moderatorId,
      moderatorTag,
      executed: true,
    });
    // mark the source + which ER:LC server it came from
    await query("UPDATE mod_cases SET source='ingame', erlc_server_id=$3 WHERE guild_id=$1 AND case_number=$2", [
      guildId,
      c.case_number,
      serverId || null,
    ]);

    if (bolo && BOLO_TYPES.has(type) && target.id)
      await fileBanRequest({
        guild: { id: guildId },
        client,
        robloxId: target.id,
        robloxName: target.name,
        reason: c.reason,
        requestedBy: moderatorId,
        sourceCase: c.case_number,
      }).catch(() => {});

    const headshot = target.id ? await headshotUrl(target.id).catch(() => null) : null;
    const stats = await subjectStats(guildId, "roblox", target.id ?? targetName);
    const summary = Object.entries(stats).map(([t, n]) => `${n}× ${t}`).join(" · ") || "no prior cases";

    const embed = caseEmbed({
      caseNumber: c.case_number,
      type,
      reason: c.reason,
      target: { name: target.name, id: target.id, headshot },
      moderator: { id: moderatorId, tag: moderatorTag },
      createdAt: (e.Timestamp || 0) * 1000 || Date.now(),
      extraFields: [{ name: "History", value: summary, inline: true }],
      footer: "auto-logged from in-game",
    });
    // moderator_id may be a Roblox id — render a plain tag instead of a broken mention
    if (!/^\d{17,20}$/.test(String(moderatorId))) {
      embed.spliceFields(
        embed.data.fields.findIndex((f) => f.name === "Moderator"),
        1,
        { name: "Moderator", value: moderatorTag, inline: true },
      );
    }

    const guild = client.guilds.cache.get(guildId);
    if (guild) await logCase(guild, c, embed).catch(() => {});
    created++;
  }
  return created;
}

import { Events, AuditLogEvent } from "discord.js";
import { getGuildConfig } from "./guildConfig.js";
import { createCase } from "./cases.js";
import { logCase, renderCaseEmbed } from "./caseLog.js";

const ACTION_TYPE = {
  [AuditLogEvent.MemberBanAdd]: "ban",
  [AuditLogEvent.MemberBanRemove]: "unban",
  [AuditLogEvent.MemberKick]: "kick",
};

/**
 * Auto-create a case whenever a member is banned / unbanned / kicked / timed-out
 * directly in Discord (not through the bot). Opt-in per guild (`logExternalModeration`).
 * Requires the `GuildModeration` intent + the bot having View Audit Log in the guild.
 */
let registered = false;

export function registerExternalModlog(client) {
  if (registered) return;
  registered = true;
  client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
    try {
      if (!guild || !getGuildConfig(guild.id).logExternalModeration) return;
      if (entry.executorId === client.user.id) return; // the bot logs its own actions

      let type = ACTION_TYPE[entry.action];
      let durationMs = null;
      if (!type) {
        if (entry.action !== AuditLogEvent.MemberUpdate) return;
        const change = entry.changes?.find((c) => c.key === "communication_disabled_until");
        if (!change) return; // a nickname / role change, not a timeout
        if (change.new == null) type = "unmute";
        else {
          type = "timeout";
          durationMs = Math.max(0, new Date(change.new).getTime() - Date.now());
        }
      }

      const target = await client.users.fetch(entry.targetId).catch(() => null);
      if (!target) return;
      const executor = entry.executor ?? (await client.users.fetch(entry.executorId).catch(() => null));

      const c = await createCase({
        guildId: guild.id,
        platform: "discord",
        subjectId: target.id,
        subjectName: target.tag ?? target.username,
        type,
        reason: entry.reason || null,
        durationMs,
        moderatorId: entry.executorId,
        moderatorTag: executor?.tag ?? executor?.username ?? entry.executorId,
        executed: true,
        source: "external",
      });

      await logCase(guild, c, await renderCaseEmbed(guild, c)).catch(() => {});
    } catch (e) {
      console.error("external modlog:", e.message);
    }
  });
}

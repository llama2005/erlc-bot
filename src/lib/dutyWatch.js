import { EmbedBuilder } from "discord.js";
import { getGuildConfig } from "./guildConfig.js";
import { getActiveShift } from "./shifts.js";
import { isOnLoa } from "./loa.js";
import { resolveSendable } from "./modlog.js";
import { COLORS } from "./style.js";

/** Permission nodes that count as "doing staff work" and should require being on duty. */
export const DUTY_NODES = new Set([
  "mod.warn",
  "mod.kick",
  "mod.jail",
  "mod.ban",
  "mod.banreq",
  "mod.banreq.approve",
  "case.manage",
  "erlc.message",
  "erlc.command",
  "session",
]);

/**
 * If the guild has a staff-alert channel and the user isn't clocked in, post an alert.
 * Never throws.
 */
export async function reportOffDuty(client, { guild, userId, userTag, action, detail, invokedIn }) {
  try {
    if (!guild) return;
    const cfg = getGuildConfig(guild.id);
    if (!cfg.staffAlertChannel) return;
    if (guild.ownerId === userId) return; // the server owner is always "on duty"

    if (await getActiveShift(guild.id, userId)) return; // clocked in — fine
    if (await isOnLoa(guild.id, userId)) return; // on approved leave — excused

    const { channel } = await resolveSendable(client, cfg.staffAlertChannel);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.warn)
      .setAuthor({ name: "⚠️ Off-duty staff activity" })
      .setDescription(`<@${userId}> used **${action}** while **not clocked in**.`)
      .addFields(
        { name: "Staff member", value: `<@${userId}>${userTag ? ` · ${userTag}` : ""}`, inline: true },
        { name: "Channel", value: invokedIn ? `<#${invokedIn}>` : "—", inline: true },
      )
      .setTimestamp();
    if (detail) embed.addFields({ name: "Details", value: String(detail).slice(0, 1024) });

    await channel.send({ content: cfg.erlcAdminRole ? `<@&${cfg.erlcAdminRole}>` : undefined, embeds: [embed], allowedMentions: { roles: cfg.erlcAdminRole ? [cfg.erlcAdminRole] : [] } });
  } catch {
    /* alerting must never break the command */
  }
}

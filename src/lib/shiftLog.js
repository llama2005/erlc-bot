import { EmbedBuilder } from "discord.js";
import { getGuildConfig } from "./guildConfig.js";
import { resolveSendable } from "./modlog.js";
import { COLORS } from "./style.js";
import { formatDuration } from "./util.js";

/**
 * Post a Whisp-style shift event to the guild's shift-log channel (best-effort).
 *
 * @param {import("discord.js").Client} client
 * @param {string} guildId
 * @param {object} ev
 * @param {"in"|"out"|"admin"} ev.kind
 * @param {string} [ev.userId]    the staff member the shift belongs to
 * @param {string} [ev.type]      shift type name (for "in")
 * @param {object} [ev.shift]     the shift row (for the footer id + duration)
 * @param {string} [ev.adminId]   set when a shift-admin did this on someone's behalf
 * @param {string} [ev.action]    free-text for kind:"admin" (e.g. "added 30m to")
 */
export async function logShiftEvent(client, guildId, ev) {
  const chId = getGuildConfig(guildId).shiftLogChannel;
  if (!chId) return;
  const { channel } = await resolveSendable(client, chId, guildId);
  if (!channel) return;

  const embed = new EmbedBuilder();
  if (ev.shift?.id) embed.setFooter({ text: `Shift: ${ev.shift.id}` });

  if (ev.kind === "in") {
    embed
      .setColor(COLORS.clockIn)
      .setTitle("Clocked In")
      .setDescription(`<@${ev.userId}> clocked in${ev.type && ev.type !== "default" ? ` as **${ev.type}**` : ""}.`);
    if (ev.adminId) embed.addFields({ name: "Admin", value: `<@${ev.adminId}>`, inline: true });
  } else if (ev.kind === "out") {
    const dur = ev.shift?.duration_ms ? ` — **${formatDuration(ev.shift.duration_ms)}** this shift` : "";
    embed.setColor(COLORS.clockOut).setTitle("Clocked Out").setDescription(`<@${ev.userId}> clocked out${dur}.`);
    if (ev.adminId) embed.addFields({ name: "Admin", value: `<@${ev.adminId}>`, inline: true });
  } else {
    // kind: "admin" — an adjustment made from the shift-admin panel
    embed.setColor(COLORS.clockOut).setTitle("Shift Adjusted").setDescription(`<@${ev.adminId}> ${ev.action} <@${ev.userId}>.`);
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

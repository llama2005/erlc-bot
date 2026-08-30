import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { getGuildConfig } from "./guildConfig.js";

/**
 * Resolve a channel id to a sendable text channel the bot can post embeds in.
 * When `expectGuildId` is given, the channel MUST belong to that guild — this stops
 * one server's config (or a stale/hijacked id) from making the bot post into another.
 * @returns {Promise<{ channel: any|null, reason: string|null }>}
 */
export async function resolveSendable(client, id, expectGuildId = null) {
  if (!id) return { channel: null, reason: "not configured" };
  if (!client) return { channel: null, reason: "no client" };
  const ch = client.channels.cache.get(id) ?? (await client.channels.fetch(id).catch(() => null));
  if (!ch) return { channel: null, reason: `channel ${id} not found (deleted, or bot not in that server)` };
  if (expectGuildId && ch.guild?.id !== expectGuildId)
    return { channel: null, reason: "configured channel is in another server" };
  if (!ch.isTextBased?.() || ch.isDMBased?.()) return { channel: null, reason: "configured channel is not a text channel" };
  const me = ch.guild?.members?.me;
  if (me) {
    const perms = ch.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages))
      return { channel: null, reason: "missing View Channel / Send Messages permission there" };
    if (!perms.has(PermissionFlagsBits.EmbedLinks))
      return { channel: null, reason: "missing Embed Links permission there" };
  }
  return { channel: ch, reason: null };
}

/** Back-compat: just the channel or null. */
export const resolveChannel = async (client, id, expectGuildId = null) =>
  (await resolveSendable(client, id, expectGuildId)).channel;

/**
 * Post a pre-built embed to the guild's modlog channel.
 * @returns {Promise<{ ok: boolean, reason: string|null }>} ok=true if delivered;
 *          reason is null when simply not configured, else a human-readable problem.
 */
export async function postToModlog(guild, embed) {
  if (!guild) return { ok: false, reason: null };
  const cfg = getGuildConfig(guild.id);
  if (!cfg.modlogChannel) return { ok: false, reason: null };

  const { channel, reason } = await resolveSendable(guild.client, cfg.modlogChannel, guild.id);
  if (!channel) {
    console.warn(`modlog post failed for guild ${guild.id}: ${reason}`);
    return { ok: false, reason };
  }
  try {
    await channel.send({ embeds: [embed] });
    return { ok: true, reason: null };
  } catch (err) {
    console.warn(`modlog send threw for guild ${guild.id}: ${err.message}`);
    return { ok: false, reason: `send failed (${err.message})` };
  }
}

const ACTION_COLORS = {
  warn: 0xf1c40f, kick: 0xe67e22, ban: 0xe74c3c, unban: 0x2ecc71,
  jail: 0x9b59b6, unjail: 0x2ecc71, note: 0x95a5a6, timeout: 0xf1c40f, purge: 0x95a5a6,
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Legacy field-based modlog embed (used by ban requests). */
export async function sendModlog(guild, { action, target, moderator, reason, extra, thumbnail, url }) {
  const embed = new EmbedBuilder()
    .setColor(ACTION_COLORS[action] ?? 0x3498db)
    .setAuthor({ name: cap(action) })
    .setTimestamp();
  if (url) embed.setURL(url);
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (target)
    embed.addFields({ name: "Target", value: `${target.tag ?? target.user?.tag ?? target} (\`${target.id}\`)`, inline: true });
  if (moderator) embed.addFields({ name: "Moderator", value: `<@${moderator.id}>`, inline: true });
  if (reason) embed.addFields({ name: "Reason", value: String(reason).slice(0, 1024) });
  if (extra) embed.addFields({ name: "Details", value: String(extra).slice(0, 1024) });
  return postToModlog(guild, embed);
}

/** Compact record of a command invocation → the command-log channel. */
export async function logCommand(client, { guildId, user, commandName, argsText, channel }) {
  const cfg = getGuildConfig(guildId);
  if (!cfg.commandLogChannel) return;
  const { channel: dest, reason } = await resolveSendable(client, cfg.commandLogChannel, guildId);
  if (!dest) {
    console.warn(`command-log post failed for guild ${guildId}: ${reason}`);
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `${user.tag ?? user.username} (${user.id})`, iconURL: user.displayAvatarURL?.() })
    .setDescription(`\`${commandName}\`${argsText ? ` ${argsText}`.slice(0, 3800) : ""}`)
    .addFields({ name: "Where", value: channel ? `<#${channel.id}>` : "DM", inline: true })
    .setTimestamp();
  await dest.send({ embeds: [embed] }).catch((e) => console.warn(`command-log send threw: ${e.message}`));
}

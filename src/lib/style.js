import { EmbedBuilder, time } from "discord.js";

// Short confirmations = plain text with a leading tick/cross; richer output = a
// colour-coded embed.
export const EMOJI = {
  tick: "✅",
  cross: "❌",
  warn: "⚠️",
  online: "🟢",
  offline: "🔴",
  clock: "🕓",
  hammer: "🔨",
  shield: "🛡️",
};

export const ok = (msg) => `${EMOJI.tick} ${msg}`;
export const err = (msg) => `${EMOJI.cross} ${msg}`;

export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  neutral: 0x2b2d31,
  warn: 0xf1c40f,
  kick: 0xe67e22,
  ban: 0xe74c3c,
  unban: 0x2ecc71,
  jail: 0x9b59b6,
  unjail: 0x2ecc71,
  note: 0x95a5a6,
  bolo: 0x3498db,
  timeout: 0xf1c40f,
  unmute: 0x2ecc71,
  softban: 0xe74c3c,
  purge: 0x95a5a6,
};

const TYPE = {
  warn: { verb: "Warned", emoji: "⚠️" },
  kick: { verb: "Kicked", emoji: "👢" },
  ban: { verb: "Banned", emoji: "🔨" },
  unban: { verb: "Unbanned", emoji: "🕊️" },
  jail: { verb: "Jailed", emoji: "🔒" },
  unjail: { verb: "Released", emoji: "🔓" },
  note: { verb: "Note", emoji: "📝" },
  bolo: { verb: "BOLO", emoji: "🔍" },
  timeout: { verb: "Timed out", emoji: "🔇" },
  unmute: { verb: "Unmuted", emoji: "🔊" },
  softban: { verb: "Softbanned", emoji: "🧹" },
  purge: { verb: "Purge", emoji: "🧽" },
};

export const actionVerb = (type) => TYPE[type]?.verb ?? type;
export const actionEmoji = (type) => TYPE[type]?.emoji ?? "•";

/**
 * The canonical moderation-case embed — used by command replies AND the modlog so
 * they're identical.
 *
 * @param {object} o
 * @param {number|string} o.caseNumber
 * @param {string} o.type
 * @param {string} o.reason
 * @param {{ name: string, id: string|null, headshot?: string|null, url?: string|null }} o.target
 * @param {{ id: string, tag?: string, iconURL?: string }} o.moderator
 * @param {string} [o.footer]
 * @param {boolean} [o.voided]
 * @param {number} [o.createdAt] epoch ms (defaults to now)
 * @param {{name:string,value:string,inline?:boolean}[]} [o.extraFields]
 * @param {string} [o.durationText]
 */
export function caseEmbed(o) {
  const url =
    o.target.url !== undefined
      ? o.target.url
      : o.target.id
        ? `https://www.roblox.com/users/${o.target.id}/profile`
        : null;
  const at = Math.floor((o.createdAt ?? Date.now()) / 1000);

  const embed = new EmbedBuilder()
    .setColor(o.voided ? COLORS.neutral : COLORS[o.type] ?? COLORS.primary)
    .setAuthor({ name: `Case #${o.caseNumber} · ${actionEmoji(o.type)} ${actionVerb(o.type)}${o.voided ? "  (voided)" : ""}` })
    .setDescription(url ? `### [${o.target.name}](${url})\n\`${o.target.id ?? "?"}\`` : `### ${o.target.name}\n\`${o.target.id ?? "?"}\``)
    .addFields({ name: "Reason", value: (o.reason || "*No reason provided*").slice(0, 1024) })
    .setTimestamp(o.createdAt ?? Date.now());

  const meta = [{ name: "Moderator", value: `<@${o.moderator.id}>`, inline: true }, { name: "When", value: time(at, "R"), inline: true }];
  if (o.durationText) meta.push({ name: "Duration", value: o.durationText, inline: true });
  embed.addFields(...meta);

  if (url) embed.setURL(url);
  if (o.target.headshot) embed.setThumbnail(o.target.headshot);
  if (o.moderator.iconURL) embed.setAuthor({ name: embed.data.author.name, iconURL: o.moderator.iconURL });
  if (o.extraFields?.length) embed.addFields(...o.extraFields);
  embed.setFooter({ text: o.footer ? `⚠ ${o.footer}` : `${o.type} · logged permanently` });
  return embed;
}

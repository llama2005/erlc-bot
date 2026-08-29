import { EmbedBuilder, time } from "discord.js";

// Convention borrowed from Whispbot: short confirmations are plain text with a
// leading tick/cross; richer output uses a colour-coded embed.
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
  // per moderation action
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

const VERB = {
  warn: "Warned",
  kick: "Kicked",
  ban: "Banned",
  unban: "Unbanned",
  jail: "Jailed",
  unjail: "Released",
  note: "Note",
  bolo: "BOLO",
  timeout: "Timed out",
  unmute: "Unmuted",
  softban: "Softbanned",
};

export const actionVerb = (type) => VERB[type] ?? type;

/**
 * The canonical moderation-case embed, used by replies AND the modlog so they
 * look identical.
 *
 * @param {object} o
 * @param {number} o.caseNumber
 * @param {string} o.type
 * @param {string} o.reason
 * @param {{ name: string, id: string|null, headshot?: string|null, url?: string }} o.target
 * @param {{ id: string, tag?: string }} o.moderator
 * @param {string} [o.footer]
 * @param {boolean} [o.voided]
 * @param {number} [o.createdAt] epoch ms
 * @param {{name:string,value:string,inline?:boolean}[]} [o.extraFields]
 */
export function caseEmbed(o) {
  const url =
    o.target.url !== undefined
      ? o.target.url
      : o.target.id
        ? `https://www.roblox.com/users/${o.target.id}/profile`
        : null;
  const embed = new EmbedBuilder()
    .setColor(o.voided ? COLORS.neutral : COLORS[o.type] ?? COLORS.primary)
    .setAuthor({ name: `Case #${o.caseNumber} · ${actionVerb(o.type)}${o.voided ? " (voided)" : ""}` })
    .setDescription(url ? `**[${o.target.name}](${url})**  \`${o.target.id ?? "?"}\`` : `**${o.target.name}**  \`${o.target.id ?? "?"}\``)
    .addFields(
      { name: "Reason", value: (o.reason || "—").slice(0, 1024) },
      { name: "Moderator", value: `<@${o.moderator.id}>`, inline: true },
    );
  if (url) embed.setURL(url);
  if (o.target.headshot) embed.setThumbnail(o.target.headshot);
  if (o.createdAt) embed.addFields({ name: "When", value: time(Math.floor(o.createdAt / 1000), "R"), inline: true });
  if (o.extraFields?.length) embed.addFields(...o.extraFields);
  if (o.footer) embed.setFooter({ text: o.footer });
  return embed;
}

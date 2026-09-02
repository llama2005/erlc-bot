import { EmbedBuilder, time } from "discord.js";

// Short confirmations = plain text with a leading tick/cross; richer output = a
// colour-coded embed.
//
// Custom (application-owned) emojis live on the bot app itself, so they render in
// every guild with no emoji-slot cost. A wrong `name` in `<:name:id>` still renders
// — Discord resolves by id — but an animated emoji MUST use the `<a:` prefix.
// Anything without a custom id here falls back to the unicode glyph.
const CUSTOM = {
  online: "<:online:1544599519814221834>", // green dot / clocked in
  offline: "<:offline:1544600435371933756>", // red dot / clocked out
  clock: "<:clock:1544600626690785322>",
  idle: "<:idle:1544600718801903616>", // yellow dot
  tick: "<:tick:1544600513746702376>", // check mark
  loading: "<a:loading:1544602116964876288>", // animated spinner
};

export const EMOJI = {
  tick: "✅",
  cross: "❌",
  warn: "⚠️",
  online: "🟢",
  offline: "🔴",
  idle: "🟡",
  clock: "🕓",
  hammer: "🔨",
  shield: "🛡️",
  loading: "⌛",
  // Whisp-style field icons — single swap point if a custom emoji set is added later.
  user: "👤",
  id: "🆔",
  folder: "📁",
  reason: "📝",
  pending: "⌛",
  ...CUSTOM,
};

export const ok = (msg) => `${EMOJI.tick} ${msg}`;
export const err = (msg) => `${EMOJI.cross} ${msg}`;

/**
 * Coloured confirmation / info embeds for command replies. Keeps the look
 * consistent — reserve the bare `ok()` / `err()` strings for trivial acks and
 * validation errors.
 */
export const okEmbed = (description, title) => {
  const e = new EmbedBuilder().setColor(COLORS.success).setDescription(`${EMOJI.tick} ${description}`);
  return title ? e.setTitle(title) : e;
};
export const infoEmbed = (description, title) => {
  const e = new EmbedBuilder().setColor(COLORS.primary).setDescription(description);
  return title ? e.setTitle(title) : e;
};
export const failEmbed = (description, title) => {
  const e = new EmbedBuilder().setColor(COLORS.danger).setDescription(`${EMOJI.cross} ${description}`);
  return title ? e.setTitle(title) : e;
};

export const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  neutral: 0x2b2d31,
  // Whisp-style per-type hues: warn ≈ white, mute/timeout purple, kick orange, ban red,
  // un-actions green, note grey.
  warn: 0xe8e8e8,
  kick: 0xe67e22,
  ban: 0xe74c3c,
  unban: 0x2ecc71,
  jail: 0x9b59b6,
  unjail: 0x2ecc71,
  note: 0x95a5a6,
  bolo: 0x3498db,
  timeout: 0x9b59b6,
  unmute: 0x2ecc71,
  softban: 0xe74c3c,
  purge: 0x95a5a6,
  clockIn: 0x009600,
  clockOut: 0x95a5a6,
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
    .addFields({ name: "Reason", value: `${EMOJI.reason} ${(o.reason || "*No reason provided*").slice(0, 1000)}` })
    .setTimestamp(o.createdAt ?? Date.now());

  const meta = [{ name: "Moderator", value: `<@${o.moderator.id}>`, inline: true }, { name: "When", value: time(at, "R"), inline: true }];
  if (o.durationText) meta.push({ name: "Duration", value: o.durationText, inline: true });
  embed.addFields(...meta);

  if (url) embed.setURL(url);
  if (o.target.headshot) embed.setThumbnail(o.target.headshot);
  if (o.moderator.iconURL) embed.setAuthor({ name: embed.data.author.name, iconURL: o.moderator.iconURL });
  if (o.extraFields?.length) embed.addFields(...o.extraFields);
  if (o.evidence) embed.addFields({ name: "Evidence", value: String(o.evidence).slice(0, 1024) });
  embed.setFooter({ text: `Case: ${o.caseNumber}${o.footer ? ` · ⚠ ${o.footer}` : ""}` });
  return embed;
}

/** Discord account-creation epoch (ms) from a snowflake id. */
export const snowflakeCreated = (id) => Number((BigInt(id) >> 22n) + 1420070400000n);

/** Whisp-style "User" field for a Discord user. `user` = discord.js User or { id, tag }. */
export function discordUserField(user, name = "User") {
  const created = Math.floor(snowflakeCreated(user.id) / 1000);
  return {
    name,
    value: [
      `${EMOJI.user} <@${user.id}>`,
      `${EMOJI.id} \`${user.id}\``,
      `${EMOJI.clock} <t:${created}:d> (<t:${created}:R>)`,
    ].join("\n"),
  };
}

/** Whisp-style "User" field for a Roblox target. `t` = { name, id, displayName?, created? } (created = epoch ms). */
export function robloxUserField(t, name = "User") {
  const lines = [`${EMOJI.user} **${t.name}**${t.displayName && t.displayName !== t.name ? ` (${t.displayName})` : ""}`];
  if (t.id) lines.push(`${EMOJI.id} \`${t.id}\``);
  if (t.created) {
    const c = Math.floor(Number(t.created) / 1000);
    lines.push(`${EMOJI.clock} <t:${c}:d> (<t:${c}:R>)`);
  }
  return { name, value: lines.join("\n") };
}

/**
 * Whisp-style "Status" field for anything resolvable (ban request / appeal / LOA).
 * @param {"pending"|"approved"|"denied"|"ended"|"cancelled"} state
 * @param {{ byId?: string, at?: number }} [meta] at = epoch ms
 */
export function statusField(state, { byId, at } = {}) {
  const when = at ? ` · <t:${Math.floor(Number(at) / 1000)}:R>` : "";
  const by = byId ? ` by <@${byId}>` : "";
  const value =
    state === "approved" ? `${EMOJI.tick} Approved${by}${when}`
    : state === "denied" ? `${EMOJI.cross} Denied${by}${when}`
    : state === "ended" ? `🔚 Ended${by}${when}`
    : state === "cancelled" ? `🚫 Cancelled${by}${when}`
    : `${EMOJI.loading} Awaiting review`;
  return { name: "Status", value };
}

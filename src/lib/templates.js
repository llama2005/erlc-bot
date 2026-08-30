import { EmbedBuilder } from "discord.js";
import { one, many, query } from "./pg.js";

/**
 * Built-in message templates. Each has a set of {placeholders} that get filled at
 * send time. A guild can override any of these (or add its own custom keys).
 */
export const TEMPLATE_DEFS = {
  announcement: {
    name: "Announcement",
    vars: ["message", "server", "joinkey", "players", "staff", "staffname", "date"],
    default: {
      content: "",
      embed: {
        title: "📢 Announcement",
        description: "{message}",
        color: 0x5b6cff,
        timestamp: true,
        footer: "— {staffname}",
      },
    },
  },
  ssu: {
    name: "Session Start-Up (SSU)",
    vars: ["message", "server", "joinkey", "players", "staff", "staffname"],
    default: {
      content: "",
      embed: {
        title: "🟢 Session Start-Up",
        description: "A roleplay session is starting — **join now!**\n\n**Server:** {server}\n**Join key:** `{joinkey}`\n**Players:** {players}\n\n{message}",
        color: 0x3fb950,
        timestamp: true,
        footer: "Started by {staffname}",
      },
    },
  },
  ssd: {
    name: "Session Shutdown (SSD)",
    vars: ["message", "server", "staff", "staffname"],
    default: {
      content: "",
      embed: {
        title: "🔴 Session Shutdown",
        description: "The session has ended — thanks for playing!\n\n{message}",
        color: 0xf0554e,
        timestamp: true,
        footer: "Ended by {staffname}",
      },
    },
  },
  priority: {
    name: "Priority — active",
    vars: ["minutes", "reason", "staff", "staffname"],
    default: {
      content: "",
      embed: {
        title: "🚨 Priority active",
        description: "A priority is in effect for **{minutes} minute(s)**.\n**Reason:** {reason}\n\nRespect the scene — no interfering.",
        color: 0xd29922,
        timestamp: true,
        footer: "Called by {staffname}",
      },
    },
  },
  priority_end: {
    name: "Priority — ended",
    vars: [],
    default: { content: "", embed: { title: "✅ Priority ended", color: 0x3fb950, timestamp: true } },
  },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATE_DEFS);

// ---- storage ----

export async function getTemplateRow(guildId, key) {
  return one("SELECT * FROM message_templates WHERE guild_id=$1 AND key=$2", [guildId, key]);
}

/** Resolved template: the guild override if present & enabled, else the built-in default. */
export async function getTemplate(guildId, key) {
  const row = await getTemplateRow(guildId, key);
  const def = TEMPLATE_DEFS[key]?.default ?? { content: "", embed: {} };
  if (row && row.enabled) return { key, name: row.name, content: row.content ?? "", embed: row.embed ?? {}, custom: true };
  return { key, name: TEMPLATE_DEFS[key]?.name ?? key, content: def.content, embed: def.embed, custom: false };
}

export async function listTemplates(guildId) {
  const rows = await many("SELECT * FROM message_templates WHERE guild_id=$1", [guildId]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return TEMPLATE_KEYS.map((key) => {
    const row = byKey.get(key);
    const def = TEMPLATE_DEFS[key];
    return {
      key,
      name: row?.name ?? def.name,
      vars: def.vars,
      content: row?.content ?? def.default.content,
      embed: row?.embed ?? def.default.embed,
      enabled: row ? row.enabled : true,
      custom: !!row,
    };
  });
}

export async function saveTemplate(guildId, key, { name, content, embed, enabled = true }) {
  await query(
    `INSERT INTO message_templates (guild_id, key, name, content, embed, enabled, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (guild_id, key) DO UPDATE SET name=EXCLUDED.name, content=EXCLUDED.content, embed=EXCLUDED.embed, enabled=EXCLUDED.enabled, updated_at=EXCLUDED.updated_at`,
    [guildId, key, name || TEMPLATE_DEFS[key]?.name || key, content || null, JSON.stringify(embed || {}), !!enabled, Date.now()],
  );
}

export const resetTemplate = (guildId, key) =>
  query("DELETE FROM message_templates WHERE guild_id=$1 AND key=$2", [guildId, key]);

// ---- rendering ----

const sub = (s, vars) =>
  typeof s === "string" ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== "" ? String(vars[k]) : "")).replace(/\n{3,}/g, "\n\n").trim() : s;

/** Turn a template + variables into a discord.js message payload. */
export function renderPayload(tpl, vars = {}) {
  const e = tpl.embed || {};
  const eb = new EmbedBuilder();
  const title = sub(e.title, vars);
  const desc = sub(e.description, vars);
  if (title) eb.setTitle(title.slice(0, 256));
  if (desc) eb.setDescription(desc.slice(0, 4000));
  if (typeof e.color === "number") eb.setColor(e.color);
  if (e.url) eb.setURL(e.url);
  if (e.image) eb.setImage(e.image);
  if (e.thumbnail) eb.setThumbnail(e.thumbnail);
  if (e.author?.name) eb.setAuthor({ name: sub(e.author.name, vars).slice(0, 256), iconURL: e.author.icon || undefined });
  const footer = sub(e.footer, vars);
  if (footer) eb.setFooter({ text: footer.slice(0, 2048) });
  if (e.timestamp) eb.setTimestamp();
  for (const f of e.fields ?? []) {
    const n = sub(f.name, vars);
    const v = sub(f.value, vars);
    if (n && v) eb.addFields({ name: n.slice(0, 256), value: v.slice(0, 1024), inline: !!f.inline });
  }

  const hasEmbed = title || desc || (e.fields?.length && eb.data.fields?.length) || e.image;
  const content = sub(tpl.content, vars);
  return { content: content || undefined, embeds: hasEmbed ? [eb.toJSON()] : [] };
}

/** Sanitise a raw embed object coming from the dashboard form. */
export function cleanEmbed(raw) {
  const out = {};
  const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  out.title = str(raw.title, 256);
  out.description = str(raw.description, 4000);
  out.url = str(raw.url, 500);
  out.image = str(raw.image, 500);
  out.thumbnail = str(raw.thumbnail, 500);
  out.footer = str(raw.footer, 2048);
  if (raw.authorName || raw.authorIcon) out.author = { name: str(raw.authorName, 256), icon: str(raw.authorIcon, 500) };
  const c = String(raw.color || "").replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(c)) out.color = parseInt(c, 16);
  out.timestamp = raw.timestamp === "on" || raw.timestamp === true;
  const fields = [];
  for (let i = 0; i < 8; i++) {
    const n = str(raw[`f${i}name`], 256);
    const v = str(raw[`f${i}value`], 1024);
    if (n && v) fields.push({ name: n, value: v, inline: raw[`f${i}inline`] === "on" || raw[`f${i}inline`] === true });
  }
  if (fields.length) out.fields = fields;
  return out;
}

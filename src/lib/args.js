import { ApplicationCommandOptionType } from "discord.js";
import { parseDuration } from "./util.js";

const ID_RE = /^(?:<@!?|<@&|<#)?(\d{15,25})>?$/;

const SLASH_TYPE = {
  string: ApplicationCommandOptionType.String,
  text: ApplicationCommandOptionType.String,
  int: ApplicationCommandOptionType.Integer,
  number: ApplicationCommandOptionType.Number,
  bool: ApplicationCommandOptionType.Boolean,
  user: ApplicationCommandOptionType.User,
  member: ApplicationCommandOptionType.User,
  role: ApplicationCommandOptionType.Role,
  channel: ApplicationCommandOptionType.Channel,
  duration: ApplicationCommandOptionType.String,
};

/** Build Discord slash-command option objects from a command's arg schema. */
export function buildSlashOptions(args = []) {
  // Required options must come before optional ones.
  const sorted = [...args].sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
  return sorted.map((a) => {
    const opt = {
      type: SLASH_TYPE[a.type] ?? ApplicationCommandOptionType.String,
      name: a.name,
      description: (a.description || a.name).slice(0, 100),
      required: !!a.required,
    };
    if (a.autocomplete) opt.autocomplete = true;
    else if (a.choices) opt.choices = a.choices.map((c) => (typeof c === "string" ? { name: c, value: c } : c));
    return opt;
  });
}

function extractId(token) {
  const m = String(token).match(ID_RE);
  return m ? m[1] : null;
}

async function resolve(type, raw, { guild, client }) {
  const id = extractId(raw);
  switch (type) {
    case "user": {
      if (!id) return { error: "expected a user mention or ID" };
      const user = await client.users.fetch(id).catch(() => null);
      return user ? { value: user } : { error: "user not found" };
    }
    case "member": {
      if (!guild) return { error: "this argument only works in a server" };
      if (!id) return { error: "expected a member mention or ID" };
      const member = await guild.members.fetch(id).catch(() => null);
      return member ? { value: member } : { error: "member not found in this server" };
    }
    case "role": {
      if (!guild) return { error: "this argument only works in a server" };
      const role =
        (id && guild.roles.cache.get(id)) ||
        guild.roles.cache.find((r) => r.name.toLowerCase() === String(raw).toLowerCase());
      return role ? { value: role } : { error: "role not found" };
    }
    case "channel": {
      if (!guild) return { error: "this argument only works in a server" };
      const ch = id && guild.channels.cache.get(id);
      return ch ? { value: ch } : { error: "channel not found" };
    }
    case "int": {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? { value: n } : { error: "expected a whole number" };
    }
    case "number": {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? { value: n } : { error: "expected a number" };
    }
    case "bool": {
      const t = String(raw).toLowerCase();
      if (["true", "yes", "y", "1", "on"].includes(t)) return { value: true };
      if (["false", "no", "n", "0", "off"].includes(t)) return { value: false };
      return { error: "expected true or false" };
    }
    case "duration": {
      const ms = parseDuration(raw);
      return ms != null ? { value: ms } : { error: "expected a duration like 10m or 2h30m" };
    }
    default:
      return { value: String(raw) };
  }
}

/**
 * Parse positional tokens (prefix commands) against a schema.
 * @returns {Promise<{ok: true, args: object} | {ok: false, error: string}>}
 */
export async function parsePrefixArgs(schema = [], tokens = [], resolveCtx) {
  const args = {};
  let i = 0;
  for (const spec of schema) {
    if (spec.type === "text") {
      const rest = tokens.slice(i).join(" ").trim();
      if (!rest) {
        if (spec.required) return { ok: false, error: `missing required argument \`${spec.name}\`` };
        args[spec.name] = spec.default ?? null;
      } else {
        args[spec.name] = rest;
      }
      i = tokens.length;
      continue;
    }

    const raw = tokens[i++];
    if (raw === undefined) {
      if (spec.required) return { ok: false, error: `missing required argument \`${spec.name}\`` };
      args[spec.name] = spec.default ?? null;
      continue;
    }

    const res = await resolve(spec.type, raw, resolveCtx);
    if (res.error) return { ok: false, error: `\`${spec.name}\`: ${res.error}` };
    args[spec.name] = res.value;
  }
  return { ok: true, args };
}

/** Extract args from a slash interaction against a schema. */
export async function parseSlashArgs(schema = [], interaction) {
  const args = {};
  for (const spec of schema) {
    const o = interaction.options;
    switch (spec.type) {
      case "user":
        args[spec.name] = o.getUser(spec.name) ?? spec.default ?? null;
        break;
      case "member":
        args[spec.name] = o.getMember(spec.name) ?? spec.default ?? null;
        break;
      case "role":
        args[spec.name] = o.getRole(spec.name) ?? spec.default ?? null;
        break;
      case "channel":
        args[spec.name] = o.getChannel(spec.name) ?? spec.default ?? null;
        break;
      case "int":
        args[spec.name] = o.getInteger(spec.name) ?? spec.default ?? null;
        break;
      case "number":
        args[spec.name] = o.getNumber(spec.name) ?? spec.default ?? null;
        break;
      case "bool":
        args[spec.name] = o.getBoolean(spec.name) ?? spec.default ?? null;
        break;
      case "duration": {
        const raw = o.getString(spec.name);
        if (raw == null) {
          args[spec.name] = spec.default ?? null;
        } else {
          const ms = parseDuration(raw);
          if (ms == null) return { ok: false, error: `\`${spec.name}\`: expected a duration like 10m or 2h30m` };
          args[spec.name] = ms;
        }
        break;
      }
      default:
        args[spec.name] = o.getString(spec.name) ?? spec.default ?? null;
    }
    if (spec.required && (args[spec.name] === null || args[spec.name] === undefined)) {
      return { ok: false, error: `missing required argument \`${spec.name}\`` };
    }
  }
  return { ok: true, args };
}

/** One-line usage string from a schema, e.g. "<member> [reason]". */
export function usageString(schema = []) {
  return schema
    .map((s) => (s.required ? `<${s.name}>` : `[${s.name}]`))
    .join(" ");
}

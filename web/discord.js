import { config } from "../src/config.js";

const API = "https://discord.com/api/v10";

async function bearer(path, token) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const e = new Error("unauthorized");
    e.code = 401;
    throw e;
  }
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function bot(path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bot ${config.discordToken}` } });
  if (!res.ok) throw new Error(`bot ${path} → ${res.status}`);
  return res.json();
}

export async function exchangeCode(code, redirectUri) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.discord.clientId,
      client_secret: config.discord.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`token exchange → ${res.status}`);
  return res.json();
}

export const getUser = (token) => bearer("/users/@me", token);
export const getUserGuilds = (token) => bearer("/users/@me/guilds", token);
export const getGuildChannels = (guildId) => bot(`/guilds/${guildId}/channels`);
export const getGuildRoles = (guildId) => bot(`/guilds/${guildId}/roles`);
export const getGuildMember = (guildId, userId) => bot(`/guilds/${guildId}/members/${userId}`).catch(() => null);

// --- cross-tenant guards: a dashboard admin may only target channels/roles in THEIR guild ---
const guildIdCache = new Map(); // `${kind}:${guildId}` -> { ids: Set<string>, at: number }
const GUILD_IDS_TTL = 60 * 1000;

async function idsFor(kind, guildId, fetcher) {
  const cacheKey = `${kind}:${guildId}`;
  const hit = guildIdCache.get(cacheKey);
  if (hit && Date.now() - hit.at < GUILD_IDS_TTL) return hit.ids;
  const list = await fetcher(guildId).catch(() => null);
  if (!list) return hit?.ids ?? null; // fall back to a stale set rather than failing open
  const ids = new Set(list.map((x) => String(x.id)));
  guildIdCache.set(cacheKey, { ids, at: Date.now() });
  return ids;
}

/** True only if `channelId` is a real channel in `guildId`. */
export async function channelInGuild(guildId, channelId) {
  if (!channelId) return false;
  const ids = await idsFor("chan", guildId, getGuildChannels);
  return ids ? ids.has(String(channelId)) : false;
}

/** True only if `roleId` is a real role in `guildId`. */
export async function roleInGuild(guildId, roleId) {
  if (!roleId) return false;
  const ids = await idsFor("role", guildId, getGuildRoles);
  return ids ? ids.has(String(roleId)) : false;
}

const nameCache = new Map(); // `${guild}:${user}` -> { name, at }
const NAME_TTL = 10 * 60 * 1000;

/** Resolve a batch of user IDs to display names for a guild (cached). Returns a Map. */
export async function memberNames(guildId, ids) {
  const out = new Map();
  const need = [];
  for (const id of new Set(ids.filter(Boolean).map(String))) {
    const c = nameCache.get(`${guildId}:${id}`);
    if (c && Date.now() - c.at < NAME_TTL) out.set(id, c.name);
    else need.push(id);
  }
  await Promise.all(
    need.map(async (id) => {
      const m = await getGuildMember(guildId, id);
      const name = m ? (m.nick || m.user?.global_name || m.user?.username || `user ${id}`) : `user ${id}`;
      nameCache.set(`${guildId}:${id}`, { name, at: Date.now() });
      out.set(id, name);
    }),
  );
  return out;
}
export const postChannelMessage = (channelId, body) =>
  fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${config.discordToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

let _botUser = null;
export async function botIdentity() {
  if (_botUser) return _botUser;
  try {
    _botUser = await bot("/users/@me");
  } catch {
    _botUser = { id: config.discord.clientId, username: "ER:LC Bot", avatar: null };
  }
  return _botUser;
}
export const botAvatarUrl = (u) =>
  u?.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null;

const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

export function canManage(permissionsStr) {
  try {
    const p = BigInt(permissionsStr ?? "0");
    return (p & MANAGE_GUILD) === MANAGE_GUILD || (p & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

export function avatarUrl(user) {
  return user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${(Number(BigInt(user.id) >> 22n) % 6)}.png`;
}

export function guildIconUrl(guild) {
  return guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64` : null;
}

export function oauthUrl(redirectUri, state) {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", config.discord.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "identify guilds");
  if (state) u.searchParams.set("state", state);
  return u.toString();
}

export function inviteUrl() {
  const u = new URL("https://discord.com/oauth2/authorize");
  u.searchParams.set("client_id", config.discord.clientId);
  u.searchParams.set("scope", "bot applications.commands");
  u.searchParams.set("permissions", "1101927862374"); // kick/ban/timeout/manageRoles/manageMessages/embed/etc
  return u.toString();
}

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

// Authoritative "can this user manage this guild?" — checked live against Discord (cached 5min)
// so a demoted/removed admin loses dashboard access without needing their session to expire.
const MANAGE_GUILD_BIT = 1n << 5n;
const ADMINISTRATOR_BIT = 1n << 3n;
const manageCache = new Map(); // `${guildId}:${userId}` -> { ok: boolean, at: number }
const MANAGE_TTL = 5 * 60 * 1000;

export async function userManagesGuild(guildId, userId) {
  const cacheKey = `${guildId}:${userId}`;
  const hit = manageCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MANAGE_TTL) return hit.ok;

  let ok = false;
  try {
    const [member, roles] = await Promise.all([getGuildMember(guildId, userId), getGuildRoles(guildId)]);
    if (member && Array.isArray(roles)) {
      const held = new Set([...(member.roles || []), guildId]); // include @everyone (id === guildId)
      let perms = 0n;
      for (const r of roles) if (held.has(String(r.id))) perms |= BigInt(r.permissions || "0");
      ok = (perms & ADMINISTRATOR_BIT) === ADMINISTRATOR_BIT || (perms & MANAGE_GUILD_BIT) === MANAGE_GUILD_BIT;
    }
  } catch {
    ok = hit?.ok ?? false; // transient API failure — keep the last known answer
  }
  manageCache.set(cacheKey, { ok, at: Date.now() });
  return ok;
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
/** Resolve a set of Discord user ids to global names (bot token, cached). */
export async function userNames(ids) {
  const infos = await userInfos(ids);
  const out = new Map();
  for (const [id, u] of infos) out.set(id, u.globalName || u.username || `user …${id.slice(-4)}`);
  return out;
}

const infoCache = new Map(); // id -> { info, at }

/**
 * Resolve Discord user ids to { id, username, globalName, avatar } (bot token,
 * cached). `username` is the account's real handle (e.g. "voidnyx1"); `globalName`
 * is the chosen display name, which may be null. `avatar` is a ready-made CDN URL.
 */
export async function userInfos(ids) {
  const out = new Map();
  await Promise.all(
    [...new Set(ids.filter(Boolean).map(String))].map(async (id) => {
      const c = infoCache.get(id);
      if (c && Date.now() - c.at < NAME_TTL) return out.set(id, c.info);
      const u = await bot(`/users/${id}`).catch(() => null);
      const info = {
        id,
        username: u?.username || null,
        globalName: u?.global_name || null,
        avatar: u?.avatar ? `https://cdn.discordapp.com/avatars/${id}/${u.avatar}.png?size=32` : null,
        createdAt: Number((BigInt(id) >> 22n) + 1420070400000n),
      };
      infoCache.set(id, { info, at: Date.now() });
      out.set(id, info);
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

export const deleteChannelMessage = (channelId, messageId) =>
  fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${config.discordToken}` },
  });

export const editChannelMessage = (channelId, messageId, body) =>
  fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${config.discordToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** Best-effort DM to a user (opens the DM channel first). Never throws. */
export async function dmUser(userId, content) {
  try {
    const res = await fetch(`${API}/users/@me/channels`, {
      method: "POST",
      headers: { Authorization: `Bot ${config.discordToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!res.ok) return false;
    const { id } = await res.json();
    const sent = await postChannelMessage(id, { content });
    return sent.ok;
  } catch {
    return false;
  }
}

let _botUser = null;
export async function botIdentity() {
  if (_botUser) return _botUser;
  try {
    _botUser = await bot("/users/@me");
  } catch {
    _botUser = { id: config.discord.clientId, username: config.botName, avatar: null };
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
  u.searchParams.set("permissions", "1101927862502"); // kick/ban/timeout/manageRoles/manageMessages/embed/viewAuditLog/etc
  return u.toString();
}

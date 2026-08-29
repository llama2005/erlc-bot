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

import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";

import { config, requireConfig } from "../src/config.js";
import { initSchema } from "../src/lib/pg.js";
import { refreshGuildConfig, setGuildConfig, startConfigSync } from "../src/lib/guildConfig.js";
import { getBotGuild, listBotGuilds } from "../src/lib/botGuilds.js";
import {
  getRecentCases,
  getCase,
  editReason,
  editType,
  voidCase,
  createCase,
  ROBLOX_TYPES,
  DISCORD_TYPES,
} from "../src/lib/cases.js";
import { leaderboard, userShiftStats, adjustShiftTime, listActiveShifts } from "../src/lib/shifts.js";
import { listPendingBanRequests, getBanRequest, resolveBanRequest } from "../src/lib/banRequests.js";
import { NODES, getPermGroups, upsertPermGroup, deletePermGroup } from "../src/lib/permissions.js";
import { erlc, ErlcError } from "../src/lib/erlc.js";
import { formatDuration } from "../src/lib/util.js";
import * as d from "./discord.js";
import { setSession, clearSession, readSession, requireAuth } from "./auth.js";

requireConfig("DATABASE_URL", "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET");
await initSchema();
await startConfigSync().catch((e) => console.error("config sync setup failed:", e.message));

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(here, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/static", express.static(path.join(here, "public")));

const BASE = (config.links.dashboard || `http://localhost:${config.web.port}`).replace(/\/$/, "");
const REDIRECT = `${BASE}/auth/callback`;
console.log(`OAuth redirect URI: ${REDIRECT}  ← this must be in the Discord app's OAuth2 → Redirects`);

app.locals.avatarUrl = d.avatarUrl;
app.locals.guildIconUrl = d.guildIconUrl;
app.locals.formatDuration = formatDuration;
app.locals.fmtDate = (ms) => new Date(Number(ms)).toISOString().replace("T", " ").slice(0, 16);

// ---- auth ----
const states = new Map();
app.get("/auth/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  states.set(state, Date.now());
  res.redirect(d.oauthUrl(REDIRECT, state));
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || !states.has(state)) return res.status(400).render("error", { user: null, message: "Bad OAuth state — try again." });
  states.delete(state);
  try {
    const tok = await d.exchangeCode(code, REDIRECT);
    const [me, guilds] = await Promise.all([d.getUser(tok.access_token), d.getUserGuilds(tok.access_token)]);
    setSession(res, {
      id: me.id,
      username: me.global_name || me.username,
      avatar: me.avatar,
      guilds: guilds.map((g) => ({ id: g.id, name: g.name, icon: g.icon, permissions: g.permissions })),
    });
    res.redirect("/dashboard");
  } catch (err) {
    console.error("oauth callback:", err.message);
    res.status(500).render("error", { user: null, message: "Login failed — try again." });
  }
});

app.get("/auth/logout", (req, res) => {
  clearSession(res);
  res.redirect("/");
});

// ---- landing ----
app.get("/", (req, res) => {
  res.render("index", { user: readSession(req), inviteUrl: d.inviteUrl() });
});

// ---- dashboard ----
app.get("/dashboard", requireAuth, async (req, res) => {
  const botGuilds = new Set((await listBotGuilds()).map((g) => g.guild_id));
  const manageable = (req.user.guilds || [])
    .filter((g) => d.canManage(g.permissions))
    .map((g) => ({ ...g, botIn: botGuilds.has(g.id) }))
    .sort((a, b) => Number(b.botIn) - Number(a.botIn) || a.name.localeCompare(b.name));
  res.render("dashboard", { user: req.user, guilds: manageable, inviteUrl: d.inviteUrl() });
});

async function requireGuildAdmin(req, res, next) {
  const guildId = req.params.guildId;
  const g = (req.user.guilds || []).find((x) => x.id === guildId);
  if (!g || !d.canManage(g.permissions))
    return res.status(403).render("error", { user: req.user, message: "You don't have Manage Server in that guild." });
  const bg = await getBotGuild(guildId);
  if (!bg) return res.status(404).render("error", { user: req.user, message: "The bot isn't in that server yet." });
  req.cfg = await refreshGuildConfig(guildId); // always fresh from the DB for the dashboard
  req.guild = { id: guildId, name: bg.name, icon: bg.icon };
  next();
}

const MODULES = ["general", "moderation", "discord", "erlc", "roblox", "connections", "shifts", "staff", "utility"];

app.get("/dashboard/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  const [channels, roles] = await Promise.all([
    d.getGuildChannels(req.guild.id).catch(() => []),
    d.getGuildRoles(req.guild.id).catch(() => []),
  ]);
  res.render("guild", {
    user: req.user,
    guild: req.guild,
    cfg: req.cfg,
    channels: channels.filter((c) => [0, 5, 4].includes(c.type)).sort((a, b) => a.position - b.position),
    roles: roles.filter((r) => r.name !== "@everyone").sort((a, b) => b.position - a.position),
    modules: MODULES,
    tab: "settings",
    saved: req.query.saved === "1",
  });
});

app.post("/dashboard/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  const b = req.body;
  const orNull = (v) => (v && v !== "" ? v : null);
  const patch = {
    prefix: (b.prefix || "!").slice(0, 5),
    aiEnabled: b.aiEnabled === "on",
    reasonRequired: b.reasonRequired === "on",
    modlogChannel: orNull(b.modlogChannel),
    commandLogChannel: orNull(b.commandLogChannel),
    banreqChannel: orNull(b.banreqChannel),
    joinLogChannel: orNull(b.joinLogChannel),
    killLogChannel: orNull(b.killLogChannel),
    ingameLogChannel: orNull(b.ingameLogChannel),
    modcallLogChannel: orNull(b.modcallLogChannel),
    sessionChannel: orNull(b.sessionChannel),
    staffAlertChannel: orNull(b.staffAlertChannel),
    loaChannel: orNull(b.loaChannel),
    appealChannel: orNull(b.appealChannel),
    statusChannel: orNull(b.statusChannel),
    announceChannel: orNull(b.announceChannel),
    quotaChannel: orNull(b.quotaChannel),
    ticketCategory: orNull(b.ticketCategory),
    erlcStaffRole: orNull(b.erlcStaffRole),
    erlcAdminRole: orNull(b.erlcAdminRole),
    shiftRole: orNull(b.shiftRole),
    sessionPingRole: orNull(b.sessionPingRole),
    ticketStaffRole: orNull(b.ticketStaffRole),
    ingameAutolog: b.ingameAutolog === "on",
    ingameWarnTrigger: (b.ingameWarnTrigger || "warn").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "warn",
    weeklyCaseQuota: Math.max(0, parseInt(b.weeklyCaseQuota, 10) || 0),
    weeklyShiftQuota: Math.max(0, parseInt(b.weeklyShiftQuotaMin, 10) || 0) * 60000,
    disabledModules: [].concat(b.disabledModules || []).filter(Boolean),
  };
  // only overwrite the ER:LC key when a new one is actually submitted
  if (b.erlcKey && b.erlcKey.trim() && b.erlcKey !== "********") patch.erlcKey = b.erlcKey.trim();
  if (b.clearErlcKey === "on") patch.erlcKey = null;

  await setGuildConfig(req.guild.id, patch);
  res.redirect(`/dashboard/${req.guild.id}?saved=1`);
});

// ---- cases ----
app.get("/dashboard/:guildId/cases", requireAuth, requireGuildAdmin, async (req, res) => {
  let cases;
  const q = (req.query.q || "").trim();
  if (/^\d+$/.test(q)) {
    const c = await getCase(req.guild.id, Number(q));
    cases = c ? [c] : [];
  } else {
    cases = await getRecentCases(req.guild.id, 50);
  }
  res.render("cases", { user: req.user, guild: req.guild, cases, q, tab: "cases", ROBLOX_TYPES, DISCORD_TYPES });
});

app.post("/dashboard/:guildId/cases/:n/:op", requireAuth, requireGuildAdmin, async (req, res) => {
  const n = Number(req.params.n);
  const c = await getCase(req.guild.id, n);
  if (c) {
    if (req.params.op === "void") await voidCase(req.guild.id, n, req.user.id, req.body.reason || "via dashboard");
    else if (req.params.op === "reason" && req.body.reason) await editReason(req.guild.id, n, req.body.reason);
    else if (req.params.op === "type" && req.body.type) await editType(req.guild.id, n, req.body.type);
  }
  res.redirect(`/dashboard/${req.guild.id}/cases`);
});

// ---- shifts ----
app.get("/dashboard/:guildId/shifts", requireAuth, requireGuildAdmin, async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const since = Date.now() - days * 864e5;
  const [board, active] = await Promise.all([leaderboard(req.guild.id, since), listActiveShifts(req.guild.id)]);
  res.render("shifts", { user: req.user, guild: req.guild, board, active, days, tab: "shifts" });
});

app.post("/dashboard/:guildId/shifts/adjust", requireAuth, requireGuildAdmin, async (req, res) => {
  const { userId, minutes, direction } = req.body;
  const ms = Math.abs(Number(minutes) || 0) * 60000;
  if (userId && ms) await adjustShiftTime(req.guild.id, userId.trim(), direction === "remove" ? -ms : ms);
  res.redirect(`/dashboard/${req.guild.id}/shifts`);
});

// ---- permissions ----
app.get("/dashboard/:guildId/permissions", requireAuth, requireGuildAdmin, async (req, res) => {
  const [groups, roles] = await Promise.all([
    getPermGroups(req.guild.id),
    d.getGuildRoles(req.guild.id).catch(() => []),
  ]);
  res.render("permissions", {
    user: req.user,
    guild: req.guild,
    cfg: req.cfg,
    groups,
    roles: roles.filter((r) => r.name !== "@everyone" && !r.managed).sort((a, b) => b.position - a.position),
    nodes: NODES,
    tab: "permissions",
  });
});

app.post("/dashboard/:guildId/permissions", requireAuth, requireGuildAdmin, async (req, res) => {
  const { roleId, name } = req.body;
  const nodes = [].concat(req.body.nodes || []).filter((n) => n === "*" || n in NODES);
  if (roleId && name) await upsertPermGroup(req.guild.id, roleId, name.slice(0, 40), nodes);
  res.redirect(`/dashboard/${req.guild.id}/permissions`);
});

app.post("/dashboard/:guildId/permissions/:roleId/delete", requireAuth, requireGuildAdmin, async (req, res) => {
  await deletePermGroup(req.guild.id, req.params.roleId);
  res.redirect(`/dashboard/${req.guild.id}/permissions`);
});

// ---- ban requests ----
app.get("/dashboard/:guildId/banreqs", requireAuth, requireGuildAdmin, async (req, res) => {
  const requests = await listPendingBanRequests(req.guild.id);
  res.render("banreqs", { user: req.user, guild: req.guild, requests, tab: "banreqs" });
});

app.post("/dashboard/:guildId/banreqs/:id/:decision", requireAuth, requireGuildAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const request = await getBanRequest(id);
  if (request && request.status === "pending") {
    if (req.params.decision === "approve") {
      await resolveBanRequest(id, "approved", req.user.id);
      const cfg = req.cfg;
      const key = cfg.erlcKey || config.erlc.devKey;
      let executed = true;
      try {
        if (!key) throw new ErlcError("no key");
        await erlc.command(key, `:ban ${request.roblox_name}`);
      } catch (e) {
        if (e instanceof ErlcError) executed = false;
        else throw e;
      }
      await createCase({
        guildId: req.guild.id,
        platform: "roblox",
        subjectId: request.roblox_id,
        subjectName: request.roblox_name,
        type: "ban",
        reason: request.reason,
        moderatorId: request.requested_by,
        moderatorTag: "ban request (web)",
        executed,
      });
    } else {
      await resolveBanRequest(id, "denied", req.user.id);
    }
  }
  res.redirect(`/dashboard/${req.guild.id}/banreqs`);
});

app.use((req, res) => res.status(404).render("error", { user: readSession(req), message: "Not found." }));

app.listen(config.web.port, () => console.log(`Dashboard on ${BASE} (port ${config.web.port})`));

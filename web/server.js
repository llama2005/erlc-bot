import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";

import { config, requireConfig } from "../src/config.js";
import { initSentry, captureError } from "../src/lib/sentry.js";
import { initSchema, pool } from "../src/lib/pg.js";
import { refreshGuildConfig, setGuildConfig, startConfigSync } from "../src/lib/guildConfig.js";
import {
  getServers,
  defaultServer,
  resolveServer,
  addServer,
  removeServer,
  renameServer,
  setDefaultServer,
  startErlcServerSync,
} from "../src/lib/erlcServers.js";
import { getBotGuild, listBotGuilds } from "../src/lib/botGuilds.js";
import { FLAGS, isEnabled, setFlag, clearFlag, listFlagRows, startFlagSync } from "../src/lib/flags.js";
import { createAction, acknowledgeAction } from "../src/lib/botActions.js";
import { isOperator, adminOverview, adminGuilds, activeLocks } from "./admin.js";
import {
  getRecentCases,
  getCase,
  editReason,
  editType,
  voidCase,
  deleteCase,
  createCase,
  ROBLOX_TYPES,
  DISCORD_TYPES,
} from "../src/lib/cases.js";
import { subjectStats } from "../src/lib/cases.js";
import { leaderboard, userShiftStats, adjustShiftTime, listActiveShifts, wipeShifts } from "../src/lib/shifts.js";
import { listPendingBanRequests, getBanRequest, resolveBanRequest, banRequestEmbed, banRequestButtons } from "../src/lib/banRequests.js";
import { listLoa, getLoa, setLoaStatus, loaEmbed, loaReviewButtons } from "../src/lib/loa.js";
import { listAppeals, getAppeal, resolveAppeal, appealEmbed, appealReviewButtons } from "../src/lib/appeals.js";
import { listAutohints, addAutohint, removeAutohint, toggleAutohint } from "../src/lib/autohint.js";
import { moderatorCaseStats } from "../src/lib/modstats.js";
import { listTemplates, getTemplate, saveTemplate, resetTemplate, renderPayload, cleanEmbed, TEMPLATE_DEFS } from "../src/lib/templates.js";
import { NODES, getPermGroups, upsertPermGroup, deletePermGroup } from "../src/lib/permissions.js";
import { getGuideData } from "./guide.js";
import { syncMessage, postCaseToModlog, refreshCaseModlog } from "./notify.js";
import { erlc, ErlcError } from "../src/lib/erlc.js";
import { formatDuration, parseDuration } from "../src/lib/util.js";
import * as d from "./discord.js";
import { setSession, clearSession, readSession, requireAuth } from "./auth.js";

initSentry("web");
requireConfig("DATABASE_URL", "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "SESSION_SECRET");
await initSchema();
await startConfigSync().catch((e) => console.error("config sync setup failed:", e.message));
await startErlcServerSync().catch((e) => console.error("erlc server sync setup failed:", e.message));
await startFlagSync().catch((e) => console.error("flag sync setup failed:", e.message));

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1); // Render/Cloudflare — needed for correct client IPs in rate limiting
app.set("view engine", "ejs");
app.set("views", path.join(here, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/static", express.static(path.join(here, "public")));

const limit = (max, windowMs = 60_000) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, skip: (req) => req.path === "/healthz" });
app.use("/auth", limit(20)); // OAuth start/callback/logout
app.use(["/dashboard"], (req, res, next) => (req.method === "POST" ? limit(40)(req, res, next) : next())); // config writes
app.use(limit(400)); // catch-all safety net

const BASE = (config.links.dashboard || `http://localhost:${config.web.port}`).replace(/\/$/, "");
const REDIRECT = `${BASE}/auth/callback`;
console.log(`OAuth redirect URI: ${REDIRECT}  ← this must be in the Discord app's OAuth2 → Redirects`);

app.locals.avatarUrl = d.avatarUrl;
app.locals.guildIconUrl = d.guildIconUrl;
app.locals.formatDuration = formatDuration;
app.locals.fmtDate = (ms) => (ms ? new Date(Number(ms)).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
app.locals.ago = (ms) => {
  const s = Math.round((Date.now() - Number(ms)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
app.locals.who = (names, id) => (id ? names.get(String(id)) || `user …${String(id).slice(-4)}` : "—");
app.locals.botName = config.botName;
app.locals.baseUrl = BASE;
app.locals.isOperator = (user) => isOperator(user?.id);
d.botIdentity().then((u) => {
  app.locals.botAvatar = d.botAvatarUrl(u) || "";
  if (u?.username) app.locals.botName = u.username;
});

// Per-guild budget for dashboard-initiated ER:LC API calls, so one server's dashboard
// activity can't burn the shared PRC key for everyone.
const erlcBudget = new Map(); // guildId -> { count, reset }
function erlcAllowed(guildId) {
  const now = Date.now();
  let b = erlcBudget.get(guildId);
  if (!b || now >= b.reset) {
    b = { count: 0, reset: now + 10_000 };
    erlcBudget.set(guildId, b);
  }
  if (b.count >= 6) return false;
  b.count += 1;
  return true;
}

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

// ---- health check (public, unlogged) ----
const VERSION = (process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || "dev";
app.get("/healthz", async (_req, res) => {
  let db = false;
  try {
    await Promise.race([pool.query("SELECT 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1000))]);
    db = true;
  } catch {
    /* db down */
  }
  res.status(db ? 200 : 503).json({ ok: db, uptime: Math.round(process.uptime()), version: VERSION, db });
});

// ---- landing ----
app.get("/", async (req, res) => {
  const guilds = await listBotGuilds().catch(() => []);
  const guide = await getGuideData().catch(() => null);
  res.render("index", {
    user: readSession(req),
    inviteUrl: d.inviteUrl(),
    stats: { guilds: guilds.length, commands: guide?.total ?? 49 },
  });
});

// ---- legal (public) ----
const LEGAL_UPDATED = "2026-08-30";
for (const page of ["privacy", "terms"]) {
  app.get(`/${page}`, (req, res) =>
    res.render(page, { user: readSession(req), updated: LEGAL_UPDATED, support: config.links.support || "" }),
  );
}

// ---- features (public) ----
app.get("/features", (req, res) => {
  res.render("features", {
    user: readSession(req),
    inviteUrl: d.inviteUrl(),
    support: config.links.support || "",
  });
});

// ---- guide (public) ----
app.get("/guide", async (req, res) => {
  const guide = await getGuideData().catch((e) => {
    console.error("guide data failed:", e.message);
    return null;
  });
  if (!guide) return res.status(500).render("error", { user: readSession(req), message: "The guide is unavailable right now." });
  res.render("guide", {
    user: readSession(req),
    guide,
    inviteUrl: d.inviteUrl(),
    support: config.links.support || "",
    dashboard: (config.links.dashboard || "").replace(/\/$/, ""),
  });
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

function requireOperator(req, res, next) {
  if (!isOperator(req.user?.id))
    return res.status(404).render("error", { user: req.user, message: "Not found." });
  next();
}

async function requireGuildAdmin(req, res, next) {
  const guildId = req.params.guildId;
  const op = isOperator(req.user?.id); // bot operators can open any guild's dashboard
  // Fast pre-filter from the (possibly stale) OAuth session…
  const g = (req.user.guilds || []).find((x) => x.id === guildId);
  if (!op && (!g || !d.canManage(g.permissions)))
    return res.status(403).render("error", { user: req.user, message: "You don't have Manage Server in that guild." });
  const bg = await getBotGuild(guildId);
  if (!bg) return res.status(404).render("error", { user: req.user, message: "The bot isn't in that server yet." });
  // …then the authoritative live check (5-min cache): current roles, or guild ownership.
  const live = op || String(bg.owner_id) === String(req.user.id) || (await d.userManagesGuild(guildId, req.user.id));
  if (!live)
    return res.status(403).render("error", { user: req.user, message: "You no longer have Manage Server in that guild." });
  req.cfg = await refreshGuildConfig(guildId); // always fresh from the DB for the dashboard
  req.guild = { id: guildId, name: bg.name, icon: bg.icon };
  const [loaP, appealsP, banreqsP] = await Promise.all([
    listLoa(guildId, "pending"),
    listAppeals(guildId, "pending"),
    listPendingBanRequests(guildId),
  ]);
  req.counts = { loa: loaP.length, appeals: appealsP.length, banreqs: banreqsP.length };
  next();
}

/** render helper — threads user/guild/counts through; `ids` are resolved to display names */
async function g(req, res, view, extra = {}, ids = []) {
  const names = ids.length ? await d.memberNames(req.guild.id, ids).catch(() => new Map()) : new Map();
  res.render(view, { user: req.user, guild: req.guild, counts: req.counts, cfg: req.cfg, names, ...extra });
}

const MODULES = ["general", "moderation", "discord", "erlc", "roblox", "connections", "shifts", "staff", "utility"];

// ---- overview (default landing for a guild) ----
app.get("/dashboard/:guildId/overview", requireAuth, requireGuildAdmin, async (req, res) => {
  const cfg = req.cfg;
  const since = Date.now() - 7 * 864e5;
  const [active, recent, board, srv] = await Promise.all([
    listActiveShifts(req.guild.id),
    getRecentCases(req.guild.id, 8),
    leaderboard(req.guild.id, since),
    (async () => {
      const key = defaultServer(req.guild.id)?.api_key || (await getServers(req.guild.id))[0]?.api_key;
      if (!key || !cfg.statusChannel) return null;
      if (!erlcAllowed(req.guild.id)) return null;
      return erlc.server(key).catch(() => "offline");
    })(),
  ]);
  const ids = [
    ...active.map((s) => s.user_id),
    ...recent.map((c) => c.moderator_id),
    ...board.map((r) => r.user_id),
  ];
  await g(
    req,
    res,
    "overview",
    {
      tab: "overview",
      active,
      recent,
      board: board.slice(0, 5),
      server: srv,
      weekCases: recent.filter((c) => c.created_at >= since).length,
      quota: { cases: cfg.weeklyCaseQuota, shift: cfg.weeklyShiftQuota },
    },
    ids,
  );
});

app.get("/dashboard/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  const [channels, roles] = await Promise.all([
    d.getGuildChannels(req.guild.id).catch(() => []),
    d.getGuildRoles(req.guild.id).catch(() => []),
  ]);
  await g(req, res, "guild", {
    channels: channels.filter((c) => [0, 5, 4].includes(c.type)).sort((a, b) => a.position - b.position),
    roles: roles.filter((r) => r.name !== "@everyone").sort((a, b) => b.position - a.position),
    modules: MODULES,
    tab: "settings",
    saved: req.query.saved === "1",
  });
});

const CHANNEL_FIELDS = [
  "modlogChannel", "commandLogChannel", "banreqChannel", "joinLogChannel", "killLogChannel",
  "ingameLogChannel", "modcallLogChannel", "sessionChannel", "staffAlertChannel", "loaChannel",
  "appealChannel", "shiftLogChannel", "statusChannel", "announceChannel", "quotaChannel", "ticketCategory",
];
const ROLE_FIELDS = ["erlcStaffRole", "erlcAdminRole", "shiftRole", "sessionPingRole", "ticketStaffRole"];

app.post("/dashboard/:guildId", requireAuth, requireGuildAdmin, async (req, res) => {
  const b = req.body;
  const orNull = (v) => (v && v !== "" ? v : null);

  // Reject any channel/role that isn't actually in this guild — a crafted POST must not
  // point one server's logs (or the bot's sends) at another server the bot happens to be in.
  const [chanList, roleList] = await Promise.all([
    d.getGuildChannels(req.guild.id).catch(() => null),
    d.getGuildRoles(req.guild.id).catch(() => null),
  ]);
  const chanIds = chanList && new Set(chanList.map((c) => String(c.id)));
  const roleIds = roleList && new Set(roleList.map((r) => String(r.id)));
  const bad = [];
  if (chanIds) for (const f of CHANNEL_FIELDS) if (orNull(b[f]) && !chanIds.has(String(b[f]).trim())) bad.push(f);
  if (roleIds) for (const f of ROLE_FIELDS) if (orNull(b[f]) && !roleIds.has(String(b[f]).trim())) bad.push(f);
  if (bad.length)
    return res.status(400).render("error", {
      user: req.user,
      message: `Those channels/roles aren't in this server: ${bad.join(", ")}.`,
    });

  const patch = {
    prefix: (b.prefix || "!").slice(0, 5),
    aiEnabled: b.aiEnabled === "on",
    reasonRequired: b.reasonRequired === "on",
    logExternalModeration: b.logExternalModeration === "on",
    hardVoid: b.hardVoid === "on",
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
    shiftLogChannel: orNull(b.shiftLogChannel),
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
    ingameShiftCommands: b.ingameShiftCommands === "on",
    ingameWarnTrigger: (b.ingameWarnTrigger || "warn").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "warn",
    weeklyCaseQuota: Math.max(0, parseInt(b.weeklyCaseQuota, 10) || 0),
    weeklyShiftQuota: Math.max(0, parseInt(b.weeklyShiftQuotaMin, 10) || 0) * 60000,
    disabledModules: [].concat(b.disabledModules || []).filter(Boolean),
  };

  await setGuildConfig(req.guild.id, patch);
  res.redirect(`/dashboard/${req.guild.id}?saved=1`);
});

// ---- cases ----
app.get("/dashboard/:guildId/cases", requireAuth, requireGuildAdmin, async (req, res) => {
  const q = (req.query.q || "").trim();
  const typeF = (req.query.type || "").trim();
  const platF = (req.query.platform || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const per = 30;

  let cases;
  if (/^#?\d+$/.test(q)) {
    const c = await getCase(req.guild.id, Number(q.replace("#", "")));
    cases = c ? [c] : [];
  } else {
    cases = await getRecentCases(req.guild.id, 500);
    if (q) {
      const ql = q.toLowerCase();
      cases = cases.filter(
        (c) => c.subject_name.toLowerCase().includes(ql) || String(c.subject_id) === q || (c.reason || "").toLowerCase().includes(ql),
      );
    }
    if (typeF) cases = cases.filter((c) => c.type === typeF);
    if (platF) cases = cases.filter((c) => c.platform === platF);
  }
  const total = cases.length;
  const paged = cases.slice((page - 1) * per, page * per);
  await g(
    req,
    res,
    "cases",
    { tab: "cases", cases: paged, q, typeF, platF, page, pages: Math.max(1, Math.ceil(total / per)), total, ROBLOX_TYPES, DISCORD_TYPES },
    paged.map((c) => c.moderator_id),
  );
});

app.post("/dashboard/:guildId/cases/new", requireAuth, requireGuildAdmin, async (req, res) => {
  const b = req.body;
  if (b.subjectId && b.subjectName && b.type) {
    await createCase({
      guildId: req.guild.id,
      platform: b.platform === "discord" ? "discord" : "roblox",
      subjectId: b.subjectId.trim(),
      subjectName: b.subjectName.trim(),
      type: b.type,
      reason: (b.reason || "").trim() || null,
      moderatorId: req.user.id,
      moderatorTag: `${req.user.username} (web)`,
      executed: false,
    });
  }
  res.redirect(`/dashboard/${req.guild.id}/cases`);
});

app.post("/dashboard/:guildId/cases/:n/:op", requireAuth, requireGuildAdmin, async (req, res) => {
  const n = Number(req.params.n);
  const c = await getCase(req.guild.id, n);
  if (c) {
    if (req.params.op === "void") {
      if (req.cfg.hardVoid) {
        const row = await deleteCase(req.guild.id, n);
        if (row?.log_channel_id) await d.deleteChannelMessage(row.log_channel_id, row.log_message_id).catch(() => {});
      } else {
        await voidCase(req.guild.id, n, req.user.id, req.body.reason || "via dashboard");
        await refreshCaseModlog(req.guild.id, req.cfg, n);
      }
    } else if (req.params.op === "reason" && req.body.reason) {
      await editReason(req.guild.id, n, req.body.reason);
      await refreshCaseModlog(req.guild.id, req.cfg, n);
    } else if (req.params.op === "type" && req.body.type) {
      await editType(req.guild.id, n, req.body.type);
      await refreshCaseModlog(req.guild.id, req.cfg, n);
    }
  }
  res.redirect(`/dashboard/${req.guild.id}/cases?${new URLSearchParams(req.query).toString()}`);
});

// ---- shifts ----
app.get("/dashboard/:guildId/shifts", requireAuth, requireGuildAdmin, async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const since = Date.now() - days * 864e5;
  const [board, active] = await Promise.all([leaderboard(req.guild.id, since), listActiveShifts(req.guild.id)]);
  await g(req, res, "shifts", { board, active, days, tab: "shifts", quota: req.cfg.weeklyShiftQuota }, [...board.map((r) => r.user_id), ...active.map((s) => s.user_id)]);
});

app.post("/dashboard/:guildId/shifts/adjust", requireAuth, requireGuildAdmin, async (req, res) => {
  const { userId, minutes, direction } = req.body;
  const uid = (userId || "").trim();
  if (uid && direction === "wipe") await wipeShifts(req.guild.id, uid);
  else {
    const ms = Math.abs(Number(minutes) || 0) * 60000;
    if (uid && ms) await adjustShiftTime(req.guild.id, uid, direction === "remove" ? -ms : ms);
  }
  res.redirect(`/dashboard/${req.guild.id}/shifts`);
});

// ---- leave of absence ----
app.get("/dashboard/:guildId/loa", requireAuth, requireGuildAdmin, async (req, res) => {
  const [pending, active] = await Promise.all([listLoa(req.guild.id, "pending"), listLoa(req.guild.id, "active")]);
  await g(req, res, "loa", { tab: "loa", pending, active }, [...pending, ...active].flatMap((r) => [r.user_id, r.reviewed_by]));
});
app.post("/dashboard/:guildId/loa/:id/:decision", requireAuth, requireGuildAdmin, async (req, res) => {
  const row = await getLoa(Number(req.params.id));
  const dec = req.params.decision;
  if (row && row.guild_id === req.guild.id && ["approve", "deny", "end"].includes(dec)) {
    const status = dec === "approve" ? (row.starts_at <= Date.now() ? "active" : "pending") : dec === "deny" ? "denied" : "ended";
    if (await setLoaStatus(row.id, status, req.user.id)) {
      const fresh = await getLoa(row.id);
      await syncMessage(fresh.channel_id, fresh.message_id, {
        embeds: [loaEmbed(fresh)],
        components: [loaReviewButtons(fresh.id, true)],
      });
      const verb = dec === "approve" ? "approved" : dec === "deny" ? "denied" : "ended";
      await d.dmUser(row.user_id, `Your LOA request (#${row.id}) in **${req.guild.name}** was **${verb}** by ${req.user.username}.`);
    }
  }
  res.redirect(`/dashboard/${req.guild.id}/loa`);
});

// ---- appeals ----
app.get("/dashboard/:guildId/appeals", requireAuth, requireGuildAdmin, async (req, res) => {
  {
    const appeals = await listAppeals(req.guild.id, "pending");
    await g(req, res, "appeals", { tab: "appeals", appeals }, appeals.map((a) => a.user_id));
  }
});
app.post("/dashboard/:guildId/appeals/:id/:decision", requireAuth, requireGuildAdmin, async (req, res) => {
  const a = await getAppeal(Number(req.params.id));
  if (a && a.guild_id === req.guild.id && a.status === "pending") {
    const approve = req.params.decision === "approve";
    await resolveAppeal(a.id, approve ? "approved" : "denied", req.user.id);
    let caseRow = null;
    if (approve) {
      const servers = await getServers(req.guild.id);
      const primary = defaultServer(req.guild.id) || servers[0];
      const targets = req.cfg.erlcBanAllServers ? servers : [primary].filter(Boolean);
      let executed = false;
      if (a.roblox_name && erlcAllowed(req.guild.id)) {
        for (const s of targets) {
          try {
            await erlc.command(s.api_key, `:unban ${a.roblox_name}`);
            executed = true;
          } catch {
            /* ignore */
          }
        }
      }
      if (a.roblox_id) {
        caseRow = await createCase({
          guildId: req.guild.id,
          platform: "roblox",
          subjectId: a.roblox_id,
          subjectName: a.roblox_name || a.roblox_id,
          type: "unban",
          reason: `Appeal #${a.id} approved`,
          erlcServerId: primary?.id ?? null,
          moderatorId: req.user.id,
          moderatorTag: `${req.user.username} (web)`,
          executed,
        });
        await postCaseToModlog(req.guild.id, req.cfg, caseRow);
      }
    }
    const fresh = await getAppeal(a.id);
    await syncMessage(fresh.channel_id, fresh.message_id, {
      embeds: [appealEmbed(fresh, { caseNumber: caseRow?.case_number })],
      components: [appealReviewButtons(a.id, true)],
    });
    await d.dmUser(a.user_id, `Your ban appeal (#${a.id}) in **${req.guild.name}** was **${approve ? "approved" : "denied"}** by ${req.user.username}.`);
  }
  res.redirect(`/dashboard/${req.guild.id}/appeals`);
});

// ---- auto-hints ----
app.get("/dashboard/:guildId/autohints", requireAuth, requireGuildAdmin, async (req, res) => {
  await g(req, res, "autohints", { tab: "autohints", hints: await listAutohints(req.guild.id) });
});
app.post("/dashboard/:guildId/autohints", requireAuth, requireGuildAdmin, async (req, res) => {
  const ms = parseDuration(req.body.interval || "");
  if (req.body.message && ms && ms >= 60000) await addAutohint(req.guild.id, req.body.message.slice(0, 200), ms);
  res.redirect(`/dashboard/${req.guild.id}/autohints`);
});
app.post("/dashboard/:guildId/autohints/:id/:op", requireAuth, requireGuildAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (req.params.op === "delete") await removeAutohint(req.guild.id, id);
  else if (req.params.op === "on") await toggleAutohint(req.guild.id, id, true);
  else if (req.params.op === "off") await toggleAutohint(req.guild.id, id, false);
  res.redirect(`/dashboard/${req.guild.id}/autohints`);
});

// ---- message templates + send ----
app.get("/dashboard/:guildId/templates", requireAuth, requireGuildAdmin, async (req, res) => {
  const [templates, channels] = await Promise.all([
    listTemplates(req.guild.id),
    d.getGuildChannels(req.guild.id).catch(() => []),
  ]);
  await g(req, res, "templates", {
    tab: "templates",
    templates,
    channels: channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position),
    sent: req.query.sent,
    saved: req.query.saved,
  });
});

app.post("/dashboard/:guildId/templates/:key", requireAuth, requireGuildAdmin, async (req, res) => {
  const key = req.params.key;
  if (!(key in TEMPLATE_DEFS)) return res.redirect(`/dashboard/${req.guild.id}/templates`);
  const b = req.body;
  if (b._action === "reset") {
    await resetTemplate(req.guild.id, key);
    return res.redirect(`/dashboard/${req.guild.id}/templates?saved=${key}`);
  }
  await saveTemplate(req.guild.id, key, {
    name: TEMPLATE_DEFS[key].name,
    content: (b.content || "").slice(0, 1800),
    embed: cleanEmbed(b),
    enabled: b.enabled === "on" || b.enabled === undefined,
  });
  res.redirect(`/dashboard/${req.guild.id}/templates?saved=${key}`);
});

// A dashboard admin may only make the bot post into a channel / ping a role that
// actually belongs to the guild they're managing — never another tenant's server.
async function resolveSendTarget(req) {
  const channelId = (req.body.channelId || "").trim();
  const ping = (req.body.ping || "").trim();
  if (!channelId || !(await d.channelInGuild(req.guild.id, channelId))) return null;
  if (ping && !(await d.roleInGuild(req.guild.id, ping))) return null;
  return { channelId, ping };
}

app.post("/dashboard/:guildId/templates/:key/send", requireAuth, requireGuildAdmin, async (req, res) => {
  const key = req.params.key;
  const target = await resolveSendTarget(req);
  if (!target) return res.redirect(`/dashboard/${req.guild.id}/templates?sent=0`);
  const tpl = await getTemplate(req.guild.id, key);
  const vars = {};
  for (const v of TEMPLATE_DEFS[key]?.vars || []) vars[v] = (req.body["v_" + v] || "").trim();
  if (!vars.staffname) vars.staffname = req.user.username;
  if (!vars.staff) vars.staff = `<@${req.user.id}>`;
  const payload = renderPayload(tpl, vars);
  if (target.ping) payload.content = `<@&${target.ping}> ${payload.content || ""}`.trim();
  payload.allowed_mentions = { roles: target.ping ? [target.ping] : [], parse: ["users"] };
  const r = await d.postChannelMessage(target.channelId, payload);
  res.redirect(`/dashboard/${req.guild.id}/templates?sent=${r.ok ? "1" : "0"}`);
});

app.post("/dashboard/:guildId/send", requireAuth, requireGuildAdmin, async (req, res) => {
  const b = req.body;
  const target = await resolveSendTarget(req);
  if (!target) return res.redirect(`/dashboard/${req.guild.id}/templates?sent=0`);
  const embed = cleanEmbed(b);
  const payload = renderPayload({ content: b.content || "", embed }, {});
  if (target.ping) payload.content = `<@&${target.ping}> ${payload.content || ""}`.trim();
  payload.allowed_mentions = { roles: target.ping ? [target.ping] : [], parse: ["users"] };
  if (!payload.content && !payload.embeds.length) return res.redirect(`/dashboard/${req.guild.id}/templates?sent=0`);
  const r = await d.postChannelMessage(target.channelId, payload);
  res.redirect(`/dashboard/${req.guild.id}/templates?sent=${r.ok ? "1" : "0"}`);
});

// ---- feature flags (per-guild opt-out) ----
app.get("/dashboard/:guildId/flags", requireAuth, requireGuildAdmin, async (req, res) => {
  const rows = listFlagRows();
  const flags = Object.entries(FLAGS).map(([name, meta]) => ({
    name,
    description: meta.description,
    effective: isEnabled(name, { guildId: req.guild.id }),
    disabledHere: !!rows.find((r) => r.name === name && r.scope === "guild" && r.target === req.guild.id && r.enabled === false),
  }));
  await g(req, res, "flags", { tab: "flags", flags, saved: req.query.saved === "1" });
});
app.post("/dashboard/:guildId/flags", requireAuth, requireGuildAdmin, async (req, res) => {
  const off = new Set([].concat(req.body.disable || []));
  for (const name of Object.keys(FLAGS)) {
    if (off.has(name)) await setFlag(name, "guild", req.guild.id, { enabled: false });
    else await clearFlag(name, "guild", req.guild.id);
  }
  res.redirect(`/dashboard/${req.guild.id}/flags?saved=1`);
});

// ---- ER:LC servers ----
app.get("/dashboard/:guildId/erlc", requireAuth, requireGuildAdmin, async (req, res) => {
  const servers = await getServers(req.guild.id);
  await g(req, res, "erlcservers", { tab: "erlc", servers, saved: req.query.saved });
});

app.post("/dashboard/:guildId/erlc", requireAuth, requireGuildAdmin, async (req, res) => {
  const b = req.body;
  const back = (q = "") => res.redirect(`/dashboard/${req.guild.id}/erlc${q}`);
  try {
    if (b._action === "add") {
      const key = (b.key || "").trim();
      const existing = await getServers(req.guild.id);
      if (!key || existing.some((s) => s.api_key === key)) return back("?saved=0");
      try {
        await erlc.server(key);
      } catch {
        return back("?saved=badkey");
      }
      const label = (b.label || (existing.length === 0 ? "Main" : `Server ${existing.length + 1}`)).slice(0, 40);
      if (existing.some((s) => s.label.toLowerCase() === label.toLowerCase())) return back("?saved=0");
      await addServer(req.guild.id, label, key);
    } else if (b._action === "remove") {
      await removeServer(req.guild.id, Number(b.id));
    } else if (b._action === "rename" && b.name) {
      await renameServer(req.guild.id, Number(b.id), b.name.slice(0, 40));
    } else if (b._action === "default") {
      await setDefaultServer(req.guild.id, Number(b.id));
    } else if (b._action === "banscope") {
      await setGuildConfig(req.guild.id, { erlcBanAllServers: b.erlcBanAllServers === "on" });
    }
  } catch (e) {
    console.error("erlc servers POST:", e.message);
  }
  back("?saved=1");
});

// ---- permissions ----
app.get("/dashboard/:guildId/permissions", requireAuth, requireGuildAdmin, async (req, res) => {
  const [groups, roles] = await Promise.all([getPermGroups(req.guild.id), d.getGuildRoles(req.guild.id).catch(() => [])]);
  await g(req, res, "permissions", {
    tab: "permissions",
    groups,
    roles: roles.filter((r) => r.name !== "@everyone" && !r.managed).sort((a, b) => b.position - a.position),
    nodes: NODES,
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
  await g(req, res, "banreqs", { requests, tab: "banreqs" }, requests.map((r) => r.requested_by));
});

app.post("/dashboard/:guildId/banreqs/:id/:decision", requireAuth, requireGuildAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const request = await getBanRequest(id);
  if (request && String(request.guild_id) === req.guild.id && request.status === "pending") {
    if (req.params.decision === "approve") {
      await resolveBanRequest(id, "approved", req.user.id);
      const servers = await getServers(req.guild.id);
      const primary = defaultServer(req.guild.id) || servers[0];
      const targets = req.cfg.erlcBanAllServers ? servers : [primary].filter(Boolean);
      let ran = 0;
      if (erlcAllowed(req.guild.id)) {
        for (const s of targets) {
          try {
            await erlc.command(s.api_key, `:ban ${request.roblox_name}`);
            ran++;
          } catch (e) {
            if (!(e instanceof ErlcError)) throw e;
          }
        }
      }
      const executed = ran > 0;
      const caseRow = await createCase({
        guildId: req.guild.id,
        platform: "roblox",
        subjectId: request.roblox_id,
        subjectName: request.roblox_name,
        type: "ban",
        reason: request.reason,
        erlcServerId: primary?.id ?? null,
        moderatorId: request.requested_by,
        moderatorTag: "ban request (web)",
        executed,
      });
      await postCaseToModlog(req.guild.id, req.cfg, caseRow);
      const fresh = await getBanRequest(id);
      await syncMessage(fresh.channel_id, fresh.message_id, {
        embeds: [await banRequestEmbed(fresh, { caseNumber: caseRow?.case_number })],
        components: [banRequestButtons(id, true)],
      });
    } else {
      await resolveBanRequest(id, "denied", req.user.id);
      const fresh = await getBanRequest(id);
      await syncMessage(fresh.channel_id, fresh.message_id, {
        embeds: [await banRequestEmbed(fresh)],
        components: [banRequestButtons(id, true)],
      });
    }
  }
  res.redirect(`/dashboard/${req.guild.id}/banreqs`);
});

// ---- operator ("ultimate admin") panel ----
app.get("/admin", requireAuth, requireOperator, async (req, res) => {
  const [overview, guilds, locks] = await Promise.all([adminOverview(), adminGuilds(req.query.q || ""), activeLocks()]);
  const ids = [...new Set([...guilds.map((g) => g.owner_id), ...locks.map((l) => l.created_by)].filter(Boolean))].slice(0, 60);
  const owners = ids.length ? await d.userInfos(ids).catch(() => new Map()) : new Map();
  const names = new Map([...owners].map(([id, u]) => [id, u.globalName || u.username || `…${id.slice(-4)}`]));
  res.render("admin", {
    user: req.user,
    overview,
    guilds,
    locks,
    names,
    owners,
    q: req.query.q || "",
    flags: Object.entries(FLAGS).map(([name, meta]) => {
      const g = listFlagRows().find((r) => r.name === name && r.scope === "global" && r.target === "");
      return { name, description: meta.description, default: meta.default, global: g ? (g.enabled == null ? `${g.rollout_pct}%` : g.enabled ? "on" : "off") : "—" };
    }),
    saved: req.query.saved || "",
  });
});

app.post("/admin/flags", requireAuth, requireOperator, async (req, res) => {
  const { name, action } = req.body;
  if (FLAGS[name]) {
    if (action === "on") await setFlag(name, "global", "", { enabled: true });
    else if (action === "off") await setFlag(name, "global", "", { enabled: false });
    else if (action === "clear") await clearFlag(name, "global", "");
    else if (action === "rollout") await setFlag(name, "global", "", { enabled: null, rolloutPct: Math.max(0, Math.min(100, parseInt(req.body.pct, 10) || 0)) });
  }
  res.redirect("/admin?saved=flags");
});

app.post("/admin/locks", requireAuth, requireOperator, async (req, res) => {
  const targetId = String(req.body.targetId || "").replace(/\D/g, "");
  if (targetId) {
    const dur = (req.body.duration || "").trim();
    const ms = dur ? parseDuration(dur) : null;
    await createAction({
      guildId: null,
      targetId,
      type: "lock",
      reason: (req.body.reason || "").slice(0, 500) || null,
      createdBy: req.user.id,
      expiresAt: ms ? Date.now() + ms : null,
      isGlobal: true,
      proof: [req.body.proof].filter(Boolean),
    });
  }
  res.redirect("/admin?saved=lock");
});

app.post("/admin/locks/:targetId/lift", requireAuth, requireOperator, async (req, res) => {
  await acknowledgeAction(String(req.params.targetId).replace(/\D/g, ""), null, { byStaff: true });
  res.redirect("/admin?saved=unlock");
});

app.post("/admin/broadcast", requireAuth, requireOperator, async (req, res) => {
  const text = (req.body.text || "").trim().slice(0, 1800);
  if (!text) return res.redirect("/admin?saved=broadcast-empty");
  const rows = await adminGuilds();
  let sent = 0;
  for (const row of rows) {
    const cfg = await refreshGuildConfig(row.guild_id).catch(() => null);
    const ch = cfg?.modlogChannel;
    if (!ch) continue;
    const r = await d.postChannelMessage(ch, {
      embeds: [{ title: `📣 A message from the ${config.botName} team`, description: text, color: 0x5b6cff }],
    });
    if (r.ok) sent++;
    await new Promise((s) => setTimeout(s, 250)); // gentle
  }
  res.redirect(`/admin?saved=broadcast-${sent}`);
});

app.use((req, res) => res.status(404).render("error", { user: readSession(req), message: "Not found." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`${req.method} ${req.path} →`, err);
  captureError(err, { tags: { scope: "web", method: req.method, path: req.path }, user: readSession(req)?.id });
  if (!res.headersSent) res.status(500).render("error", { user: readSession(req), message: "Something went wrong." });
});

app.listen(config.web.port, () => console.log(`Dashboard on ${BASE} (port ${config.web.port})`));

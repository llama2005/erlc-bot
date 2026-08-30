import { EmbedBuilder, time } from "discord.js";
import { one, query } from "./pg.js";
import { erlc, splitPlayer, ErlcError } from "./erlc.js";
import { getGuildConfig, ensureGuildConfig } from "./guildConfig.js";
import { getServers } from "./erlcServers.js";
import { resolveChannel, resolveSendable } from "./modlog.js";
import { getLinkByRoblox } from "./links.js";
import { autologCommandEntries } from "./ingameAutolog.js";
import { COLORS, EMOJI } from "./style.js";
import { sleep } from "./util.js";

const INTERVAL_MS = Math.max(30, Number(process.env.ERLC_POLL_SECONDS || 60)) * 1000;
const MAX_BURST = 8; // don't dump more than this per endpoint per tick

const getCursor = async (serverId, t) =>
  (await one("SELECT last_ts FROM erlc_log_cursor WHERE server_id=$1 AND log_type=$2", [serverId, t]))?.last_ts ?? 0;
const setCursor = (serverId, t, ts) =>
  query(
    "INSERT INTO erlc_log_cursor (server_id, log_type, last_ts) VALUES ($1,$2,$3) ON CONFLICT (server_id, log_type) DO UPDATE SET last_ts=EXCLUDED.last_ts",
    [serverId, t, ts],
  );

const rblxLink = (name, id) => (id ? `[${name}](https://www.roblox.com/users/${id}/profile)` : name);

async function playerRef(entry) {
  const { name, id } = splitPlayer(entry);
  const link = id ? await getLinkByRoblox(id).catch(() => null) : null;
  return `${rblxLink(name, id)}${link ? ` (<@${link.discord_id}>)` : ""}`;
}

const tag = (label) => (label ? `\`${label}\` · ` : "");

const FORMATTERS = {
  join: async (e, cfg, label) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(e.Join ? COLORS.success : COLORS.neutral)
        .setDescription(`${tag(label)}${e.Join ? EMOJI.online + " **joined**" : EMOJI.offline + " **left**"} ${await playerRef(e.Player)} · ${time(e.Timestamp, "T")}`),
    ],
  }),
  kill: async (e, cfg, label) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setDescription(`${tag(label)}${EMOJI.hammer} ${await playerRef(e.Killer)} killed ${await playerRef(e.Killed)} · ${time(e.Timestamp, "T")}`),
    ],
  }),
  command: async (e, cfg, label) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setDescription(`${tag(label)}${await playerRef(e.Player)} ran \`${e.Command}\` · ${time(e.Timestamp, "T")}`),
    ],
  }),
  modcall: async (e, cfg, label) => ({
    content: cfg.erlcStaffRole ? `<@&${cfg.erlcStaffRole}>` : undefined,
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.warn)
        .setTitle("Moderator call")
        .setDescription(
          `${label ? `**Server:** \`${label}\`\n` : ""}**Caller:** ${await playerRef(e.Caller)}\n**Answered by:** ${e.Moderator ? await playerRef(e.Moderator) : "_unanswered_"}\n${time(e.Timestamp, "T")}`,
        ),
    ],
  }),
};

const JOBS = [
  ["join", "joinLogChannel", (key) => erlc.joinLogs(key)],
  ["kill", "killLogChannel", (key) => erlc.killLogs(key)],
  ["command", "ingameLogChannel", (key) => erlc.commandLogs(key)],
  ["modcall", "modcallLogChannel", (key) => erlc.modCalls(key)],
];

async function checkServerStatus(client, guildId, server, cfg) {
  if (!cfg.statusChannel) return null;
  const label = server.label;
  let info;
  try {
    info = await erlc.server(server.api_key);
  } catch (e) {
    if (e instanceof ErlcError && (e.code === 1001 || e.status === 502 || e.status === 522)) info = null;
    else return null;
  }
  const online = !!info;
  const players = info?.CurrentPlayers ?? null;
  const prev = await one("SELECT online FROM erlc_server_status WHERE server_id=$1", [server.id]);
  await query(
    "INSERT INTO erlc_server_status (server_id, online, players, checked_at) VALUES ($1,$2,$3,$4) ON CONFLICT (server_id) DO UPDATE SET online=EXCLUDED.online, players=EXCLUDED.players, checked_at=EXCLUDED.checked_at",
    [server.id, online, players, Date.now()],
  );
  if (prev && prev.online !== null && prev.online !== online) {
    const { channel } = await resolveSendable(client, cfg.statusChannel, guildId);
    if (channel)
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(online ? COLORS.success : COLORS.danger)
              .setTitle(online ? `${EMOJI.online} ${label} is back online` : `${EMOJI.offline} ${label} went offline`)
              .setDescription(online && info ? `**${info.Name}** · ${info.CurrentPlayers}/${info.MaxPlayers} · join \`${info.JoinKey}\`` : "The API can't reach the private server.")
              .setTimestamp(),
          ],
        })
        .catch(() => {});
  }
  return info;
}

/** Poll one ER:LC server for a guild. `showLabel` when the guild has >1 server. */
async function pollServer(client, guildId, server, cfg, showLabel) {
  const key = server.api_key;
  const label = showLabel ? server.label : "";

  await checkServerStatus(client, guildId, server, cfg).catch(() => {});

  // players list — used for in-game auto-log target resolution
  let players = [];
  if (cfg.ingameLogChannel || cfg.ingameAutolog) players = await erlc.players(key).catch(() => []);

  for (const [type, field, fetch] of JOBS) {
    const channelId = cfg[field];
    const autolog = type === "command" && cfg.ingameAutolog;
    if (!channelId && !autolog) continue;
    const channel = channelId ? await resolveChannel(client, channelId, guildId) : null;

    let entries;
    try {
      entries = await fetch(key);
    } catch {
      continue;
    }
    if (!Array.isArray(entries) || !entries.length) continue;

    const cursor = await getCursor(server.id, type);
    const maxTs = Math.max(...entries.map((e) => e.Timestamp || 0));

    if (cursor === 0) {
      await setCursor(server.id, type, maxTs); // first run — establish baseline, don't backfill
      continue;
    }

    const fresh = entries
      .filter((e) => (e.Timestamp || 0) > cursor)
      .sort((a, b) => a.Timestamp - b.Timestamp)
      .slice(-MAX_BURST);

    if (fresh.length) {
      if (channel) {
        for (const e of fresh) {
          await channel.send(await FORMATTERS[type](e, cfg, label)).catch(() => {});
          await sleep(250);
        }
      }
      if (autolog)
        await autologCommandEntries(client, guildId, server.id, fresh, players).catch((e) => console.error("autolog:", e.message));
    }
    if (maxTs > cursor) await setCursor(server.id, type, maxTs);
    await sleep(400); // gentle spacing between endpoints
  }
  return true;
}

/** Expand a guild into (guildId, server) work items, or [] if nothing is configured. */
async function guildWorkItems(guildId) {
  await ensureGuildConfig(guildId);
  const cfg = getGuildConfig(guildId);
  const wantsLogs = JOBS.some(([, field]) => cfg[field]);
  if (!wantsLogs && !cfg.ingameAutolog && !cfg.statusChannel) return [];
  const servers = await getServers(guildId);
  if (!servers.length) return [];
  const showLabel = servers.length > 1;
  return servers.map((server) => ({ guildId, server, cfg, showLabel }));
}

let timer = null;
const POLL_CONCURRENCY = Math.max(1, Number(process.env.ERLC_POLL_CONCURRENCY || 5));

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function pool(items, limit, worker) {
  const queue = [...items];
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (await worker(item)) done++;
      }
    }),
  );
  return done;
}

export function startErlcPoller(client) {
  if (timer) return;
  const tick = async () => {
    const started = Date.now();
    const guildIds = [...client.guilds.cache.keys()];
    const items = (await Promise.all(guildIds.map((g) => guildWorkItems(g).catch(() => [])))).flat();
    const polled = await pool(items, POLL_CONCURRENCY, ({ guildId, server, cfg, showLabel }) =>
      pollServer(client, guildId, server, cfg, showLabel).catch((e) => {
        console.error(`ERLC poll (${guildId}/${server.label}):`, e.message);
        return false;
      }),
    );
    if (polled) console.log(`ER:LC poll: ${polled} server(s), ${Date.now() - started}ms`);
  };
  timer = setInterval(() => tick().catch(() => {}), INTERVAL_MS);
  timer.unref?.();
  console.log(`ER:LC poller running every ${INTERVAL_MS / 1000}s`);
  // small delay so the client is fully ready
  setTimeout(() => tick().catch(() => {}), 5000);
}

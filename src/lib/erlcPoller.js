import { EmbedBuilder, time } from "discord.js";
import { config } from "../config.js";
import { one, query } from "./pg.js";
import { erlc, splitPlayer } from "./erlc.js";
import { getGuildConfig, ensureGuildConfig } from "./guildConfig.js";
import { resolveChannel } from "./modlog.js";
import { getLinkByRoblox } from "./links.js";
import { COLORS, EMOJI } from "./style.js";
import { sleep } from "./util.js";

const INTERVAL_MS = Math.max(30, Number(process.env.ERLC_POLL_SECONDS || 60)) * 1000;
const MAX_BURST = 8; // don't dump more than this per endpoint per tick

const getCursor = async (g, t) => (await one("SELECT last_ts FROM erlc_cursor WHERE guild_id=$1 AND log_type=$2", [g, t]))?.last_ts ?? 0;
const setCursor = (g, t, ts) =>
  query(
    "INSERT INTO erlc_cursor (guild_id, log_type, last_ts) VALUES ($1,$2,$3) ON CONFLICT (guild_id, log_type) DO UPDATE SET last_ts=EXCLUDED.last_ts",
    [g, t, ts],
  );

const rblxLink = (name, id) => (id ? `[${name}](https://www.roblox.com/users/${id}/profile)` : name);

async function playerRef(entry) {
  const { name, id } = splitPlayer(entry);
  const link = id ? await getLinkByRoblox(id).catch(() => null) : null;
  return `${rblxLink(name, id)}${link ? ` (<@${link.discord_id}>)` : ""}`;
}

const FORMATTERS = {
  join: async (e) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(e.Join ? COLORS.success : COLORS.neutral)
        .setDescription(`${e.Join ? EMOJI.online + " **joined**" : EMOJI.offline + " **left**"} ${await playerRef(e.Player)} · ${time(e.Timestamp, "T")}`),
    ],
  }),
  kill: async (e) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.danger)
        .setDescription(`${EMOJI.hammer} ${await playerRef(e.Killer)} killed ${await playerRef(e.Killed)} · ${time(e.Timestamp, "T")}`),
    ],
  }),
  command: async (e) => ({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.primary)
        .setDescription(`${await playerRef(e.Player)} ran \`${e.Command}\` · ${time(e.Timestamp, "T")}`),
    ],
  }),
  modcall: async (e, cfg) => ({
    content: cfg.erlcStaffRole ? `<@&${cfg.erlcStaffRole}>` : undefined,
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.warn)
        .setTitle("Moderator call")
        .setDescription(
          `**Caller:** ${await playerRef(e.Caller)}\n**Answered by:** ${e.Moderator ? await playerRef(e.Moderator) : "_unanswered_"}\n${time(e.Timestamp, "T")}`,
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

async function pollGuild(client, guildId) {
  await ensureGuildConfig(guildId);
  const cfg = getGuildConfig(guildId);
  const key = cfg.erlcKey || config.erlc.devKey;
  if (!key) return;
  if (!JOBS.some(([, field]) => cfg[field])) return; // nothing configured

  for (const [type, field, fetch] of JOBS) {
    const channelId = cfg[field];
    if (!channelId) continue;
    const channel = await resolveChannel(client, channelId);
    if (!channel) continue;

    let entries;
    try {
      entries = await fetch(key);
    } catch {
      continue;
    }
    if (!Array.isArray(entries) || !entries.length) continue;

    const cursor = await getCursor(guildId, type);
    const maxTs = Math.max(...entries.map((e) => e.Timestamp || 0));

    if (cursor === 0) {
      await setCursor(guildId, type, maxTs); // first run — establish baseline, don't backfill
      continue;
    }

    const fresh = entries
      .filter((e) => (e.Timestamp || 0) > cursor)
      .sort((a, b) => a.Timestamp - b.Timestamp)
      .slice(-MAX_BURST);

    for (const e of fresh) {
      await channel.send(await FORMATTERS[type](e, cfg)).catch(() => {});
      await sleep(250);
    }
    if (maxTs > cursor) await setCursor(guildId, type, maxTs);
    await sleep(400); // gentle spacing between endpoints
  }
}

let timer = null;

export function startErlcPoller(client) {
  if (timer) return;
  const tick = async () => {
    for (const guildId of client.guilds.cache.keys()) {
      await pollGuild(client, guildId).catch((e) => console.error(`ERLC poll (${guildId}):`, e.message));
      await sleep(1500);
    }
  };
  timer = setInterval(() => tick().catch(() => {}), INTERVAL_MS);
  timer.unref?.();
  console.log(`ER:LC poller running every ${INTERVAL_MS / 1000}s`);
  // small delay so the client is fully ready
  setTimeout(() => tick().catch(() => {}), 5000);
}

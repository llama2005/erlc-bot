import { EmbedBuilder, time } from "discord.js";
import { many, query } from "./pg.js";
import { erlc } from "./erlc.js";
import { getGuildConfig } from "./guildConfig.js";
import { getServers } from "./erlcServers.js";
import { listPurgeableGuilds, purgeGuildData } from "./botGuilds.js";
import { resolveSendable } from "./modlog.js";
import { tickLoa, loaEmbed, loaReviewButtons } from "./loa.js";
import { dueAutohints, bumpAutohint } from "./autohint.js";
import { dueReminders, deleteReminder } from "./reminders.js";
import { activeStaff, moderatorCaseStats } from "./modstats.js";
import { userShiftStats } from "./shifts.js";
import { COLORS } from "./style.js";
import { formatDuration, sleep } from "./util.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
let timer = null;


async function runLoa(client) {
  const { activated, ended } = await tickLoa();
  for (const row of [...activated, ...ended]) {
    const cfg = getGuildConfig(row.guild_id);
    const { channel } = await resolveSendable(client, cfg.loaChannel, row.guild_id);
    const state = activated.includes(row) ? "started" : "ended";
    if (channel) await channel.send(`🌴 LOA #${row.id} for <@${row.user_id}> has **${state}**.`).catch(() => {});
    if (row.message_id && row.channel_id) {
      const mc = await client.channels.fetch(row.channel_id).catch(() => null);
      await mc?.messages
        .fetch(row.message_id)
        .then((m) => m.edit({ embeds: [loaEmbed(row)], components: [loaReviewButtons(row.id, true)] }))
        .catch(() => {});
    }
    const guild = client.guilds.cache.get(row.guild_id);
    await guild?.members
      .fetch(row.user_id)
      .then((m) => m.send(`Your LOA in **${guild.name}** has ${state}.`))
      .catch(() => {});
  }
}

async function runAutohints(client) {
  for (const h of await dueAutohints()) {
    const servers = await getServers(h.guild_id);
    // null server_id → every connected server; otherwise just the one it targets.
    const targets = h.server_id ? servers.filter((s) => String(s.id) === String(h.server_id)) : servers;
    for (const s of targets) {
      await erlc.command(s.api_key, `:h ${h.message}`).catch(() => {});
      await sleep(300);
    }
    await bumpAutohint(h.id, h.interval_ms);
  }
}

async function runReminders(client) {
  for (const r of await dueReminders()) {
    const ch = client.channels.cache.get(r.channel_id) ?? (await client.channels.fetch(r.channel_id).catch(() => null));
    await ch?.send({ content: `⏰ <@${r.user_id}> reminder: ${r.text}`, allowedMentions: { users: [r.user_id] } }).catch(() => {});
    await deleteReminder(r.id);
  }
}

async function runWeeklyQuota(client) {
  const now = Date.now();
  const rows = await many(
    "SELECT guild_id FROM guild_config WHERE quota_channel IS NOT NULL AND (weekly_shift_quota>0 OR weekly_case_quota>0) AND last_quota_report < $1",
    [now - 6.9 * 24 * 60 * 60 * 1000],
  );
  for (const { guild_id } of rows) {
    const cfg = getGuildConfig(guild_id);
    const { channel } = await resolveSendable(client, cfg.quotaChannel, guild_id);
    if (!channel) continue;
    const since = now - WEEK;
    const staff = await activeStaff(guild_id, since);
    const lines = [];
    for (const uid of staff) {
      const [cases, shift] = await Promise.all([moderatorCaseStats(guild_id, uid, since), userShiftStats(guild_id, uid, since)]);
      const caseOk = !cfg.weeklyCaseQuota || cases.total >= cfg.weeklyCaseQuota;
      const shiftOk = !cfg.weeklyShiftQuota || (shift.total || 0) >= cfg.weeklyShiftQuota;
      lines.push(
        `${caseOk && shiftOk ? "✅" : "❌"} <@${uid}> — ${cases.total} cases · \`${formatDuration(shift.total || 0)}\``,
      );
    }
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLORS.primary)
            .setTitle("Weekly staff activity")
            .setDescription(
              (lines.join("\n") || "No staff activity this week.") +
                `\n\n_Quota: ${cfg.weeklyCaseQuota || "–"} cases · ${cfg.weeklyShiftQuota ? formatDuration(cfg.weeklyShiftQuota) : "–"} on shift_`,
            )
            .setFooter({ text: `Week ending ${new Date().toISOString().slice(0, 10)}` }),
        ],
      })
      .catch(() => {});
    await query("UPDATE guild_config SET last_quota_report=$1 WHERE guild_id=$2", [now, guild_id]);
  }
}

let quotaTimer = null;

const PURGE_DAYS = Math.max(1, Number(process.env.GUILD_PURGE_DAYS || 30));

async function runGuildPurge() {
  const cutoff = Date.now() - PURGE_DAYS * 24 * 60 * 60 * 1000;
  for (const { guild_id } of await listPurgeableGuilds(cutoff)) {
    try {
      const rows = await purgeGuildData(guild_id, { dropBotGuild: true });
      console.log(`purged departed guild ${guild_id} (${rows} rows)`);
    } catch (e) {
      console.error(`guild purge (${guild_id}):`, e.message);
    }
  }
}

export function startScheduler(client) {
  if (timer) return;
  // Fast loop: time-sensitive, cheap, DB-filtered work.
  const tick = async () => {
    await runLoa(client).catch((e) => console.error("scheduler loa:", e.message));
    await runAutohints(client).catch((e) => console.error("scheduler autohints:", e.message));
    await runReminders(client).catch((e) => console.error("scheduler reminders:", e.message));
  };
  timer = setInterval(() => tick().catch(() => {}), 30_000);
  timer.unref?.();
  setTimeout(() => tick().catch(() => {}), 8000);

  // Slow loop: the weekly report does per-user stat queries + a send per guild, so it gets
  // its own cadence and can never stretch the 30s tick when many guilds qualify at once.
  const slowTick = async () => {
    await runWeeklyQuota(client).catch((e) => console.error("scheduler quota:", e.message));
    await runGuildPurge().catch((e) => console.error("scheduler purge:", e.message));
  };
  quotaTimer = setInterval(slowTick, 5 * 60_000);
  quotaTimer.unref?.();
  setTimeout(slowTick, 20_000);

  console.log("Scheduler running (LOA / autohints / reminders / weekly quota)");
}

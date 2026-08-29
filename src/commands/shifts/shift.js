import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, time } from "discord.js";
import { erlcStaff, erlcAdmin } from "../../lib/checks.js";
import { registerComponent } from "../../lib/components.js";
import { COLORS, ok, err, EMOJI } from "../../lib/style.js";
import { formatDuration, parseDuration } from "../../lib/util.js";
import {
  getActiveShift,
  startShift,
  endShift,
  listActiveShifts,
  recentShifts,
  leaderboard,
  userShiftStats,
  weeklyTrend,
  wipeShifts,
  adjustShiftTime,
  listShiftTypes,
} from "../../lib/shifts.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

import { getGuildConfig } from "../../lib/guildConfig.js";

async function toggleShiftRole(guild, userId, add) {
  const roleId = getGuildConfig(guild.id).shiftRole;
  if (!roleId) return;
  const me = guild.members.me;
  if (!me?.permissions.has("ManageRoles")) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await (add ? member.roles.add(roleId) : member.roles.remove(roleId)).catch(() => {});
}

async function panel(guild, userId, username, type = "default") {
  const [active, all, week, trend] = await Promise.all([
    getActiveShift(guild.id, userId),
    userShiftStats(guild.id, userId, 0),
    userShiftStats(guild.id, userId, Date.now() - WEEK),
    weeklyTrend(guild.id, userId, WEEK),
  ]);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `${username} · shifts` })
    .setDescription(
      active
        ? `${EMOJI.online} On duty since ${time(Math.floor(active.started_at / 1000), "R")} (\`${active.shift_type}\`)`
        : `${EMOJI.offline} Off duty`,
    )
    .addFields(
      { name: "All-time", value: `\`${formatDuration(all.total || 0)}\` · ${all.sessions || 0} shifts`, inline: true },
      { name: "This week", value: `\`${formatDuration(week.total || 0)}\` · ${week.sessions || 0} shifts`, inline: true },
      { name: "Trend", value: `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)}% vs last week`, inline: true },
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shift:in:${type}`).setLabel("Clock in").setStyle(ButtonStyle.Success).setDisabled(!!active),
    new ButtonBuilder().setCustomId("shift:out").setLabel("Clock out").setStyle(ButtonStyle.Danger).setDisabled(!active),
  );
  return { embeds: [embed], components: [row] };
}

registerComponent("shift", async (interaction, [action, type]) => {
  const { guild, user } = interaction;
  await interaction.deferUpdate();
  if (action === "in") {
    if (await startShift(guild.id, user.id, type || "default")) await toggleShiftRole(guild, user.id, true);
  } else if (action === "out") {
    if (await endShift(guild.id, user.id)) await toggleShiftRole(guild, user.id, false);
  }
  await interaction.editReply(await panel(guild, user.id, user.username, type || "default"));
});

export default {
  name: "shift",
  description: "Staff duty shifts — clock in/out and track time.",
  module: "shifts",
  guildOnly: true,
  aliases: ["duty"],
  permission: "shift.self",
  defaultSubcommand: "manage",
  subcommands: {
    manage: {
      description: "Open your shift panel.",
      defer: true,
      aliases: ["panel", "me"],
      args: [{ name: "type", type: "string", required: false, description: "Shift type", autocomplete: "shiftTypes" }],
      async execute(ctx) {
        const type = (ctx.args.type || "default").toLowerCase();
        await ctx.reply(await panel(ctx.guild, ctx.author.id, ctx.author.username, type));
      },
    },

    start: {
      description: "Clock in.",
      defer: true,
      args: [{ name: "type", type: "string", required: false, description: "Shift type", autocomplete: "shiftTypes" }],
      async execute(ctx) {
        const type = (ctx.args.type || "default").toLowerCase();
        const s = await startShift(ctx.guild.id, ctx.author.id, type);
        if (!s) return ctx.reply({ content: err("You're already on duty."), ephemeral: true });
        await toggleShiftRole(ctx.guild, ctx.author.id, true);
        await ctx.reply(ok(`Clocked in${type !== "default" ? ` (\`${type}\`)` : ""}.`));
      },
    },

    end: {
      description: "Clock out.",
      defer: true,
      async execute(ctx) {
        const s = await endShift(ctx.guild.id, ctx.author.id);
        if (!s) return ctx.reply({ content: err("You're not on duty."), ephemeral: true });
        await toggleShiftRole(ctx.guild, ctx.author.id, false);
        await ctx.reply(ok(`Clocked out — this shift: \`${formatDuration(s.duration_ms)}\`.`));
      },
    },

    active: {
      description: "Who is on duty right now.",
      defer: true,
      aliases: ["onduty", "od"],
      async execute(ctx) {
        const rows = await listActiveShifts(ctx.guild.id);
        if (!rows.length) return ctx.reply("Nobody is on duty.");
        const lines = rows.map((r) => `• <@${r.user_id}> — \`${formatDuration(Date.now() - r.started_at)}\` (\`${r.shift_type}\`)`);
        await ctx.reply({
          embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`On duty — ${rows.length}`).setDescription(lines.join("\n"))],
        });
      },
    },

    time: {
      description: "Show logged shift time (default: last 7 days).",
      defer: true,
      args: [
        { name: "user", type: "user", required: false, description: "Whose time (default: you)" },
        { name: "period", type: "duration", required: false, description: "Look-back window, e.g. 30d" },
        { name: "type", type: "string", required: false, description: "Shift type", autocomplete: "shiftTypes" },
      ],
      async execute(ctx) {
        const user = ctx.args.user ?? ctx.author;
        const since = Date.now() - (ctx.args.period || WEEK);
        const type = ctx.args.type?.toLowerCase() ?? "";
        const [{ total, sessions }, active] = await Promise.all([
          userShiftStats(ctx.guild.id, user.id, since, type),
          getActiveShift(ctx.guild.id, user.id),
        ]);
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.primary)
              .setAuthor({ name: `Shift time · ${user.username ?? user.tag}` })
              .addFields(
                { name: "Logged", value: `\`${formatDuration(total || 0)}\``, inline: true },
                { name: "Sessions", value: `${sessions || 0}`, inline: true },
                { name: "Status", value: active ? `${EMOJI.online} on duty` : `${EMOJI.offline} off`, inline: true },
              )
              .setFooter({ text: `Since ${new Date(since).toISOString().slice(0, 10)}${type ? ` · type ${type}` : ""}` }),
          ],
        });
      },
    },

    leaderboard: {
      description: "Top staff by shift time (default: last 7 days).",
      defer: true,
      aliases: ["lb", "top"],
      args: [
        { name: "period", type: "duration", required: false, description: "Look-back window, e.g. 30d" },
        { name: "type", type: "string", required: false, description: "Shift type", autocomplete: "shiftTypes" },
      ],
      async execute(ctx) {
        const since = Date.now() - (ctx.args.period || WEEK);
        const rows = (await leaderboard(ctx.guild.id, since, ctx.args.type?.toLowerCase() ?? "")).slice(0, 15);
        if (!rows.length) return ctx.reply("No completed shifts in that window.");
        const medal = ["🥇", "🥈", "🥉"];
        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.primary)
              .setTitle("Shift leaderboard")
              .setDescription(rows.map((r, i) => `${medal[i] ?? `\`${i + 1}.\``} <@${r.user_id}> — \`${formatDuration(r.total)}\` (${r.sessions})`).join("\n"))
              .setFooter({ text: `Since ${new Date(since).toISOString().slice(0, 10)}` }),
          ],
        });
      },
    },

    activity: {
      description: "Check who met a shift-time requirement over a period.",
      defer: true,
      permission: "shift.admin",
      args: [
        { name: "requirement", type: "duration", required: true, description: "Minimum time, e.g. 2h" },
        { name: "period", type: "duration", required: false, description: "Window, e.g. 7d (default 7d)" },
        { name: "type", type: "string", required: false, description: "Shift type", autocomplete: "shiftTypes" },
      ],
      async execute(ctx) {
        const req = ctx.args.requirement;
        const since = Date.now() - (ctx.args.period || WEEK);
        const rows = await leaderboard(ctx.guild.id, since, ctx.args.type?.toLowerCase() ?? "");
        const met = rows.filter((r) => r.total >= req);
        const missed = rows.filter((r) => r.total < req);
        const fmt = (list) => list.map((r) => `<@${r.user_id}> — \`${formatDuration(r.total)}\``).join("\n") || "none";

        await ctx.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(COLORS.success)
              .setTitle(`Met requirement (${formatDuration(req)}) — ${met.length}`)
              .setDescription(fmt(met).slice(0, 4000)),
            new EmbedBuilder()
              .setColor(COLORS.danger)
              .setTitle(`Below requirement — ${missed.length}`)
              .setDescription(fmt(missed).slice(0, 4000))
              .setFooter({ text: `Since ${new Date(since).toISOString().slice(0, 10)}` }),
          ],
        });
      },
    },

    admin: {
      description: "Adjust or wipe a user's shift time (senior staff).",
      defer: true,
      permission: "shift.admin",
      args: [
        { name: "action", type: "string", required: true, description: "add | remove | wipe | list", choices: ["add", "remove", "wipe", "list"] },
        { name: "user", type: "user", required: true, description: "Target staff member" },
        { name: "amount", type: "string", required: false, description: "Duration for add/remove, e.g. 1h30m" },
      ],
      async execute(ctx) {
        const { action, user } = ctx.args;
        if (action === "list") {
          const rows = await recentShifts(ctx.guild.id, user.id, 10);
          if (!rows.length) return ctx.reply(`<@${user.id}> has no completed shifts.`);
          const lines = rows.map((r) => `• ${time(Math.floor(r.started_at / 1000), "d")} — \`${formatDuration(r.duration_ms)}\` (\`${r.shift_type}\`)`);
          return ctx.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setAuthor({ name: `Recent shifts · ${user.username}` }).setDescription(lines.join("\n"))] });
        }
        if (action === "wipe") {
          const n = await wipeShifts(ctx.guild.id, user.id);
          return ctx.reply(ok(`Wiped **${n}** shift record(s) for <@${user.id}>.`));
        }
        const ms = parseDuration(ctx.args.amount);
        if (!ms) return ctx.reply({ content: err("Give a duration like `1h30m` for add/remove."), ephemeral: true });
        await adjustShiftTime(ctx.guild.id, user.id, action === "remove" ? -ms : ms);
        await ctx.reply(ok(`${action === "remove" ? "Removed" : "Added"} \`${formatDuration(ms)}\` ${action === "remove" ? "from" : "to"} <@${user.id}>'s logged time.`));
      },
    },
  },
};

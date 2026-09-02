import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { registerComponent } from "../../lib/components.js";
import { COLORS, err, EMOJI } from "../../lib/style.js";
import { formatDuration, formatDurationLong } from "../../lib/util.js";
import {
  getActiveShift,
  startShift,
  endShift,
  listActiveShifts,
  leaderboard,
  userShiftStats,
  weeklyTrend,
} from "../../lib/shifts.js";
import { mainPanel } from "./_shiftadmin.js"; // also registers the `sa` component
import { logShiftEvent } from "../../lib/shiftLog.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;

import { applyShiftRole as toggleShiftRole } from "../../lib/shiftRole.js";

const prettyType = (t) => (!t || t === "default" ? "Default Shift Type" : t.replace(/\b\w/g, (c) => c.toUpperCase()));

/** Green "clocked in" / red "clocked out" confirmation embed. */
function clockEmbed(kind, shift) {
  const inn = kind === "in";
  return new EmbedBuilder()
    .setColor(inn ? COLORS.clockIn : COLORS.ban)
    .setDescription(
      inn
        ? `${EMOJI.online} Successfully clocked in to '${prettyType(shift.shift_type)}'.`
        : `${EMOJI.offline} Successfully clocked out of '${prettyType(shift.shift_type)}' — \`${formatDuration(shift.duration_ms)}\` this shift.`,
    )
    .setFooter({ text: `ID: ${shift.id}` });
}

async function panel(guild, userId, username, type = "default") {
  const [active, all, week, trend] = await Promise.all([
    getActiveShift(guild.id, userId),
    userShiftStats(guild.id, userId, 0),
    userShiftStats(guild.id, userId, Date.now() - WEEK),
    weeklyTrend(guild.id, userId, WEEK),
  ]);

  // Weekly running total = completed shifts this week + any time on the current shift.
  const weekTotal = (week.total || 0) + (active && active.started_at >= Date.now() - WEEK ? Date.now() - active.started_at : 0);
  const allTotal = (all.total || 0) + (active ? Date.now() - active.started_at : 0);

  const embed = new EmbedBuilder()
    .setColor(active ? COLORS.clockIn : COLORS.neutral)
    .setAuthor({ name: username })
    .setDescription(
      active
        ? `${EMOJI.online} Clocked in for ${formatDurationLong(Date.now() - active.started_at)}`
        : `${EMOJI.offline} Not clocked in`,
    )
    .addFields({
      name: "Time",
      value: `Total: **${formatDurationLong(allTotal)}**\nWeekly: **${formatDurationLong(weekTotal)}**`,
    });

  if (active) embed.setFooter({ text: `Shift type: ${active.shift_type} | ID: ${active.id}` });
  else if (trend) embed.setFooter({ text: `${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)}% vs last week` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shift:in:${type}`).setLabel("Clock in").setStyle(ButtonStyle.Success).setDisabled(!!active),
    new ButtonBuilder().setCustomId("shift:out").setLabel("Clock out").setStyle(ButtonStyle.Danger).setDisabled(!active),
    new ButtonBuilder().setCustomId(`shift:refresh:${type}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

registerComponent("shift", async (interaction, [action, type]) => {
  const { guild, user } = interaction;
  await interaction.deferUpdate();
  let done = null;
  if (action === "in") {
    const s = await startShift(guild.id, user.id, type || "default");
    if (s) {
      await toggleShiftRole(guild, user.id, true);
      await logShiftEvent(interaction.client, guild.id, { kind: "in", userId: user.id, type: type || "default", shift: s });
      done = clockEmbed("in", s);
    }
  } else if (action === "out") {
    const s = await endShift(guild.id, user.id);
    if (s) {
      await toggleShiftRole(guild, user.id, false);
      await logShiftEvent(interaction.client, guild.id, { kind: "out", userId: user.id, shift: s });
      done = clockEmbed("out", s);
    }
  }
  // action === "refresh" just re-renders.
  await interaction.editReply(await panel(guild, user.id, user.username, type || "default"));
  if (done) await interaction.followUp({ embeds: [done], ephemeral: true }).catch(() => {});
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
        await logShiftEvent(ctx.client, ctx.guild.id, { kind: "in", userId: ctx.author.id, type, shift: s });
        await ctx.reply({ embeds: [clockEmbed("in", s)] });
      },
    },

    end: {
      description: "Clock out.",
      defer: true,
      async execute(ctx) {
        const s = await endShift(ctx.guild.id, ctx.author.id);
        if (!s) return ctx.reply({ content: err("You're not on duty."), ephemeral: true });
        await toggleShiftRole(ctx.guild, ctx.author.id, false);
        await logShiftEvent(ctx.client, ctx.guild.id, { kind: "out", userId: ctx.author.id, shift: s });
        await ctx.reply({ embeds: [clockEmbed("out", s)] });
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
      description: "Open the shift-admin panel for a staff member.",
      defer: true,
      ephemeral: true,
      permission: "shift.admin",
      args: [{ name: "user", type: "user", required: true, description: "Target staff member" }],
      async execute(ctx) {
        await ctx.reply({ ...(await mainPanel(ctx.guild, ctx.args.user.id)), ephemeral: true });
      },
    },
  },
};

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  time,
} from "discord.js";
import { registerComponent } from "../../lib/components.js";
import { hasPermissionInteraction } from "../../lib/permissions.js";
import { COLORS, EMOJI, err } from "../../lib/style.js";
import { formatDuration, parseDuration } from "../../lib/util.js";
import {
  getActiveShift,
  startShift,
  endShift,
  recentShifts,
  wipeShifts,
  userShiftStats,
  weeklyTrend,
  listShiftTypes,
  getShift,
  userShiftsPage,
  bumpShiftDuration,
  setShiftDuration,
  setShiftTypeById,
  deleteShift,
} from "../../lib/shifts.js";
import { applyShiftRole as toggleShiftRole } from "../../lib/shiftRole.js";
import { logShiftEvent } from "../../lib/shiftLog.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
const PER_PAGE = 6;
const EPH = 1 << 6;

const nameFor = async (guild, uid) =>
  (await guild.members.fetch(uid).catch(() => null))?.user?.username ?? `user …${String(uid).slice(-4)}`;

// ---- panels ----

export async function mainPanel(guild, uid) {
  const [active, all, week, trend, recent, username] = await Promise.all([
    getActiveShift(guild.id, uid),
    userShiftStats(guild.id, uid, 0),
    userShiftStats(guild.id, uid, Date.now() - WEEK),
    weeklyTrend(guild.id, uid, WEEK),
    recentShifts(guild.id, uid, 5),
    nameFor(guild, uid),
  ]);
  const { total: completed } = await userShiftsPage(guild.id, uid, 0, 0);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `Shift admin · ${username}` })
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
  if (recent.length)
    embed.addFields({
      name: "Recent shifts",
      value: recent
        .map((s) => `\`#${s.id}\` ${time(Math.floor(s.started_at / 1000), "d")} — \`${formatDuration(s.duration_ms || 0)}\` (\`${s.shift_type}\`)`)
        .join("\n"),
    });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sa:in:${uid}`).setLabel("Clock in").setStyle(ButtonStyle.Success).setDisabled(!!active),
        new ButtonBuilder().setCustomId(`sa:out:${uid}`).setLabel("Clock out").setStyle(ButtonStyle.Danger).setDisabled(!active),
        new ButtonBuilder().setCustomId(`sa:pick:${uid}`).setLabel("Manage shifts").setStyle(ButtonStyle.Primary).setDisabled(completed === 0),
        new ButtonBuilder().setCustomId(`sa:wipe:${uid}`).setLabel("Wipe all").setStyle(ButtonStyle.Secondary).setDisabled(completed === 0),
      ),
    ],
  };
}

async function listPanel(guild, uid, page) {
  const { rows, total } = await userShiftsPage(guild.id, uid, PER_PAGE, page * PER_PAGE);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  page = Math.max(0, Math.min(page, pages - 1));
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `Shifts · ${await nameFor(guild, uid)}` })
    .setDescription(
      rows
        .map((s) => `\`#${s.id}\` ${time(Math.floor(s.started_at / 1000), "f")} — \`${formatDuration(s.duration_ms || 0)}\` (\`${s.shift_type}\`)`)
        .join("\n") || "No completed shifts.",
    )
    .setFooter({ text: `${total} shift(s) · page ${page + 1}/${pages}` });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sa:list:${uid}:${page - 1}`).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`sa:list:${uid}:${page + 1}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
        new ButtonBuilder().setCustomId(`sa:pick:${uid}`).setLabel("Edit a shift").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`sa:back:${uid}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function modifySelect(guild, uid) {
  const { rows } = await userShiftsPage(guild.id, uid, 25, 0);
  if (!rows.length) return mainPanel(guild, uid);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`sa:picked:${uid}`)
    .setPlaceholder("Pick a shift to edit")
    .addOptions(
      rows.map((s) => ({
        label: `Shift #${s.id} — ${formatDuration(s.duration_ms || 0)}`.slice(0, 100),
        description: `${s.shift_type} · ${new Date(Number(s.started_at)).toISOString().slice(0, 10)}`.slice(0, 100),
        value: String(s.id),
      })),
    );
  return {
    embeds: [
      new EmbedBuilder().setColor(COLORS.primary).setAuthor({ name: `Edit a shift · ${await nameFor(guild, uid)}` }).setDescription("Select one of the 25 most recent completed shifts."),
    ],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sa:back:${uid}`).setLabel("Back").setStyle(ButtonStyle.Secondary)),
    ],
  };
}

async function shiftPanel(guild, uid, shiftId) {
  const s = await getShift(guild.id, shiftId);
  if (!s || String(s.user_id) !== String(uid) || s.ended_at == null)
    return { embeds: [new EmbedBuilder().setColor(COLORS.danger).setDescription(err("That shift no longer exists."))], components: [] };
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({ name: `Shift #${s.id} · ${await nameFor(guild, uid)}` })
    .addFields(
      { name: "Started", value: time(Math.floor(s.started_at / 1000), "f"), inline: true },
      { name: "Ended", value: time(Math.floor(s.ended_at / 1000), "f"), inline: true },
      { name: "Duration", value: `\`${formatDuration(s.duration_ms || 0)}\``, inline: true },
      { name: "Type", value: `\`${s.shift_type}\``, inline: true },
    );
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sa:t:add:${uid}:${s.id}`).setLabel("+ time").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`sa:t:rem:${uid}:${s.id}`).setLabel("− time").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`sa:t:set:${uid}:${s.id}`).setLabel("Set time").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`sa:type:${uid}:${s.id}`).setLabel("Change type").setStyle(ButtonStyle.Secondary),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sa:del:${uid}:${s.id}`).setLabel("Delete").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`sa:pick:${uid}`).setLabel("Back").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function typeSelect(guild, uid, shiftId) {
  const types = await listShiftTypes(guild.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`sa:typed:${uid}:${shiftId}`)
    .setPlaceholder("New shift type")
    .addOptions(types.slice(0, 25).map((t) => ({ label: t, value: t })));
  return {
    embeds: [new EmbedBuilder().setColor(COLORS.primary).setDescription(`Set the type for shift \`#${shiftId}\`.`)],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`sa:shift:${uid}:${shiftId}`).setLabel("Back").setStyle(ButtonStyle.Secondary)),
    ],
  };
}

const confirmRow = (yesId, noId, yesLabel = "Confirm") =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(yesId).setLabel(yesLabel).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(noId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );

const timeModal = (op, uid, shiftId) =>
  new ModalBuilder()
    .setCustomId(`sa:tm:${op}:${uid}:${shiftId}`)
    .setTitle(op === "set" ? "Set shift duration" : op === "add" ? "Add time" : "Remove time")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("time").setLabel("Duration").setPlaceholder("e.g. 1h30m").setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );

// ---- dispatch ----

registerComponent("sa", async (interaction, parts) => {
  if (!(await hasPermissionInteraction(interaction, "shift.admin")))
    return interaction.reply({ content: err("You need shift-admin permission for this."), flags: EPH });

  const guild = interaction.guild;
  const [action] = parts;

  // modal submit: sa:tm:<op>:<uid>:<shiftId>
  if (interaction.isModalSubmit()) {
    const [, op, uid, shiftId] = parts;
    const ms = parseDuration(interaction.fields.getTextInputValue("time"));
    if (!ms) return interaction.reply({ content: err("Give a duration like `1h30m`."), flags: EPH });
    if (op === "set") await setShiftDuration(guild.id, shiftId, ms);
    else await bumpShiftDuration(guild.id, shiftId, op === "rem" ? -ms : ms);
    const verb = op === "set" ? `set shift #${shiftId} to ${formatDuration(ms)} for` : `${op === "rem" ? "removed" : "added"} ${formatDuration(ms)} ${op === "rem" ? "from" : "to"} shift #${shiftId} of`;
    await logShiftEvent(interaction.client, guild.id, { kind: "admin", userId: uid, adminId: interaction.user.id, action: verb, shift: { id: shiftId } });
    await interaction.deferUpdate();
    return interaction.editReply(await shiftPanel(guild, uid, shiftId));
  }

  // buttons that open a modal — must NOT defer first
  if (action === "t") {
    const [, op, uid, shiftId] = parts;
    return interaction.showModal(timeModal(op, uid, shiftId));
  }

  await interaction.deferUpdate();

  if (interaction.isStringSelectMenu()) {
    if (action === "picked") return interaction.editReply(await shiftPanel(guild, parts[1], interaction.values[0]));
    if (action === "typed") {
      await setShiftTypeById(guild.id, parts[2], interaction.values[0]);
      await logShiftEvent(interaction.client, guild.id, {
        kind: "admin",
        userId: parts[1],
        adminId: interaction.user.id,
        action: `set shift #${parts[2]} type to **${interaction.values[0]}** for`,
        shift: { id: parts[2] },
      });
      return interaction.editReply(await shiftPanel(guild, parts[1], parts[2]));
    }
    return;
  }

  const uid = parts[1];
  switch (action) {
    case "in": {
      const s = await startShift(guild.id, uid, "default");
      if (s) {
        await toggleShiftRole(guild, uid, true);
        await logShiftEvent(interaction.client, guild.id, { kind: "in", userId: uid, type: "default", shift: s, adminId: interaction.user.id });
      }
      return interaction.editReply(await mainPanel(guild, uid));
    }
    case "out": {
      const s = await endShift(guild.id, uid);
      if (s) {
        await toggleShiftRole(guild, uid, false);
        await logShiftEvent(interaction.client, guild.id, { kind: "out", userId: uid, shift: s, adminId: interaction.user.id });
      }
      return interaction.editReply(await mainPanel(guild, uid));
    }
    case "back":
      return interaction.editReply(await mainPanel(guild, uid));
    case "pick":
      return interaction.editReply(await modifySelect(guild, uid));
    case "list":
      return interaction.editReply(await listPanel(guild, uid, Number(parts[2]) || 0));
    case "shift":
      return interaction.editReply(await shiftPanel(guild, uid, parts[2]));
    case "type":
      return interaction.editReply(await typeSelect(guild, uid, parts[2]));
    case "wipe": {
      const p = await mainPanel(guild, uid);
      p.components = [confirmRow(`sa:wipeok:${uid}`, `sa:back:${uid}`, "Wipe all shifts")];
      p.embeds[0].setDescription(err(`Delete **all** of <@${uid}>'s completed shifts? This can't be undone.`));
      return interaction.editReply(p);
    }
    case "wipeok": {
      const n = await wipeShifts(guild.id, uid);
      await logShiftEvent(interaction.client, guild.id, {
        kind: "admin",
        userId: uid,
        adminId: interaction.user.id,
        action: `wiped all ${n} shift record(s) of`,
      });
      const p = await mainPanel(guild, uid);
      p.embeds[0].setFooter({ text: `Wiped ${n} shift record(s).` });
      return interaction.editReply(p);
    }
    case "del": {
      const p = await shiftPanel(guild, uid, parts[2]);
      p.components = [confirmRow(`sa:delok:${uid}:${parts[2]}`, `sa:shift:${uid}:${parts[2]}`, "Delete this shift")];
      return interaction.editReply(p);
    }
    case "delok": {
      await deleteShift(guild.id, parts[2]);
      await logShiftEvent(interaction.client, guild.id, {
        kind: "admin",
        userId: uid,
        adminId: interaction.user.id,
        action: `deleted shift #${parts[2]} of`,
        shift: { id: parts[2] },
      });
      return interaction.editReply(await modifySelect(guild, uid));
    }
    default:
      return interaction.editReply(await mainPanel(guild, uid));
  }
});

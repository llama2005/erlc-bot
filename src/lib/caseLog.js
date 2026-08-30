import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from "discord.js";
import { registerComponent } from "./components.js";
import { postToModlog } from "./modlog.js";
import { hasPermissionInteraction } from "./permissions.js";
import { getGuildConfig } from "./guildConfig.js";
import { getCase, attachCaseMessage, editReason, editType, voidCase, deleteCase, subjectStats, DISCORD_TYPES } from "./cases.js";
import { listModTypes } from "./modTypes.js";
import { headshotUrl } from "./roblox.js";
import { caseEmbed, ok, err } from "./style.js";
import { formatDuration } from "./util.js";

const EPH = MessageFlags.Ephemeral;

/** The Edit / Change type / Void button row for a case (empty for non-case posts like /purge). */
export function caseButtons(c, { hard = false } = {}) {
  if (!c || !Number.isInteger(Number(c.case_number))) return [];
  const n = c.case_number;
  const done = !!c.voided;
  const voidLabel = done ? "Voided" : hard ? "Delete" : "Void";
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`case:reason:${n}`).setLabel("Edit reason").setStyle(ButtonStyle.Secondary).setDisabled(done),
      new ButtonBuilder().setCustomId(`case:type:${n}`).setLabel("Change type").setStyle(ButtonStyle.Secondary).setDisabled(done),
      new ButtonBuilder().setCustomId(`case:void:${n}`).setLabel(voidLabel).setStyle(ButtonStyle.Danger).setDisabled(done),
    ),
  ];
}

/** Canonical case embed rebuilt from a DB row — used for in-place re-renders after an edit. */
export async function renderCaseEmbed(guild, c) {
  const roblox = c.platform === "roblox";
  const [headshot, stats] = await Promise.all([
    roblox ? headshotUrl(c.subject_id).catch(() => null) : Promise.resolve(null),
    subjectStats(guild.id, c.platform, c.subject_id),
  ]);
  const history = Object.entries(stats).map(([t, ct]) => `${ct}× ${t}`).join(" · ") || "no prior cases";
  const extra = [{ name: "History", value: history, inline: true }];
  if (c.voided)
    extra.push({ name: "Voided", value: `by <@${c.voided_by}>${c.voided_reason ? ` — ${c.voided_reason}` : ""}` });

  const embed = caseEmbed({
    caseNumber: c.case_number,
    type: c.type,
    reason: c.reason,
    target: {
      name: c.subject_name,
      id: c.subject_id,
      url: roblox ? undefined : null,
      headshot,
    },
    moderator: { id: c.moderator_id, tag: c.moderator_tag ?? undefined },
    durationText: c.duration_ms ? formatDuration(Number(c.duration_ms)) : undefined,
    createdAt: Number(c.created_at),
    voided: !!c.voided,
    extraFields: extra,
  });
  if (!roblox) embed.setDescription(`### <@${c.subject_id}>\n\`${c.subject_id}\``);
  // in-game auto-logged cases store a Roblox id/name as moderator_id — render a plain tag, not a broken mention
  if (!/^\d{17,20}$/.test(String(c.moderator_id)) && c.moderator_tag) {
    const i = (embed.data.fields ?? []).findIndex((f) => f.name === "Moderator");
    if (i >= 0) embed.spliceFields(i, 1, { name: "Moderator", value: c.moderator_tag, inline: true });
  }
  return embed;
}

/**
 * Post a case to the mod-log with its edit buttons, and remember which message it is.
 * Drop-in for `postToModlog(guild, embed)` — returns `{ ok, reason }`.
 */
export async function logCase(guild, caseRow, embed) {
  const hard = !!getGuildConfig(guild.id).hardVoid;
  const res = await postToModlog(guild, embed, { components: caseButtons(caseRow, { hard }) });
  if (res.ok && res.message && Number.isInteger(Number(caseRow?.case_number))) {
    await attachCaseMessage(guild.id, caseRow.case_number, res.message.channelId, res.message.id).catch(() => {});
  }
  return { ok: res.ok, reason: res.reason };
}

/** Re-render the stored mod-log message for a case (no-op if it's gone). */
async function refreshLogMessage(client, guildId, caseNumber) {
  const c = await getCase(guildId, caseNumber);
  if (!c?.log_channel_id || !c?.log_message_id) return;
  const channel = await client.channels.fetch(c.log_channel_id).catch(() => null);
  const msg = channel && (await channel.messages.fetch(c.log_message_id).catch(() => null));
  if (!msg) return;
  const hard = !!getGuildConfig(guildId).hardVoid;
  await msg.edit({ embeds: [await renderCaseEmbed(channel.guild, c)], components: caseButtons(c, { hard }) }).catch(() => {});
}

/** Delete the stored mod-log message for a case (used by hard-void). */
async function deleteLogMessage(client, row) {
  if (!row?.log_channel_id || !row?.log_message_id) return;
  const channel = await client.channels.fetch(row.log_channel_id).catch(() => null);
  const msg = channel && (await channel.messages.fetch(row.log_message_id).catch(() => null));
  await msg?.delete().catch(() => {});
}

/**
 * Void a case, honouring the guild's `hardVoid` setting.
 * @returns {Promise<{ mode: "hard" | "soft" }>}
 */
export async function finishVoid(client, guild, caseRow, byId, reason) {
  if (getGuildConfig(guild.id).hardVoid) {
    const row = await deleteCase(guild.id, caseRow.case_number);
    await deleteLogMessage(client, row ?? caseRow);
    return { mode: "hard" };
  }
  await voidCase(guild.id, caseRow.case_number, byId, reason);
  await refreshLogMessage(client, guild.id, caseRow.case_number);
  return { mode: "soft" };
}

const validTypes = async (guildId, platform) =>
  platform === "roblox" ? (await listModTypes(guildId)).map((t) => t.name) : DISCORD_TYPES;

registerComponent("case", async (interaction, parts) => {
  const [kind, nStr] = parts;
  const n = Number(nStr);
  const gid = interaction.guildId;
  const c = await getCase(gid, n);
  if (!c) return interaction.reply({ content: err("That case no longer exists."), flags: EPH });

  const allowed =
    String(c.moderator_id) === interaction.user.id ||
    interaction.memberPermissions?.has("ManageGuild") ||
    interaction.client.ownerIds?.includes(interaction.user.id) ||
    (await hasPermissionInteraction(interaction, "case.manage"));
  if (!allowed)
    return interaction.reply({ content: err("You can only edit your own cases (or need case-manage permission)."), flags: EPH });

  // --- buttons ---
  if (interaction.isButton()) {
    if (c.voided) return interaction.reply({ content: err(`Case #${n} is voided.`), flags: EPH });

    if (kind === "reason") {
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`case:rmod:${n}`)
          .setTitle(`Edit reason · Case #${n}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("New reason")
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true)
                .setValue((c.reason || "").slice(0, 1000)),
            ),
          ),
      );
    }
    if (kind === "void") {
      const hard = !!getGuildConfig(gid).hardVoid;
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`case:vmod:${n}`)
          .setTitle(`${hard ? "Delete" : "Void"} · Case #${n}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel(hard ? "Reason (optional — the case will be deleted)" : "Void reason (optional)")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(300)
                .setRequired(false),
            ),
          ),
      );
    }
    if (kind === "type") {
      const types = await validTypes(gid, c.platform);
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`case:tsel:${n}`)
        .setPlaceholder(`Current: ${c.type}`)
        .addOptions(types.slice(0, 25).map((t) => ({ label: t, value: t, default: t === c.type })));
      return interaction.reply({ content: `Change the type of case #${n}:`, components: [new ActionRowBuilder().addComponents(menu)], flags: EPH });
    }
    return;
  }

  // --- modal submits ---
  if (interaction.isModalSubmit()) {
    if (c.voided) return interaction.reply({ content: err(`Case #${n} is voided.`), flags: EPH });
    if (kind === "rmod") {
      const reason = interaction.fields.getTextInputValue("reason").trim();
      if (!reason) return interaction.reply({ content: err("Reason can't be empty."), flags: EPH });
      await editReason(gid, n, reason);
      await refreshLogMessage(interaction.client, gid, n);
      return interaction.reply({ content: ok(`Case #${n} reason updated.`), flags: EPH });
    }
    if (kind === "vmod") {
      const reason = interaction.fields.getTextInputValue("reason").trim() || null;
      const { mode } = await finishVoid(interaction.client, interaction.guild, c, interaction.user.id, reason);
      return interaction.reply({
        content: ok(mode === "hard" ? `Case #${n} deleted.` : `Case #${n} voided — it no longer counts toward history totals.`),
        flags: EPH,
      });
    }
    return;
  }

  // --- type select ---
  if (interaction.isStringSelectMenu() && kind === "tsel") {
    if (c.voided) return interaction.update({ content: err(`Case #${n} is voided.`), components: [] });
    const t = interaction.values[0];
    if (!(await validTypes(gid, c.platform)).includes(t))
      return interaction.update({ content: err(`\`${t}\` isn't a valid type.`), components: [] });
    await editType(gid, n, t);
    await refreshLogMessage(interaction.client, gid, n);
    return interaction.update({ content: ok(`Case #${n} is now a **${t}**.`), components: [] });
  }
});

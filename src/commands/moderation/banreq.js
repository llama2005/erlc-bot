import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolvePlayer } from "../../lib/erlcModeration.js";
import { headshotUrl } from "../../lib/roblox.js";
import { createCase } from "../../lib/cases.js";
import { getGuildConfig } from "../../lib/guildConfig.js";
import { config } from "../../config.js";
import { registerComponent } from "../../lib/components.js";
import { sendModlog } from "../../lib/modlog.js";
import {
  createBanRequest,
  getBanRequest,
  attachMessage,
  resolveBanRequest,
  hasPendingRequest,
} from "../../lib/banRequests.js";
import { hasPermissionInteraction } from "../../lib/permissions.js";
import { PLAYER_ARG } from "./_shared.js";

const PENDING_COLOR = 0x3498db;

function keyForGuild(guildId) {
  return getGuildConfig(guildId).erlcKey || config.erlc.devKey || null;
}

const isApprover = (interaction) => hasPermissionInteraction(interaction, "mod.banreq.approve");

function buttons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`banreq:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`banreq:deny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

registerComponent("banreq", async (interaction, [action, idStr]) => {
  const id = Number(idStr);
  const req = await getBanRequest(id);
  if (!req) return interaction.reply({ content: "That ban request no longer exists.", ephemeral: true });
  if (req.status !== "pending")
    return interaction.reply({ content: `Already ${req.status} by <@${req.resolved_by}>.`, ephemeral: true });
  if (!(await isApprover(interaction)))
    return interaction.reply({ content: "You need the ER:LC admin role (or Manage Server) to decide this.", ephemeral: true });

  await interaction.deferUpdate();

  const base = EmbedBuilder.from(interaction.message.embeds[0]);

  if (action === "deny") {
    await resolveBanRequest(id, "denied", interaction.user.id);
    base.setColor(0xe74c3c).setTitle("Ban request — DENIED").addFields({ name: "Denied by", value: `<@${interaction.user.id}>` });
    return interaction.message.edit({ embeds: [base], components: [buttons(id, true)] });
  }

  // approve → execute the ban + open a case
  await resolveBanRequest(id, "approved", interaction.user.id);
  const key = keyForGuild(req.guild_id);
  let executed = true;
  try {
    if (!key) throw new ErlcError("No ER:LC key configured.");
    await erlc.command(key, `:ban ${req.roblox_name}`);
  } catch (err) {
    if (err instanceof ErlcError) executed = false;
    else throw err;
  }

  const c = await createCase({
    guildId: req.guild_id,
    platform: "roblox",
    subjectId: req.roblox_id,
    subjectName: req.roblox_name,
    type: "ban",
    reason: req.reason,
    moderatorId: req.requested_by,
    moderatorTag: "ban request",
    executed,
  });

  base
    .setColor(0x2ecc71)
    .setTitle("Ban request — APPROVED")
    .addFields({ name: "Approved by", value: `<@${interaction.user.id}>`, inline: true }, { name: "Case", value: `#${c.case_number}`, inline: true });
  if (!executed) base.setFooter({ text: "in-game :ban failed — case logged anyway" });
  await interaction.message.edit({ embeds: [base], components: [buttons(id, true)] });

  const guild = interaction.client.guilds.cache.get(req.guild_id);
  if (guild)
    await sendModlog(guild, {
      action: "ban",
      target: { tag: req.roblox_name, id: req.roblox_id },
      moderator: { tag: "approved", id: interaction.user.id },
      reason: req.reason,
      extra: `Ban request #${id} · Case #${c.case_number}`,
      url: `https://www.roblox.com/users/${req.roblox_id}/profile`,
    });
});

export default {
  name: "banreq",
  description: "Request a ban that a senior staff member must approve.",
  module: "moderation",
  guildOnly: true,
  defer: true,
  aliases: ["banrequest", "requestban"],
  permission: "mod.banreq",
  ratelimit: { scope: "user", uses: 5, per: 30_000 },
  args: [PLAYER_ARG, { name: "reason", type: "text", required: true, description: "Reason" }],
  async execute(ctx) {
    const target = await resolvePlayer(keyForGuild(ctx.guild.id), ctx.args.player);
    if (target?.unlinkedDiscordId)
      return ctx.reply({ content: `<@${target.unlinkedDiscordId}> hasn't linked a Roblox account (\`/verify\`).`, ephemeral: true });
    if (!target) return ctx.reply({ content: `No match for \`${ctx.args.player}\`.`, ephemeral: true });

    if (await hasPendingRequest(ctx.guild.id, target.id))
      return ctx.reply({ content: `There's already a pending ban request for **${target.name}**.`, ephemeral: true });

    const req = await createBanRequest({
      guildId: ctx.guild.id,
      robloxId: target.id,
      robloxName: target.name,
      reason: ctx.args.reason,
      requestedBy: ctx.author.id,
    });

    const cfg = ctx.config;
    const destId = cfg.banreqChannel || cfg.modlogChannel;
    const dest =
      (destId && (ctx.guild.channels.cache.get(destId) ?? (await ctx.client.channels.fetch(destId).catch(() => null)))) ||
      ctx.channel;

    const embed = new EmbedBuilder()
      .setColor(PENDING_COLOR)
      .setTitle("Ban request — pending")
      .setURL(`https://www.roblox.com/users/${target.id}/profile`)
      .setThumbnail(await headshotUrl(target.id).catch(() => null))
      .setDescription(`**[${target.name}](https://www.roblox.com/users/${target.id}/profile)**  \`${target.id}\``)
      .addFields(
        { name: "Reason", value: ctx.args.reason },
        { name: "Requested by", value: `<@${ctx.author.id}>`, inline: true },
        { name: "Request", value: `#${req.id}`, inline: true },
      );

    const msg = await dest.send({ embeds: [embed], components: [buttons(req.id)] });
    await attachMessage(req.id, msg.id, dest.id);

    await ctx.reply({
      content: dest.id === ctx.channel.id ? "Ban request posted for approval." : `Ban request #${req.id} sent to <#${dest.id}>.`,
      ephemeral: true,
    });
  },
};

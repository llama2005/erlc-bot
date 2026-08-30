import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolvePlayer } from "../../lib/erlcModeration.js";
import { createCase } from "../../lib/cases.js";
import { getGuildConfig } from "../../lib/guildConfig.js";
import { defaultServer, getServers } from "../../lib/erlcServers.js";
import { registerComponent } from "../../lib/components.js";
import { logCase, renderCaseEmbed } from "../../lib/caseLog.js";
import {
  getBanRequest,
  resolveBanRequest,
  hasPendingRequest,
  fileBanRequest,
  banRequestButtons,
  banRequestEmbed,
} from "../../lib/banRequests.js";
import { hasPermissionInteraction } from "../../lib/permissions.js";
import { reportOffDuty } from "../../lib/dutyWatch.js";
import { PLAYER_ARG } from "./_shared.js";

const keyForGuild = (guildId) => defaultServer(guildId)?.api_key ?? null;

const isApprover = (interaction) => hasPermissionInteraction(interaction, "mod.banreq.approve");

registerComponent("banreq", async (interaction, [action, idStr]) => {
  const id = Number(idStr);
  const req = await getBanRequest(id);
  if (!req || String(req.guild_id) !== interaction.guildId)
    return interaction.reply({ content: "That ban request no longer exists.", ephemeral: true });
  if (req.status !== "pending")
    return interaction.reply({ content: `Already ${req.status} by <@${req.resolved_by}>.`, ephemeral: true });
  if (!(await isApprover(interaction)))
    return interaction.reply({ content: "You need the ER:LC admin role (or Manage Server) to decide this.", ephemeral: true });

  await interaction.deferUpdate();

  reportOffDuty(interaction.client, {
    guild: interaction.guild,
    userId: interaction.user.id,
    userTag: interaction.user.tag ?? interaction.user.username,
    action: `ban request ${action}`,
    invokedIn: interaction.channelId,
  }).catch(() => {});

  if (action === "deny") {
    await resolveBanRequest(id, "denied", interaction.user.id);
    const fresh = await getBanRequest(id);
    return interaction.message
      .edit({ embeds: [await banRequestEmbed(fresh)], components: [banRequestButtons(id, true)] })
      .catch(() => {});
  }

  // approve → execute the ban + open a case
  await resolveBanRequest(id, "approved", interaction.user.id);
  const cfg = getGuildConfig(req.guild_id);
  const all = await getServers(req.guild_id);
  const targets = cfg.erlcBanAllServers ? all : [defaultServer(req.guild_id)].filter(Boolean);
  let ran = 0;
  for (const s of targets) {
    try {
      await erlc.command(s.api_key, `:ban ${req.roblox_name}`);
      ran++;
      if (targets.length > 1) await new Promise((r) => setTimeout(r, 5200));
    } catch (err) {
      if (!(err instanceof ErlcError)) throw err;
    }
  }
  const executed = ran > 0;

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
    erlcServerId: defaultServer(req.guild_id)?.id ?? null,
  });

  const fresh = await getBanRequest(id);
  const embed = await banRequestEmbed(fresh, { caseNumber: c.case_number });
  if (!executed) embed.setFooter({ text: "in-game :ban failed — case logged anyway" });
  await interaction.message.edit({ embeds: [embed], components: [banRequestButtons(id, true)] }).catch(() => {});

  const guild = interaction.client.guilds.cache.get(req.guild_id);
  if (guild) await logCase(guild, c, await renderCaseEmbed(guild, c)).catch(() => {});
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

    const r = await fileBanRequest({
      guild: ctx.guild,
      client: ctx.client,
      robloxId: target.id,
      robloxName: target.name,
      reason: ctx.args.reason,
      requestedBy: ctx.author.id,
      fallbackChannelId: ctx.channel.id,
    });
    if (r.skipped === "no-channel")
      return ctx.reply({ content: "Couldn't post the ban request — set a ban-request or modlog channel with `/config banreq #channel`.", ephemeral: true });

    await ctx.reply({ content: `Ban request #${r.req.id} filed for approval.`, ephemeral: true });
  },
};

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, time } from "discord.js";
import { registerComponent } from "../../lib/components.js";
import { resolveSendable } from "../../lib/modlog.js";
import { hasPermissionInteraction } from "../../lib/permissions.js";
import { COLORS, ok, err } from "../../lib/style.js";
import { parseDuration, formatDuration } from "../../lib/util.js";
import { createLoa, getLoa, attachLoaMessage, listLoa, setLoaStatus, isOnLoa } from "../../lib/loa.js";

const MAX = 90 * 24 * 60 * 60 * 1000;

function reviewButtons(id, done = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`loa:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(`loa:deny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(done),
  );
}

registerComponent("loa", async (interaction, [action, idStr]) => {
  const row = await getLoa(Number(idStr));
  if (!row || String(row.guild_id) !== interaction.guildId)
    return interaction.reply({ content: "That LOA request no longer exists.", flags: 1 << 6 });
  if (row.status !== "pending" && row.status !== "active")
    return interaction.reply({ content: `Already ${row.status}.`, flags: 1 << 6 });
  if (!(await hasPermissionInteraction(interaction, "shift.admin")))
    return interaction.reply({ content: "You need shift-admin permission to review LOA requests.", flags: 1 << 6 });

  await interaction.deferUpdate();
  const now = Date.now();
  const newStatus = action === "approve" ? (row.starts_at <= now ? "active" : "pending-approved") : "denied";
  await setLoaStatus(row.id, action === "approve" ? (row.starts_at <= now ? "active" : "pending") : "denied", interaction.user.id);
  // (a future-dated approved LOA stays 'pending' and the scheduler flips it to 'active'; store approver anyway)

  const base = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(action === "approve" ? COLORS.success : COLORS.danger)
    .setTitle(`LOA — ${action === "approve" ? "APPROVED" : "DENIED"}`)
    .addFields({ name: action === "approve" ? "Approved by" : "Denied by", value: `<@${interaction.user.id}>` });
  await interaction.message.edit({ embeds: [base], components: [reviewButtons(row.id, true)] });

  const guild = interaction.client.guilds.cache.get(row.guild_id);
  const member = guild && (await guild.members.fetch(row.user_id).catch(() => null));
  await member?.send(`Your LOA in **${guild.name}** was **${action === "approve" ? "approved" : "denied"}**.`).catch(() => {});
  void newStatus;
});

export default {
  name: "loa",
  description: "Staff leave of absence.",
  module: "shifts",
  guildOnly: true,
  permission: "shift.self",
  aliases: ["leave"],
  subcommands: {
    request: {
      description: "Request time off (exempts you from off-duty alerts & quotas while active).",
      defer: true,
      ephemeral: true,
      args: [
        { name: "duration", type: "duration", required: true, description: "e.g. 7d, 2w" },
        { name: "reason", type: "text", required: false, description: "Why" },
        { name: "starts", type: "duration", required: false, description: "Start after a delay, e.g. 1d (default now)" },
      ],
      async execute(ctx) {
        if (ctx.args.duration > MAX) return ctx.reply({ content: err("Max LOA is 90 days."), ephemeral: true });
        if (await isOnLoa(ctx.guild.id, ctx.author.id)) return ctx.reply({ content: err("You're already on an active LOA."), ephemeral: true });

        const startsAt = Date.now() + (ctx.args.starts || 0);
        const endsAt = startsAt + ctx.args.duration;
        const row = await createLoa({ guildId: ctx.guild.id, userId: ctx.author.id, reason: ctx.args.reason, startsAt, endsAt });

        const embed = new EmbedBuilder()
          .setColor(COLORS.warn)
          .setTitle("LOA — pending review")
          .setDescription(`<@${ctx.author.id}> requested leave.`)
          .addFields(
            { name: "From", value: time(Math.floor(startsAt / 1000), "D"), inline: true },
            { name: "Until", value: time(Math.floor(endsAt / 1000), "D"), inline: true },
            { name: "Length", value: formatDuration(ctx.args.duration), inline: true },
            { name: "Reason", value: ctx.args.reason || "*none given*" },
          )
          .setFooter({ text: `LOA #${row.id}` });

        const { channel } = await resolveSendable(ctx.client, ctx.config.loaChannel, ctx.guild.id);
        const dest = channel ?? ctx.channel;
        const msg = await dest.send({ embeds: [embed], components: [reviewButtons(row.id)] });
        await attachLoaMessage(row.id, msg.id, dest.id);
        await ctx.reply(ok(`LOA request #${row.id} submitted${channel ? ` to <#${dest.id}>` : ""}.`));
      },
    },

    list: {
      description: "Show pending & active LOAs.",
      defer: true,
      async execute(ctx) {
        const rows = await listLoa(ctx.guild.id);
        if (!rows.length) return ctx.reply("No pending or active LOAs.");
        const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle(`LOAs — ${rows.length}`).setDescription(
          rows
            .map((r) => `\`#${r.id}\` <@${r.user_id}> · **${r.status}** · until ${time(Math.floor(r.ends_at / 1000), "R")}${r.reason ? `\n> ${r.reason}` : ""}`)
            .join("\n"),
        );
        await ctx.reply({ embeds: [embed] });
      },
    },

    cancel: {
      description: "Cancel your own LOA (or, with shift-admin, someone else's).",
      defer: true,
      ephemeral: true,
      args: [{ name: "id", type: "int", required: true, description: "LOA number (see /loa list)" }],
      async execute(ctx) {
        const row = await getLoa(ctx.args.id);
        if (!row || row.guild_id !== ctx.guild.id) return ctx.reply({ content: err("No such LOA."), ephemeral: true });
        const mine = row.user_id === ctx.author.id;
        if (!mine && !ctx.permissions.has("ManageGuild") && !ctx.isOwner)
          return ctx.reply({ content: err("You can only cancel your own LOA."), ephemeral: true });
        await setLoaStatus(row.id, "ended", ctx.author.id);
        await ctx.reply(ok(`LOA #${row.id} ended.`));
      },
    },
  },
};

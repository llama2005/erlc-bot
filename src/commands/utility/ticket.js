import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { one, many, query } from "../../lib/pg.js";
import { registerComponent } from "../../lib/components.js";
import { getGuildConfig } from "../../lib/guildConfig.js";
import { COLORS, okEmbed, infoEmbed, ok, err } from "../../lib/style.js";

const panelRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("ticket:open").setLabel("Open a ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary),
);
const closeRow = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("ticket:close").setLabel("Close ticket").setStyle(ButtonStyle.Danger),
);

async function openTicket(interaction) {
  const cfg = getGuildConfig(interaction.guild.id);
  const existing = await one("SELECT channel_id FROM tickets WHERE guild_id=$1 AND opener_id=$2 AND status='open'", [interaction.guild.id, interaction.user.id]);
  if (existing) return interaction.reply({ embeds: [infoEmbed(`You already have an open ticket: <#${existing.channel_id}>`)], flags: 1 << 6 });

  const me = interaction.guild.members.me;
  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
  ];
  if (cfg.ticketStaffRole)
    overwrites.push({ id: cfg.ticketStaffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

  const ch = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: cfg.ticketCategory || undefined,
    permissionOverwrites: overwrites,
  });

  await query("INSERT INTO tickets (guild_id, channel_id, opener_id, created_at) VALUES ($1,$2,$3,$4)", [
    interaction.guild.id,
    ch.id,
    interaction.user.id,
    Date.now(),
  ]);

  await ch.send({
    content: `<@${interaction.user.id}>${cfg.ticketStaffRole ? ` · <@&${cfg.ticketStaffRole}>` : ""}`,
    embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle("Ticket opened").setDescription("Describe your issue — staff will be with you shortly.")],
    components: [closeRow],
  });
  await interaction.reply({ embeds: [okEmbed(`Ticket created: <#${ch.id}>`)], flags: 1 << 6 });
}

async function closeTicket(interaction) {
  const t = await one("SELECT * FROM tickets WHERE channel_id=$1 AND status='open'", [interaction.channelId]);
  if (!t) return interaction.reply({ content: "This isn't an open ticket channel.", flags: 1 << 6 });
  await query("UPDATE tickets SET status='closed', closed_at=$1, closed_by=$2 WHERE id=$3", [Date.now(), interaction.user.id, t.id]);
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.neutral).setDescription(`Ticket closed by <@${interaction.user.id}>. Channel deletes in 10s.`)] });
  await interaction.channel.permissionOverwrites.edit(t.opener_id, { ViewChannel: false }).catch(() => {});
  setTimeout(() => interaction.channel.delete("Ticket closed").catch(() => {}), 10_000);
}

registerComponent("ticket", async (interaction, [action]) => {
  if (action === "open") return openTicket(interaction);
  if (action === "close") return closeTicket(interaction);
});

export default {
  name: "ticket",
  description: "Support ticket system.",
  module: "utility",
  guildOnly: true,
  ephemeral: true,
  subcommands: {
    panel: {
      description: "Post the 'open a ticket' panel.",
      defer: true,
      userPermissions: ["ManageGuild"],
      args: [
        { name: "channel", type: "channel", required: true, description: "Where to post" },
        { name: "message", type: "text", required: false, description: "Panel text" },
      ],
      async execute(ctx) {
        const embed = new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle("Support")
          .setDescription(ctx.args.message?.replace(/\\n/g, "\n") || "Need help? Open a ticket and staff will assist you.");
        await ctx.args.channel.send({ embeds: [embed], components: [panelRow] });
        await ctx.reply({ embeds: [okEmbed(`Ticket panel posted in <#${ctx.args.channel.id}>.`)], ephemeral: true });
      },
    },
    close: {
      description: "Close the current ticket.",
      defer: true,
      async execute(ctx) {
        const t = await one("SELECT * FROM tickets WHERE channel_id=$1 AND status='open'", [ctx.channel.id]);
        if (!t) return ctx.reply({ content: err("Run this inside an open ticket channel."), ephemeral: true });
        await query("UPDATE tickets SET status='closed', closed_at=$1, closed_by=$2 WHERE id=$3", [Date.now(), ctx.author.id, t.id]);
        await ctx.reply(ok("Closing — channel deletes in 10s."));
        setTimeout(() => ctx.channel.delete("Ticket closed").catch(() => {}), 10_000);
      },
    },
  },
};

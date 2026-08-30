import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { one, query } from "../../lib/pg.js";
import { registerComponent } from "../../lib/components.js";
import { COLORS, ok, err } from "../../lib/style.js";

registerComponent("br", async (interaction, [action, roleId]) => {
  if (action !== "toggle") return;
  const member = interaction.member;
  const has = member.roles.cache.has(roleId);
  try {
    if (has) await member.roles.remove(roleId);
    else await member.roles.add(roleId);
    await interaction.reply({ content: `${has ? "Removed" : "Added"} <@&${roleId}>.`, flags: 1 << 6 });
  } catch {
    await interaction.reply({ content: "I can't manage that role (it may be above my highest role).", flags: 1 << 6 });
  }
});

export default {
  name: "buttonrole",
  description: "Post a panel of role-toggle buttons.",
  module: "utility",
  guildOnly: true,
  defer: true,
  ephemeral: true,
  aliases: ["rolebuttons", "rr"],
  userPermissions: ["ManageRoles"],
  botPermissions: ["ManageRoles"],
  args: [
    { name: "channel", type: "channel", required: true, description: "Where to post the panel" },
    { name: "title", type: "string", required: true, description: "Panel heading" },
    { name: "role1", type: "role", required: true, description: "A role" },
    { name: "role2", type: "role", required: false, description: "A role" },
    { name: "role3", type: "role", required: false, description: "A role" },
    { name: "role4", type: "role", required: false, description: "A role" },
    { name: "role5", type: "role", required: false, description: "A role" },
  ],
  async execute(ctx) {
    const roles = [ctx.args.role1, ctx.args.role2, ctx.args.role3, ctx.args.role4, ctx.args.role5].filter(Boolean);
    const me = ctx.guild.members.me;
    const bad = roles.filter((r) => r.position >= me.roles.highest.position || r.managed);
    if (bad.length) return ctx.reply({ content: err(`I can't assign: ${bad.map((r) => r.name).join(", ")} (above my role or managed).`), ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(ctx.args.title.slice(0, 256))
      .setDescription(roles.map((r) => `• <@&${r.id}>`).join("\n"));
    const row = new ActionRowBuilder().addComponents(
      roles.map((r) => new ButtonBuilder().setCustomId(`br:toggle:${r.id}`).setLabel(r.name.slice(0, 40)).setStyle(ButtonStyle.Secondary)),
    );

    const msg = await ctx.args.channel.send({ embeds: [embed], components: [row] });
    await query("INSERT INTO button_role_panels (message_id, guild_id, channel_id, roles) VALUES ($1,$2,$3,$4)", [
      msg.id,
      ctx.guild.id,
      ctx.args.channel.id,
      JSON.stringify(roles.map((r) => r.id)),
    ]);
    await ctx.reply(ok(`Role panel posted in <#${ctx.args.channel.id}>.`));
  },
};

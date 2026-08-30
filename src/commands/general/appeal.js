import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { one, query } from "../../lib/pg.js";
import { registerComponent } from "../../lib/components.js";
import { resolveSendable } from "../../lib/modlog.js";
import { hasPermissionInteraction } from "../../lib/permissions.js";
import { getLinkByDiscord } from "../../lib/links.js";
import { userByUsername } from "../../lib/roblox.js";
import { getSubjectCases } from "../../lib/cases.js";
import { createCase } from "../../lib/cases.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { getGuildConfig } from "../../lib/guildConfig.js";
import { resolveErlcKey } from "../../config.js";
import { COLORS, ok, err } from "../../lib/style.js";

function buttons(id, done = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appeal:approve:${id}`).setLabel("Approve & unban").setStyle(ButtonStyle.Success).setDisabled(done),
    new ButtonBuilder().setCustomId(`appeal:deny:${id}`).setLabel("Deny").setStyle(ButtonStyle.Danger).setDisabled(done),
  );
}

registerComponent("appeal", async (interaction, [action, idStr]) => {
  const a = await one("SELECT * FROM appeals WHERE id=$1", [Number(idStr)]);
  if (!a || String(a.guild_id) !== interaction.guildId)
    return interaction.reply({ content: "That appeal no longer exists.", flags: 1 << 6 });
  if (a.status !== "pending") return interaction.reply({ content: `Already ${a.status}.`, flags: 1 << 6 });
  if (!(await hasPermissionInteraction(interaction, "mod.ban")))
    return interaction.reply({ content: "You need ban permission to decide appeals.", flags: 1 << 6 });

  await interaction.deferUpdate();
  await query("UPDATE appeals SET status=$1, reviewed_by=$2 WHERE id=$3", [action === "approve" ? "approved" : "denied", interaction.user.id, a.id]);

  const base = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(action === "approve" ? COLORS.success : COLORS.danger)
    .setTitle(`Ban appeal — ${action === "approve" ? "APPROVED" : "DENIED"}`)
    .addFields({ name: action === "approve" ? "Approved by" : "Denied by", value: `<@${interaction.user.id}>` });

  let note = "";
  if (action === "approve" && a.roblox_name) {
    const key = resolveErlcKey(getGuildConfig(a.guild_id));
    try {
      if (key) await erlc.command(key, `:unban ${a.roblox_name}`);
      const c = await createCase({
        guildId: a.guild_id,
        platform: "roblox",
        subjectId: a.roblox_id,
        subjectName: a.roblox_name,
        type: "unban",
        reason: `Appeal #${a.id} approved`,
        moderatorId: interaction.user.id,
        moderatorTag: "appeal",
        executed: !!key,
      });
      base.addFields({ name: "Case", value: `#${c.case_number}`, inline: true });
      note = key ? "" : " (no ER:LC key — logged only)";
    } catch (e) {
      if (!(e instanceof ErlcError)) throw e;
      note = " (in-game :unban failed)";
    }
  }

  await interaction.message.edit({ embeds: [base], components: [buttons(a.id, true)] });
  const guild = interaction.client.guilds.cache.get(a.guild_id);
  await guild?.members
    .fetch(a.user_id)
    .then((m) => m.send(`Your ban appeal in **${guild.name}** was **${action === "approve" ? "approved" : "denied"}**${note}.`))
    .catch(() => {});
});

export default {
  name: "appeal",
  description: "Submit a ban appeal for review.",
  module: "general",
  guildOnly: true,
  defer: true,
  ephemeral: true,
  ratelimit: { scope: "user", uses: 2, per: 24 * 60 * 60 * 1000 },
  args: [
    { name: "reason", type: "text", required: true, description: "Why you should be unbanned" },
    { name: "roblox", type: "string", required: false, description: "Your Roblox username (if not linked)" },
  ],
  async execute(ctx) {
    if (!ctx.config.appealChannel)
      return ctx.reply({ content: err("This server hasn't set up ban appeals."), ephemeral: true });

    const pending = await one("SELECT id FROM appeals WHERE guild_id=$1 AND user_id=$2 AND status='pending'", [ctx.guild.id, ctx.author.id]);
    if (pending) return ctx.reply({ content: err(`You already have a pending appeal (#${pending.id}).`), ephemeral: true });

    let robloxId = null;
    let robloxName = null;
    const link = await getLinkByDiscord(ctx.author.id);
    if (link) {
      robloxId = link.roblox_id;
      robloxName = link.roblox_name;
    } else if (ctx.args.roblox) {
      const hit = await userByUsername(ctx.args.roblox);
      if (hit) {
        robloxId = String(hit.id);
        robloxName = hit.name;
      }
    }

    const a = await one(
      `INSERT INTO appeals (guild_id, user_id, roblox_id, roblox_name, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ctx.guild.id, ctx.author.id, robloxId, robloxName, ctx.args.reason.slice(0, 1500), Date.now()],
    );

    const priors = robloxId ? await getSubjectCases(ctx.guild.id, "roblox", robloxId) : [];
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle("Ban appeal — pending")
      .setDescription(`From <@${ctx.author.id}>${robloxName ? ` · Roblox **${robloxName}** \`${robloxId}\`` : " · *no Roblox account linked*"}`)
      .addFields(
        { name: "Appeal", value: ctx.args.reason.slice(0, 1024) },
        { name: "Prior cases", value: priors.length ? priors.slice(0, 6).map((c) => `\`#${c.case_number}\` ${c.type} — ${c.reason || "—"}`).join("\n") : "none on record" },
      )
      .setFooter({ text: `Appeal #${a.id}` });

    const { channel } = await resolveSendable(ctx.client, ctx.config.appealChannel, ctx.guild.id);
    const dest = channel ?? ctx.channel;
    const msg = await dest.send({ embeds: [embed], components: [buttons(a.id)] });
    await query("UPDATE appeals SET message_id=$1, channel_id=$2 WHERE id=$3", [msg.id, dest.id, a.id]);
    await ctx.reply(ok(`Appeal #${a.id} submitted for review. You'll be DMed with the outcome.`));
  },
};

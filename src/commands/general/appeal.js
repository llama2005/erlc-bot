import { one, query } from "../../lib/pg.js";
import { registerComponent } from "../../lib/components.js";
import { resolveSendable } from "../../lib/modlog.js";
import { hasPermissionInteraction } from "../../lib/permissions.js";
import { getLinkByDiscord } from "../../lib/links.js";
import { userByUsername } from "../../lib/roblox.js";
import { getSubjectCases } from "../../lib/cases.js";
import { createCase } from "../../lib/cases.js";
import { logCase, renderCaseEmbed } from "../../lib/caseLog.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { getGuildConfig } from "../../lib/guildConfig.js";
import { defaultServer, getServers } from "../../lib/erlcServers.js";
import { getAppeal, appealEmbed, appealReviewButtons } from "../../lib/appeals.js";
import { ok, err } from "../../lib/style.js";

const buttons = appealReviewButtons;

registerComponent("appeal", async (interaction, [action, idStr]) => {
  const a = await getAppeal(Number(idStr));
  if (!a || String(a.guild_id) !== interaction.guildId)
    return interaction.reply({ content: "That appeal no longer exists.", flags: 1 << 6 });
  if (a.status !== "pending") return interaction.reply({ content: `Already ${a.status}.`, flags: 1 << 6 });
  if (!(await hasPermissionInteraction(interaction, "mod.ban")))
    return interaction.reply({ content: "You need ban permission to decide appeals.", flags: 1 << 6 });

  await interaction.deferUpdate();
  await query("UPDATE appeals SET status=$1, reviewed_by=$2, reviewed_at=$3 WHERE id=$4", [
    action === "approve" ? "approved" : "denied",
    interaction.user.id,
    Date.now(),
    a.id,
  ]);
  const fresh = await getAppeal(a.id);

  let note = "";
  let caseNumber = null;
  if (action === "approve" && a.roblox_name) {
    const cfg = getGuildConfig(a.guild_id);
    const primary = defaultServer(a.guild_id);
    const targets = cfg.erlcBanAllServers ? await getServers(a.guild_id) : [primary].filter(Boolean);
    let ran = 0;
    try {
      for (const s of targets) {
        try {
          await erlc.command(s.api_key, `:unban ${a.roblox_name}`);
          ran++;
          if (targets.length > 1) await new Promise((r) => setTimeout(r, 5200));
        } catch (e) {
          if (!(e instanceof ErlcError)) throw e;
        }
      }
      const c = await createCase({
        guildId: a.guild_id,
        platform: "roblox",
        subjectId: a.roblox_id,
        subjectName: a.roblox_name,
        type: "unban",
        reason: `Appeal #${a.id} approved`,
        moderatorId: interaction.user.id,
        moderatorTag: "appeal",
        executed: ran > 0,
        erlcServerId: primary?.id ?? null,
      });
      caseNumber = c.case_number;
      note = ran > 0 ? "" : " (ER:LC not connected — logged only)";
      const g = interaction.client.guilds.cache.get(a.guild_id);
      if (g) await logCase(g, c, await renderCaseEmbed(g, c)).catch(() => {});
    } catch (e) {
      if (!(e instanceof ErlcError)) throw e;
      note = " (in-game :unban failed)";
    }
  }

  await interaction.message.edit({ embeds: [appealEmbed(fresh, { caseNumber })], components: [buttons(a.id, true)] }).catch(() => {});
  const guild = interaction.client.guilds.cache.get(a.guild_id);
  await guild?.members
    .fetch(a.user_id)
    .then((m) =>
      m.send(`Your ban appeal in **${guild.name}** was **${action === "approve" ? "approved" : "denied"}** by ${interaction.user.username}${note}.`),
    )
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

    const { channel } = await resolveSendable(ctx.client, ctx.config.appealChannel, ctx.guild.id);
    const dest = channel ?? ctx.channel;
    const msg = await dest.send({ embeds: [appealEmbed(a, { priors })], components: [buttons(a.id)] });
    await query("UPDATE appeals SET message_id=$1, channel_id=$2 WHERE id=$3", [msg.id, dest.id, a.id]);
    await ctx.author
      .send(`Your ban appeal (#${a.id}) in **${ctx.guild.name}** was submitted for review — you'll be DMed with the outcome.`)
      .catch(() => {});
    await ctx.reply(ok(`Appeal #${a.id} submitted for review. You'll be DMed with the outcome.`));
  },
};

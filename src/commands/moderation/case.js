import { EmbedBuilder, time } from "discord.js";
import { getCase, getLastCase, getLastCaseByMod, editReason, editType } from "../../lib/cases.js";
import { finishVoid } from "../../lib/caseLog.js";
import { listModTypes } from "../../lib/modTypes.js";
import { DISCORD_TYPES } from "../../lib/cases.js";
import { COLORS, actionVerb, ok, err } from "../../lib/style.js";
import { hasPermission } from "../../lib/permissions.js";

/** Resolve "123" | "last" | "slast" to a case row. */
async function findCase(ctx, ref) {
  const r = String(ref).toLowerCase();
  if (["slast", "server-last", "serverlast"].includes(r)) return getLastCase(ctx.guild.id);
  if (r === "last") return getLastCaseByMod(ctx.guild.id, ctx.author.id);
  const n = Number.parseInt(r, 10);
  return Number.isInteger(n) ? getCase(ctx.guild.id, n) : null;
}

const canEdit = async (ctx, c) =>
  ctx.isOwner || ctx.permissions.has("ManageGuild") || c.moderator_id === ctx.author.id || (await hasPermission(ctx, "case.manage"));

const CASE_ARG = { name: "case", type: "string", required: true, description: "Case number, 'last' (yours), or 'slast' (server)" };

function subjectLink(c) {
  return c.platform === "roblox"
    ? { text: `**[${c.subject_name}](https://www.roblox.com/users/${c.subject_id}/profile)**  \`${c.subject_id}\``, url: `https://www.roblox.com/users/${c.subject_id}/profile` }
    : { text: `<@${c.subject_id}>  \`${c.subject_id}\``, url: undefined };
}

export default {
  name: "case",
  description: "View and manage moderation cases (Discord + ER:LC).",
  module: "moderation",
  guildOnly: true,
  aliases: ["modcase"],
  permission: "case.view",
  subcommands: {
    view: {
      description: "Show a moderation case.",
      defer: true,
      args: [CASE_ARG],
      async execute(ctx) {
        const c = await findCase(ctx, ctx.args.case);
        if (!c) return ctx.reply({ content: err("No such case."), ephemeral: true });
        const link = subjectLink(c);
        const embed = new EmbedBuilder()
          .setColor(c.voided ? COLORS.neutral : COLORS[c.type] ?? COLORS.primary)
          .setAuthor({ name: `Case #${c.case_number} · ${actionVerb(c.type)}${c.voided ? " (voided)" : ""}` })
          .setDescription(`${link.text}\n_${c.platform === "roblox" ? "ER:LC" : "Discord"} moderation_`)
          .addFields(
            { name: "Reason", value: c.reason || "—" },
            { name: "Moderator", value: `<@${c.moderator_id}>`, inline: true },
            { name: "When", value: time(Math.floor(c.created_at / 1000), "F"), inline: true },
          );
        if (link.url) embed.setURL(link.url);
        if (c.duration_ms) embed.addFields({ name: "Duration", value: `${Math.round(c.duration_ms / 60000)}m`, inline: true });
        if (c.platform === "roblox") embed.addFields({ name: "Executed in-game", value: c.executed ? "yes" : "no", inline: true });
        if (c.evidence) embed.addFields({ name: "Evidence", value: String(c.evidence).slice(0, 1024) });
        if (c.voided) embed.addFields({ name: "Voided", value: `by <@${c.voided_by}>${c.voided_reason ? ` — ${c.voided_reason}` : ""}` });
        await ctx.reply({ embeds: [embed] });
      },
    },

    reason: {
      description: "Edit a case's reason.",
      defer: true,
      args: [CASE_ARG, { name: "reason", type: "text", required: true, description: "New reason" }],
      async execute(ctx) {
        const c = await findCase(ctx, ctx.args.case);
        if (!c) return ctx.reply({ content: err("No such case."), ephemeral: true });
        if (!(await canEdit(ctx, c))) return ctx.reply({ content: err("You can only edit your own cases (or need Manage Server)."), ephemeral: true });
        await editReason(ctx.guild.id, c.case_number, ctx.args.reason);
        await ctx.reply(ok(`Case #${c.case_number} reason updated.`));
      },
    },

    type: {
      description: "Change a case's type.",
      defer: true,
      args: [CASE_ARG, { name: "type", type: "string", required: true, description: "New type" }],
      async execute(ctx) {
        const c = await findCase(ctx, ctx.args.case);
        if (!c) return ctx.reply({ content: err("No such case."), ephemeral: true });
        if (!(await canEdit(ctx, c))) return ctx.reply({ content: err("You can only edit your own cases (or need Manage Server)."), ephemeral: true });
        const valid = c.platform === "roblox" ? (await listModTypes(ctx.guild.id)).map((t) => t.name) : DISCORD_TYPES;
        const t = ctx.args.type.toLowerCase();
        if (!valid.includes(t)) return ctx.reply({ content: err(`Type must be one of: ${valid.join(", ")}`), ephemeral: true });
        await editType(ctx.guild.id, c.case_number, t);
        await ctx.reply(ok(`Case #${c.case_number} is now a **${t}**.`));
      },
    },

    void: {
      description: "Void a case (deletes it, unless soft-void mode is on).",
      defer: true,
      aliases: ["delete", "remove"],
      args: [CASE_ARG, { name: "reason", type: "text", required: false, description: "Why" }],
      async execute(ctx) {
        const c = await findCase(ctx, ctx.args.case);
        if (!c) return ctx.reply({ content: err("No such case."), ephemeral: true });
        if (!(await canEdit(ctx, c))) return ctx.reply({ content: err("You can only void your own cases (or need Manage Server)."), ephemeral: true });
        if (c.voided) return ctx.reply({ content: err(`Case #${c.case_number} is already voided.`), ephemeral: true });
        const { mode } = await finishVoid(ctx.client, ctx.guild, c, ctx.author.id, ctx.args.reason);
        await ctx.reply(
          ok(mode === "hard" ? `Case #${c.case_number} deleted.` : `Case #${c.case_number} voided — no longer counts toward history totals.`),
        );
      },
    },
  },
};

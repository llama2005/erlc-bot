import { EmbedBuilder, time } from "discord.js";
import { createAction, acknowledgeAction, listActions, proofFor } from "../../lib/botActions.js";
import { resolveSendable } from "../../lib/modlog.js";
import { COLORS, ok, err } from "../../lib/style.js";
import { parseDuration, formatDuration } from "../../lib/util.js";

const staffOrOwner = (ctx) =>
  ctx.isOwner || ctx.permissions?.has("ManageGuild") ? true : "You need Manage Server (or be a bot operator).";

const USER = { name: "user", type: "user", required: true, description: "The user" };
const GLOBAL = { name: "global", type: "bool", required: false, description: "Apply everywhere (operators only)" };

async function announce(ctx, action, verb) {
  const cfg = ctx.config;
  const embed = new EmbedBuilder()
    .setColor(action.type === "lock" ? COLORS.danger : COLORS.warn)
    .setAuthor({ name: `Bot ${verb}` })
    .setDescription(`<@${action.target_id}>${action.is_global ? " · **global**" : ""}`)
    .addFields({ name: "Reason", value: action.reason || "*none*" }, { name: "By", value: `<@${action.created_by}>`, inline: true })
    .setFooter({ text: `Action #${action.id}` })
    .setTimestamp();
  if (action.expires_at) embed.addFields({ name: "Until", value: time(Math.floor(Number(action.expires_at) / 1000), "f"), inline: true });
  const { channel } = await resolveSendable(ctx.client, cfg.modlogChannel, ctx.guild.id);
  await channel?.send({ embeds: [embed] }).catch(() => {});
  const u = await ctx.client.users.fetch(action.target_id).catch(() => null);
  await u
    ?.send(
      action.type === "lock"
        ? `You have been **locked out of ${ctx.client.user.username}**${action.is_global ? "" : ` in **${ctx.guild.name}**`}${action.reason ? `: ${action.reason}` : "."}${
            action.expires_at ? ` Until ${time(Math.floor(Number(action.expires_at) / 1000), "f")}.` : " Use any command and press Acknowledge to lift it."
          }`
        : `You were **warned** by ${ctx.client.user.username}${action.is_global ? "" : ` in **${ctx.guild.name}**`}${action.reason ? `: ${action.reason}` : "."}`,
    )
    .catch(() => {});
}

export default {
  name: "botmod",
  description: "Moderate a user's access to the bot itself.",
  module: "config",
  guildOnly: true,
  check: staffOrOwner,
  subcommands: {
    warn: {
      description: "Warn a user about their bot usage (DM + logged, no lock).",
      defer: true,
      check: staffOrOwner,
      args: [USER, { name: "reason", type: "text", required: true, description: "Reason" }, GLOBAL],
      async execute(ctx) {
        if (ctx.args.global && !ctx.isOwner) return ctx.reply({ content: err("Only bot operators can use `global`."), ephemeral: true });
        const a = await createAction({
          guildId: ctx.guild.id,
          targetId: ctx.args.user.id,
          type: "warn",
          reason: ctx.args.reason,
          createdBy: ctx.author.id,
          isGlobal: !!ctx.args.global,
        });
        await announce(ctx, a, "warning");
        await ctx.reply(ok(`Warned <@${ctx.args.user.id}> (action #${a.id}).`));
      },
    },
    lock: {
      description: "Lock a user out of the bot until they acknowledge (or a duration passes).",
      defer: true,
      check: staffOrOwner,
      args: [
        USER,
        { name: "reason", type: "text", required: false, description: "Reason" },
        { name: "duration", type: "string", required: false, description: "e.g. 7d — omit for acknowledge-to-clear" },
        { name: "proof", type: "string", required: false, description: "Evidence URL" },
        GLOBAL,
      ],
      async execute(ctx) {
        if (ctx.args.global && !ctx.isOwner) return ctx.reply({ content: err("Only bot operators can use `global`."), ephemeral: true });
        const ms = ctx.args.duration ? parseDuration(ctx.args.duration) : null;
        if (ctx.args.duration && !ms) return ctx.reply({ content: err("Couldn't parse that duration."), ephemeral: true });
        const a = await createAction({
          guildId: ctx.guild.id,
          targetId: ctx.args.user.id,
          type: "lock",
          reason: ctx.args.reason,
          createdBy: ctx.author.id,
          expiresAt: ms ? Date.now() + ms : null,
          isGlobal: !!ctx.args.global,
          proof: [ctx.args.proof],
        });
        await announce(ctx, a, "lock");
        await ctx.reply(ok(`Locked <@${ctx.args.user.id}>${ms ? ` for ${formatDuration(ms)}` : " until acknowledged"} (action #${a.id}).`));
      },
    },
    unlock: {
      description: "Lift a user's bot lock.",
      defer: true,
      check: staffOrOwner,
      args: [USER],
      async execute(ctx) {
        const cleared = await acknowledgeAction(ctx.args.user.id, ctx.guild.id, { byStaff: true });
        await ctx.reply(cleared ? ok(`Unlocked <@${ctx.args.user.id}>.`) : err("That user has no active lock here."));
      },
    },
    list: {
      description: "Show bot-moderation actions on a user.",
      defer: true,
      check: staffOrOwner,
      args: [USER],
      async execute(ctx) {
        const rows = await listActions(ctx.args.user.id, ctx.guild.id);
        if (!rows.length) return ctx.reply(`No bot-moderation actions on <@${ctx.args.user.id}>.`);
        const lines = await Promise.all(
          rows.map(async (r) => {
            const pr = (await proofFor(r.id)).map((p) => p.url);
            const state = r.acknowledged_at ? "cleared" : r.expires_at && Number(r.expires_at) > Date.now() ? "active (timed)" : r.type === "lock" ? "active" : "—";
            return `\`#${r.id}\` **${r.type}**${r.is_global ? " (global)" : ""} · ${state} · ${time(Math.floor(Number(r.created_at) / 1000), "R")}${r.reason ? `\n> ${r.reason}` : ""}${pr.length ? `\n> proof: ${pr.join(", ")}` : ""}`;
          }),
        );
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle(`Bot actions · ${ctx.args.user.tag ?? ctx.args.user.username}`).setDescription(lines.join("\n\n"))] });
      },
    },
  },
};

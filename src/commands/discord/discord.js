import { createCase, subjectStats } from "../../lib/cases.js";
import { postToModlog } from "../../lib/modlog.js";
import { logCase } from "../../lib/caseLog.js";
import { historyView } from "../../lib/historyView.js";
import { caseEmbed, ok, err, actionVerb } from "../../lib/style.js";
import { formatDuration } from "../../lib/util.js";

const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;
const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
const tempBans = new Map(); // `${guild}:${user}` -> timeout handle

const hierarchyOk = (ctx, member) =>
  ctx.guild.ownerId === ctx.author.id || !ctx.member || member.roles.highest.position < ctx.member.roles.highest.position;

async function statSummary(guildId, userId) {
  const s = await subjectStats(guildId, "discord", userId);
  return Object.entries(s).map(([t, n]) => `${n}× ${t}`).join(" · ") || "no prior cases";
}

/** Create the case, run `perform`, DM the user, reply + modlog with one shared embed. */
async function act(ctx, { type, user, reason, durationMs = null, perform, dm = true }) {
  if (ctx.config.reasonRequired && !reason)
    return ctx.reply({ content: err("This server requires a reason for moderation actions."), ephemeral: true });

  const tag = user.tag ?? user.username;
  const c = await createCase({
    guildId: ctx.guild.id,
    platform: "discord",
    subjectId: user.id,
    subjectName: tag,
    type,
    reason,
    durationMs,
    moderatorId: ctx.author.id,
    moderatorTag: ctx.author.tag ?? ctx.author.username,
    executed: true,
  });

  if (dm)
    await user
      .send(
        `You have been **${actionVerb(type).toLowerCase()}** in **${ctx.guild.name}**${reason ? ` for: ${reason}` : ""}.` +
          (durationMs ? ` Duration: ${formatDuration(durationMs)}.` : ""),
      )
      .catch(() => {});

  let executed = true;
  try {
    await perform();
  } catch {
    executed = false;
  }

  const history = await statSummary(ctx.guild.id, user.id);
  const notes = executed ? [] : ["the Discord action failed — case still logged"];
  const make = () =>
    caseEmbed({
      caseNumber: c.case_number,
      type,
      reason,
      target: { name: tag, id: user.id, url: null, headshot: user.displayAvatarURL?.() },
      moderator: { id: ctx.author.id, iconURL: ctx.author.displayAvatarURL?.() },
      durationText: durationMs ? formatDuration(durationMs) : undefined,
      extraFields: [{ name: "History", value: history, inline: true }],
      footer: notes.join(" · ") || undefined,
    }).setDescription(`### <@${user.id}>\n\`${user.id}\``);

  const log = await logCase(ctx.guild, c, make()).catch(() => ({ ok: false, reason: "error" }));
  if (log.reason) notes.push(`couldn't post to the modlog channel — ${log.reason}`);

  await ctx.reply({ embeds: [make()] }).catch((e) => console.error(`case #${c.case_number} reply failed:`, e.message));
}

export default {
  name: "discord",
  description: "Moderate the Discord server (as opposed to the ER:LC game).",
  module: "discord",
  guildOnly: true,
  aliases: ["dc"],
  subcommands: {
    kick: {
      description: "Kick a Discord member.",
      defer: true,
      userPermissions: ["KickMembers"],
      botPermissions: ["KickMembers"],
      args: [
        { name: "member", type: "member", required: true, description: "Member to kick" },
        { name: "reason", type: "text", required: false, description: "Reason" },
      ],
      async execute(ctx) {
        const { member, reason } = ctx.args;
        if (member.id === ctx.author.id || member.id === ctx.client.user.id)
          return ctx.reply({ content: err("Invalid target."), ephemeral: true });
        if (!member.kickable || !hierarchyOk(ctx, member))
          return ctx.reply({ content: err("I can't kick that member (hierarchy or permissions)."), ephemeral: true });
        await act(ctx, { type: "kick", user: member.user, reason, perform: () => member.kick(`${ctx.author.tag}: ${reason ?? "no reason"}`) });
      },
    },

    ban: {
      description: "Ban a Discord user, optionally for a set duration.",
      defer: true,
      userPermissions: ["BanMembers"],
      botPermissions: ["BanMembers"],
      args: [
        { name: "user", type: "user", required: true, description: "User to ban" },
        { name: "duration", type: "duration", required: false, description: "e.g. 7d — omit for permanent" },
        { name: "reason", type: "text", required: false, description: "Reason" },
      ],
      async execute(ctx) {
        const { user, duration, reason } = ctx.args;
        if (user.id === ctx.author.id || user.id === ctx.client.user.id)
          return ctx.reply({ content: err("Invalid target."), ephemeral: true });
        const member = await ctx.guild.members.fetch(user.id).catch(() => null);
        if (member && (!member.bannable || !hierarchyOk(ctx, member)))
          return ctx.reply({ content: err("I can't ban that member (hierarchy or permissions)."), ephemeral: true });
        if (await ctx.guild.bans.fetch(user.id).catch(() => null))
          return ctx.reply({ content: err(`**${user.tag}** is already banned.`), ephemeral: true });

        await act(ctx, {
          type: "ban",
          user,
          reason,
          durationMs: duration || null,
          perform: () => ctx.guild.bans.create(user.id, { reason: `${ctx.author.tag}: ${reason ?? "no reason"}` }),
        });

        if (duration) {
          const key = `${ctx.guild.id}:${user.id}`;
          clearTimeout(tempBans.get(key));
          tempBans.set(
            key,
            setTimeout(() => {
              ctx.guild.bans.remove(user.id, "Temp-ban expired").catch(() => {});
              tempBans.delete(key);
            }, Math.min(duration, 2 ** 31 - 1)).unref?.() ?? undefined,
          );
        }
      },
    },

    unban: {
      description: "Unban a Discord user.",
      defer: true,
      userPermissions: ["BanMembers"],
      botPermissions: ["BanMembers"],
      args: [
        { name: "user", type: "user", required: true, description: "User to unban (ID works)" },
        { name: "reason", type: "text", required: false, description: "Reason" },
      ],
      async execute(ctx) {
        const { user, reason } = ctx.args;
        if (!(await ctx.guild.bans.fetch(user.id).catch(() => null)))
          return ctx.reply({ content: err(`**${user.tag}** isn't banned.`), ephemeral: true });
        await act(ctx, {
          type: "unban",
          user,
          reason,
          dm: false,
          perform: () => ctx.guild.bans.remove(user.id, `${ctx.author.tag}: ${reason ?? "no reason"}`),
        });
      },
    },

    timeout: {
      description: "Time out a Discord member (e.g. 10m, 2h30m; 0 to clear).",
      defer: true,
      aliases: ["mute"],
      userPermissions: ["ModerateMembers"],
      botPermissions: ["ModerateMembers"],
      args: [
        { name: "member", type: "member", required: true, description: "Member" },
        { name: "duration", type: "duration", required: true, description: "e.g. 10m, 2h30m, 0" },
        { name: "reason", type: "text", required: false, description: "Reason" },
      ],
      async execute(ctx) {
        const { member, duration, reason } = ctx.args;
        if (!member.moderatable || !hierarchyOk(ctx, member))
          return ctx.reply({ content: err("I can't time out that member (hierarchy or permissions)."), ephemeral: true });
        if (duration === 0) {
          await act(ctx, { type: "unmute", user: member.user, reason, dm: false, perform: () => member.timeout(null, `${ctx.author.tag}: cleared`) });
          return;
        }
        if (duration > MAX_TIMEOUT) return ctx.reply({ content: err("Maximum timeout is 28 days."), ephemeral: true });
        await act(ctx, { type: "timeout", user: member.user, reason, durationMs: duration, perform: () => member.timeout(duration, `${ctx.author.tag}: ${reason ?? "no reason"}`) });
      },
    },

    unmute: {
      description: "Clear a member's timeout.",
      defer: true,
      userPermissions: ["ModerateMembers"],
      botPermissions: ["ModerateMembers"],
      args: [{ name: "member", type: "member", required: true, description: "Member" }],
      async execute(ctx) {
        const { member } = ctx.args;
        if (!member.isCommunicationDisabled?.())
          return ctx.reply({ content: err(`**${member.user.tag}** isn't timed out.`), ephemeral: true });
        await act(ctx, { type: "unmute", user: member.user, dm: false, perform: () => member.timeout(null, `${ctx.author.tag}: unmuted`) });
      },
    },

    softban: {
      description: "Ban then immediately unban — kicks the member and clears their recent messages.",
      defer: true,
      userPermissions: ["BanMembers"],
      botPermissions: ["BanMembers"],
      args: [
        { name: "member", type: "member", required: true, description: "Member" },
        { name: "reason", type: "text", required: false, description: "Reason" },
      ],
      async execute(ctx) {
        const { member, reason } = ctx.args;
        if (!member.bannable || !hierarchyOk(ctx, member))
          return ctx.reply({ content: err("I can't softban that member (hierarchy or permissions)."), ephemeral: true });
        await act(ctx, {
          type: "softban",
          user: member.user,
          reason,
          perform: async () => {
            await ctx.guild.bans.create(member.id, { reason: `${ctx.author.tag} (softban): ${reason ?? "no reason"}`, deleteMessageSeconds: 86400 });
            await ctx.guild.bans.remove(member.id, "Softban");
          },
        });
      },
    },

    warn: {
      description: "Warn a Discord member (DM + logged case).",
      defer: true,
      userPermissions: ["ModerateMembers"],
      args: [
        { name: "member", type: "member", required: true, description: "Member to warn" },
        { name: "reason", type: "text", required: true, description: "Reason" },
      ],
      async execute(ctx) {
        const { member, reason } = ctx.args;
        if (member.user.bot || member.id === ctx.author.id)
          return ctx.reply({ content: err("Invalid target."), ephemeral: true });
        await act(ctx, { type: "warn", user: member.user, reason, perform: () => {} });
      },
    },

    history: {
      description: "Show a member's Discord moderation cases (all, paginated).",
      defer: true,
      aliases: ["warnings", "cases"],
      userPermissions: ["ModerateMembers"],
      args: [{ name: "member", type: "user", required: true, description: "Member" }],
      async execute(ctx) {
        const { member } = ctx.args;
        await ctx.reply(await historyView(ctx.guild, "discord", member.id, member.tag ?? member.username));
      },
    },

    purge: {
      description: "Bulk-delete recent messages in this channel (max 100, newer than 14 days).",
      defer: true,
      ephemeral: true,
      userPermissions: ["ManageMessages"],
      botPermissions: ["ManageMessages"],
      args: [
        { name: "amount", type: "int", required: true, description: "1-100" },
        { name: "user", type: "user", required: false, description: "Only this user's messages" },
      ],
      async execute(ctx) {
        const { amount, user } = ctx.args;
        if (!Number.isInteger(amount) || amount < 1 || amount > 100)
          return ctx.reply({ content: err("Amount must be between 1 and 100."), ephemeral: true });
        const fetched = await ctx.channel.messages.fetch({ limit: 100 });
        const cutoff = Date.now() - TWO_WEEKS;
        let targets = [...fetched.values()].filter((m) => m.createdTimestamp > cutoff && !m.pinned);
        if (user) targets = targets.filter((m) => m.author.id === user.id);
        targets = targets.slice(0, amount);
        if (!targets.length) return ctx.reply({ content: err("Nothing to delete (messages may be older than 14 days)."), ephemeral: true });
        const deleted = await ctx.channel.bulkDelete(targets, true);
        await ctx.reply({ content: ok(`Deleted **${deleted.size}** message(s).`), ephemeral: true });
        await postToModlog(ctx.guild, caseEmbed({
          caseNumber: "—",
          type: "purge",
          reason: `${deleted.size} messages in #${ctx.channel.name}${user ? ` from ${user.tag}` : ""}`,
          target: { name: ctx.channel.name, id: ctx.channel.id, url: undefined },
          moderator: { id: ctx.author.id, iconURL: ctx.author.displayAvatarURL?.() },
        }));
      },
    },
  },
};

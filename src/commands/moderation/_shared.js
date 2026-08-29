import { config } from "../../config.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolvePlayer, pm, notifyText } from "../../lib/erlcModeration.js";
import { createCase, subjectStats } from "../../lib/cases.js";
import { getModType } from "../../lib/modTypes.js";
import { postToModlog } from "../../lib/modlog.js";
import { headshotUrl } from "../../lib/roblox.js";
import { caseEmbed, err } from "../../lib/style.js";
import { sleep } from "../../lib/util.js";

export { erlcStaff, erlcAdmin, manageGuild } from "../../lib/checks.js";

/** The guild's ER:LC key, or null. */
export const erlcKeyOrNull = (ctx) => ctx.config.erlcKey || config.erlc.devKey || null;

/** The guild's ER:LC key, throwing a friendly error if unset (use for read/command endpoints). */
export function keyFor(ctx) {
  const key = erlcKeyOrNull(ctx);
  if (!key) throw new ErlcError("No ER:LC API key is set. An admin can set one with `/config erlc-key`.");
  return key;
}

// requiresOnline: the in-game command only works if the player is in the server.
const REQUIRES_ONLINE = new Set(["kick", "jail", "unjail"]);
const SENDS_PM = new Set(["warn", "kick", "ban", "jail", "unjail"]);

export async function statSummary(guildId, robloxId) {
  const stats = await subjectStats(guildId, "roblox", robloxId);
  return (
    Object.entries(stats)
      .map(([t, n]) => `${n}× ${t}`)
      .join(" · ") || "no prior cases"
  );
}

/**
 * Standard flow: resolve player → create case → PM (if online & applicable)
 * → run in-game command(s) → reply + modlog. Reply and modlog use the SAME embed.
 *
 * @param {string} type  a built-in type or a custom mod-type name
 * @param {{reason?: string, ingame?: (target) => string|null}} opts
 */
export async function runAction(ctx, type, { reason, ingame } = {}) {
  const key = erlcKeyOrNull(ctx);

  if (ctx.config.reasonRequired && !reason)
    return ctx.reply({ content: err("This server requires a reason for moderation actions."), ephemeral: true });

  if (ingame && !key)
    return ctx.reply({
      content: err("No ER:LC API key is set, so I can't run that in-game. An admin can set one with `/config erlc-key`. (`warn`, `note` and `bolo` work without a key.)"),
      ephemeral: true,
    });

  const target = await resolvePlayer(key, ctx.args.player);
  if (target?.unlinkedDiscordId)
    return ctx.reply({ content: err(`<@${target.unlinkedDiscordId}> hasn't linked a Roblox account — they need to run \`/verify\`.`), ephemeral: true });
  if (!target)
    return ctx.reply({ content: err(`No player or Roblox user matching \`${ctx.args.player}\`.`), ephemeral: true });

  if (REQUIRES_ONLINE.has(type) && !target.online)
    return ctx.reply({ content: err(`**${target.name}** isn't in the server right now.`), ephemeral: true });

  const modTag = ctx.author.tag ?? ctx.author.username;
  const willExecute = !ingame ? true : target.online || !REQUIRES_ONLINE.has(type);

  const c = await createCase({
    guildId: ctx.guild.id,
    platform: "roblox",
    subjectId: target.id,
    subjectName: target.name,
    type,
    reason,
    moderatorId: ctx.author.id,
    moderatorTag: modTag,
    executed: willExecute,
  });

  let notified = null;
  if (key && SENDS_PM.has(type) && target.online) {
    notified = await pm(key, target.name, notifyText(type, { reason, moderatorTag: modTag, caseNumber: c.case_number }));
    if (ingame) await sleep(5200); // 1 command / 5s API limit
  }

  let executed = true;
  const cmd = ingame?.(target);
  if (cmd) {
    try {
      await erlc.command(key, cmd);
    } catch (e) {
      if (e instanceof ErlcError) executed = false;
      else throw e;
    }
  }

  const headshot = await headshotUrl(target.id).catch(() => null);
  const history = await statSummary(ctx.guild.id, target.id);
  const notes = [];
  if (!target.online) notes.push("player offline");
  if (notified === false) notes.push("in-game PM failed");
  if (cmd && !executed) notes.push("in-game command failed — case still logged");

  const make = (footerNotes) =>
    caseEmbed({
      caseNumber: c.case_number,
      type,
      reason,
      target: { name: target.name, id: target.id, headshot },
      moderator: { id: ctx.author.id, tag: modTag, iconURL: ctx.author.displayAvatarURL?.() },
      extraFields: [{ name: "History", value: history, inline: true }],
      footer: footerNotes.join(" · ") || undefined,
    });

  // Post to the modlog first so a reply failure never loses the record.
  const log = await postToModlog(ctx.guild, make(notes)).catch(() => ({ ok: false, reason: "error" }));
  if (log.reason) notes.push(`couldn't post to the modlog channel — ${log.reason}`);

  try {
    await ctx.reply({ embeds: [make(notes)] });
  } catch (err) {
    console.error(`case #${c.case_number} reply failed:`, err.message);
  }
}

export const PLAYER_ARG = {
  name: "player",
  type: "string",
  required: true,
  description: "In-game name, or Roblox username/ID",
  autocomplete: "erlcPlayers",
};

/** Resolve an in-game command builder for a (possibly custom) type. Falls back to none. */
export async function ingameForType(guildId, type) {
  const builtin = {
    kick: (t) => `:kick ${t.name}`,
    ban: (t) => `:ban ${t.name}`,
    unban: (t) => `:unban ${t.name}`,
    jail: (t) => `:jail ${t.name}`,
    unjail: (t) => `:unjail ${t.name}`,
  };
  if (builtin[type]) return builtin[type];
  const custom = await getModType(guildId, type);
  if (custom?.ingame_cmd) return (t) => custom.ingame_cmd.replaceAll("{player}", t.name);
  return null;
}

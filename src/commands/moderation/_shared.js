import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolvePlayer, pm, notifyText } from "../../lib/erlcModeration.js";
import { resolveServer, getServers } from "../../lib/erlcServers.js";
import { createCase, subjectStats } from "../../lib/cases.js";
import { getModType } from "../../lib/modTypes.js";
import { fileBanRequest } from "../../lib/banRequests.js";
import { hasPermission } from "../../lib/permissions.js";
import { logCase } from "../../lib/caseLog.js";
import { headshotUrl } from "../../lib/roblox.js";
import { caseEmbed, err } from "../../lib/style.js";
import { sleep } from "../../lib/util.js";

export { erlcStaff, erlcAdmin, manageGuild } from "../../lib/checks.js";
export { SERVER_ARG } from "../erlc/_shared.js";

/** The resolved ER:LC server (honours `ctx.args.server`), or null. */
export const erlcServerOrNull = (ctx) => resolveServer(ctx.guild.id, ctx.args?.server).then((r) => r.server);

/** The resolved server's Server-Key, or null — for read paths where ER:LC is optional. */
export const erlcKeyOrNull = async (ctx) => (await erlcServerOrNull(ctx))?.api_key ?? null;

// requiresOnline: the in-game command only works if the player is in the server.
const REQUIRES_ONLINE = new Set(["kick", "jail", "unjail"]);
const SENDS_PM = new Set(["warn", "kick", "ban", "jail", "unjail"]);
const PROPAGATES = new Set(["ban", "unban"]); // may run on every server when erlcBanAllServers is on
const BOLO_TYPES = new Set(["kick", "ban"]); // `--bolo` also files a ban request for these

/** Optional flag for /kick and /ban — also file a ban request for senior staff. */
export const BOLO_ARG = { name: "bolo", type: "bool", required: false, description: "Also file a ban request for senior staff to review" };

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
  const { server, matched } = await resolveServer(ctx.guild.id, ctx.args?.server);
  const key = server?.api_key ?? null;

  if (ctx.config.reasonRequired && !reason)
    return ctx.reply({ content: err("This server requires a reason for moderation actions."), ephemeral: true });

  if (ingame && !key)
    return ctx.reply({
      content: err(
        matched
          ? "ER:LC isn't connected for this server yet, so I can't run that in-game — an admin can add one with `/erlcserver add`. (`warn`, `note` and `bolo` work without it.)"
          : `No ER:LC server called \`${ctx.args.server}\`. Use \`/erlcserver list\` to see them.`,
      ),
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
    erlcServerId: server?.id ?? null,
  });

  let notified = null;
  if (key && SENDS_PM.has(type) && target.online) {
    notified = await pm(key, target.name, notifyText(type, { reason, moderatorTag: modTag, caseNumber: c.case_number }));
    if (ingame) await sleep(5200); // 1 command / 5s API limit
  }

  let executed = true;
  let propagated = 0;
  const cmd = ingame?.(target);
  if (cmd) {
    // ban/unban optionally propagate to every connected server; everything else hits `server` only.
    const targets =
      PROPAGATES.has(type) && ctx.config.erlcBanAllServers ? await getServers(ctx.guild.id) : [server];
    for (const s of targets.filter(Boolean)) {
      try {
        await erlc.command(s.api_key, cmd);
        propagated++;
        if (targets.length > 1) await sleep(5200);
      } catch (e) {
        if (!(e instanceof ErlcError)) throw e;
      }
    }
    executed = propagated > 0;
  }

  // --bolo → also file a ban request for the same player
  let boloNote = null;
  if (ctx.args?.bolo && BOLO_TYPES.has(type)) {
    if (!(await hasPermission(ctx, "mod.banreq"))) {
      boloNote = "bolo skipped — you can't file ban requests";
    } else {
      const r = await fileBanRequest({
        guild: ctx.guild,
        client: ctx.client,
        robloxId: target.id,
        robloxName: target.name,
        reason,
        requestedBy: ctx.author.id,
        sourceCase: c.case_number,
      }).catch(() => ({ skipped: "error" }));
      boloNote =
        r.req ? `ban request #${r.req.id} filed`
        : r.skipped === "pending" ? "a ban request is already pending"
        : "bolo skipped — no ban-request or modlog channel set";
    }
  }

  const headshot = await headshotUrl(target.id).catch(() => null);
  const history = await statSummary(ctx.guild.id, target.id);
  const notes = [];
  if (!target.online) notes.push("player offline");
  if (notified === false) notes.push("in-game PM failed");
  if (cmd && !executed) notes.push("in-game command failed — case still logged");
  if (cmd && propagated > 1) notes.push(`applied on ${propagated} servers`);
  if (boloNote) notes.push(boloNote);

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
  const log = await logCase(ctx.guild, c, make(notes)).catch(() => ({ ok: false, reason: "error" }));
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

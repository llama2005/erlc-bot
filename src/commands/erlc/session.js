import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolveChannel } from "../../lib/modlog.js";
import { okEmbed } from "../../lib/style.js";
import { getTemplate, renderPayload } from "../../lib/templates.js";
import { erlcStaff, erlcKeyFor, SERVER_ARG } from "./_shared.js";

const HINT = {
  startup: "Session starting — welcome! Read the rules and stay in character.",
  shutdown: "Session over — thanks for playing. Server will be quiet until the next SSU.",
};

async function announce(ctx, kind) {
  const cfg = ctx.config;
  const dest = (await resolveChannel(ctx.client, cfg.sessionChannel, ctx.guild.id)) ?? ctx.channel;
  const key = await erlcKeyFor(ctx);

  // gather placeholder values
  let server = null;
  if (key) server = await erlc.server(key).catch(() => null);
  const vars = {
    message: ctx.args.message?.trim() || "",
    server: server?.Name || "the server",
    joinkey: server?.JoinKey || "—",
    players: server ? `${server.CurrentPlayers}/${server.MaxPlayers}` : "—",
    staff: `<@${ctx.author.id}>`,
    staffname: ctx.author.tag ?? ctx.author.username,
  };

  const tpl = await getTemplate(ctx.guild.id, kind === "startup" ? "ssu" : "ssd");
  const payload = renderPayload(tpl, vars);
  if (!payload.embeds.length && !payload.content) payload.content = vars.message || tpl.name;

  const content = [cfg.sessionPingRole ? `<@&${cfg.sessionPingRole}>` : "", payload.content].filter(Boolean).join(" ") || undefined;
  await dest.send({ ...payload, content, allowedMentions: { roles: cfg.sessionPingRole ? [cfg.sessionPingRole] : [] } });

  let hinted = false;
  if (key) {
    try {
      await erlc.command(key, `:h ${HINT[kind]}`);
      hinted = true;
    } catch (e) {
      if (!(e instanceof ErlcError)) throw e;
    }
  }

  await ctx.reply({
    embeds: [okEmbed(`**${tpl.name}** announced in <#${dest.id}>.${hinted ? "\nIn-game hint sent." : ""}`)],
    ephemeral: true,
  });
}

export default {
  name: "session",
  description: "ER:LC session announcements (SSU / SSD).",
  module: "erlc",
  guildOnly: true,
  aliases: ["ssu"],
  permission: "session",
  defaultSubcommand: "startup",
  subcommands: {
    startup: {
      description: "Announce a session start-up (SSU).",
      defer: true,
      ephemeral: true,
      aliases: ["ssu", "start"],
      args: [{ name: "message", type: "text", required: false, description: "Custom announcement text" }, SERVER_ARG],
      execute: (ctx) => announce(ctx, "startup"),
    },
    shutdown: {
      description: "Announce a session shutdown (SSD).",
      defer: true,
      ephemeral: true,
      aliases: ["ssd", "end"],
      args: [{ name: "message", type: "text", required: false, description: "Custom announcement text" }, SERVER_ARG],
      execute: (ctx) => announce(ctx, "shutdown"),
    },
  },
};

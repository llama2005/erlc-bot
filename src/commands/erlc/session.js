import { EmbedBuilder } from "discord.js";
import { erlc, ErlcError } from "../../lib/erlc.js";
import { resolveChannel } from "../../lib/modlog.js";
import { COLORS, EMOJI, ok, err } from "../../lib/style.js";
import { erlcStaff, erlcKey } from "./_shared.js";

const PRESETS = {
  startup: {
    title: "Session Start-Up",
    color: COLORS.success,
    emoji: EMOJI.online,
    blurb: "A roleplay session is starting — join now!",
    hint: "Session starting — welcome! Read the rules and stay in character.",
  },
  shutdown: {
    title: "Session Shutdown",
    color: COLORS.danger,
    emoji: EMOJI.offline,
    blurb: "The session has ended. Thanks for playing!",
    hint: "Session over — thanks for playing. Server will be quiet until the next SSU.",
  },
};

async function announce(ctx, kind) {
  const p = PRESETS[kind];
  const cfg = ctx.config;
  const dest = (await resolveChannel(ctx.client, cfg.sessionChannel)) ?? ctx.channel;

  const embed = new EmbedBuilder()
    .setColor(p.color)
    .setTitle(`${p.emoji} ${p.title}`)
    .setDescription(ctx.args.message?.trim() || p.blurb)
    .setFooter({ text: `by ${ctx.author.tag ?? ctx.author.username}` })
    .setTimestamp();

  const content = cfg.sessionPingRole ? `<@&${cfg.sessionPingRole}>` : undefined;
  await dest.send({ content, embeds: [embed], allowedMentions: { roles: cfg.sessionPingRole ? [cfg.sessionPingRole] : [] } });

  // best-effort in-game hint
  let hinted = false;
  const key = erlcKey(ctx);
  if (key) {
    try {
      await erlc.command(key, `:h ${p.hint}`);
      hinted = true;
    } catch (e) {
      if (!(e instanceof ErlcError)) throw e;
    }
  }

  await ctx.reply({
    content: ok(`${p.title} announced in <#${dest.id}>.${hinted ? " In-game hint sent." : ""}`),
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
      args: [{ name: "message", type: "text", required: false, description: "Custom announcement text" }],
      execute: (ctx) => announce(ctx, "startup"),
    },
    shutdown: {
      description: "Announce a session shutdown (SSD).",
      defer: true,
      ephemeral: true,
      aliases: ["ssd", "end"],
      args: [{ name: "message", type: "text", required: false, description: "Custom announcement text" }],
      execute: (ctx) => announce(ctx, "shutdown"),
    },
  },
};

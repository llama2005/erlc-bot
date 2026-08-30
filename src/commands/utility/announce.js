import { EmbedBuilder } from "discord.js";
import { COLORS, ok, err } from "../../lib/style.js";

export default {
  name: "announce",
  description: "Post an embed announcement to a channel.",
  module: "utility",
  guildOnly: true,
  defer: true,
  ephemeral: true,
  userPermissions: ["ManageMessages"],
  botPermissions: ["EmbedLinks"],
  args: [
    { name: "channel", type: "channel", required: true, description: "Where to post" },
    { name: "message", type: "text", required: true, description: "Body (supports markdown, use \\n for new lines)" },
    { name: "title", type: "string", required: false, description: "Optional title" },
    { name: "ping", type: "role", required: false, description: "Role to ping" },
  ],
  async execute(ctx) {
    const ch = ctx.args.channel;
    if (!ch?.isTextBased?.()) return ctx.reply({ content: err("Pick a text channel."), ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setDescription(ctx.args.message.replace(/\\n/g, "\n").slice(0, 4000))
      .setFooter({ text: `Announced by ${ctx.author.tag ?? ctx.author.username}` })
      .setTimestamp();
    if (ctx.args.title) embed.setTitle(ctx.args.title.slice(0, 256));

    await ch.send({
      content: ctx.args.ping ? `<@&${ctx.args.ping.id}>` : undefined,
      embeds: [embed],
      allowedMentions: { roles: ctx.args.ping ? [ctx.args.ping.id] : [] },
    });
    await ctx.reply(ok(`Posted to <#${ch.id}>.`));
  },
};

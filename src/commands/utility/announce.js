import { ok, err } from "../../lib/style.js";
import { getTemplate, renderPayload } from "../../lib/templates.js";
import { resolveChannel } from "../../lib/modlog.js";

export default {
  name: "announce",
  description: "Post an announcement using the server's Announcement template.",
  module: "utility",
  guildOnly: true,
  defer: true,
  ephemeral: true,
  userPermissions: ["ManageMessages"],
  botPermissions: ["EmbedLinks"],
  args: [
    { name: "message", type: "text", required: true, description: "Body (fills {message} in the template)" },
    { name: "channel", type: "channel", required: false, description: "Where to post (default: the announcement channel)" },
    { name: "ping", type: "role", required: false, description: "Role to ping" },
  ],
  async execute(ctx) {
    const ch = ctx.args.channel ?? (await resolveChannel(ctx.client, ctx.config.announceChannel)) ?? ctx.channel;
    if (!ch?.isTextBased?.()) return ctx.reply({ content: err("Pick a text channel, or set an announcement channel with `/config announce-channel`."), ephemeral: true });

    const tpl = await getTemplate(ctx.guild.id, "announcement");
    const payload = renderPayload(tpl, {
      message: ctx.args.message.replace(/\\n/g, "\n"),
      staff: `<@${ctx.author.id}>`,
      staffname: ctx.author.tag ?? ctx.author.username,
      date: `<t:${Math.floor(Date.now() / 1000)}:D>`,
    });
    if (!payload.embeds.length && !payload.content) payload.content = ctx.args.message;

    const content = [ctx.args.ping ? `<@&${ctx.args.ping.id}>` : "", payload.content].filter(Boolean).join(" ") || undefined;
    await ch.send({ ...payload, content, allowedMentions: { roles: ctx.args.ping ? [ctx.args.ping.id] : [] } });
    await ctx.reply(ok(`Posted to <#${ch.id}>${tpl.custom ? " using your custom template" : ""}.`));
  },
};

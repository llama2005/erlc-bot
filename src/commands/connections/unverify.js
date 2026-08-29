import { getLinkByDiscord, removeLink } from "../../lib/links.js";
import { manageGuild } from "../../lib/checks.js";

export default {
  name: "unverify",
  description: "Remove your Roblox link (or someone else's, with Manage Server).",
  module: "connections",
  aliases: ["unlink"],
  defer: true,
  ephemeral: true,
  ratelimit: { scope: "user", uses: 5, per: 30_000 },
  args: [{ name: "user", type: "user", required: false, description: "Whose link to remove (Manage Server only)" }],
  async execute(ctx) {
    const targetId = ctx.args.user?.id ?? ctx.author.id;

    if (targetId !== ctx.author.id) {
      const gate = manageGuild(ctx);
      if (gate !== true) return ctx.reply({ content: gate, ephemeral: true });
    }

    const link = await getLinkByDiscord(targetId);
    if (!link) return ctx.reply({ content: `${targetId === ctx.author.id ? "You have" : `<@${targetId}> has`} no Roblox link.`, ephemeral: true });

    await removeLink(targetId);
    await ctx.reply({ content: `Unlinked ${targetId === ctx.author.id ? "you" : `<@${targetId}>`} from **${link.roblox_name}**.`, ephemeral: true });
  },
};

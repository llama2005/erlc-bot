import { EmbedBuilder } from "discord.js";
import { userByUsername, userById } from "../../lib/roblox.js";
import { setLink, getLinkByDiscord, startVerification, getPending, clearPending } from "../../lib/links.js";
import { okEmbed } from "../../lib/style.js";

export default {
  name: "verify",
  description: "Link your Roblox account. Run with a username to start, then run it again to confirm.",
  module: "connections",
  aliases: ["link"],
  defer: true,
  ephemeral: true,
  ratelimit: { scope: "user", uses: 5, per: 30_000 },
  args: [{ name: "roblox", type: "string", required: false, description: "Your Roblox username (omit to confirm a pending link)" }],
  async execute(ctx) {
    const existing = await getLinkByDiscord(ctx.author.id);

    // Step 1: start
    if (ctx.args.roblox) {
      const hit = await userByUsername(ctx.args.roblox);
      if (!hit) return ctx.reply({ content: `No Roblox user called \`${ctx.args.roblox}\`.`, ephemeral: true });
      const code = startVerification(ctx.author.id, String(hit.id), hit.name);
      const embed = new EmbedBuilder()
        .setColor(0x00a2ff)
        .setTitle(`Verify as ${hit.name}`)
        .setDescription(
          [
            `1. Open your Roblox profile → **Edit** → **About / Description**.`,
            `2. Add this phrase anywhere in it:`,
            `\`\`\`\n${code}\n\`\`\``,
            `3. Save, then run **/verify** again (no username) to confirm.`,
            existing ? `\n_This will replace your current link to **${existing.roblox_name}**._` : "",
          ].join("\n"),
        )
        .setFooter({ text: "Expires in 15 minutes" });
      return ctx.reply({ embeds: [embed], ephemeral: true });
    }

    // Step 2: confirm
    const pending = getPending(ctx.author.id);
    if (!pending)
      return ctx.reply({
        content: existing
          ? `You're linked to **${existing.roblox_name}**. Run \`/verify <username>\` to relink.`
          : "Start with `/verify <your roblox username>`.",
        ephemeral: true,
      });

    const profile = await userById(pending.robloxId).catch(() => null);
    if (!profile) return ctx.reply({ content: "Couldn't read that Roblox profile — try again.", ephemeral: true });

    if (!(profile.description || "").toLowerCase().includes(pending.code.toLowerCase()))
      return ctx.reply({
        content: `Didn't find the phrase in **${pending.robloxName}**'s description yet. Add it, save, and run \`/verify\` again.\n\`${pending.code}\``,
        ephemeral: true,
      });

    clearPending(ctx.author.id);
    await setLink(ctx.author.id, pending.robloxId, pending.robloxName);
    await ctx.reply({
      embeds: [
        okEmbed(
          `You're now linked to **${pending.robloxName}** (\`${pending.robloxId}\`).\nThis works in every server with the bot — you can remove the phrase from your profile now.`,
          "Roblox account linked",
        ),
      ],
      ephemeral: true,
    });
  },
};

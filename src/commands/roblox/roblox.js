import { EmbedBuilder, time } from "discord.js";
import { lookup, headshotUrl, PRESENCE_TYPES } from "../../lib/roblox.js";

const EMBED = 0x00a2ff;

export default {
  name: "roblox",
  description: "Roblox user lookups.",
  module: "roblox",
  aliases: ["rblx"],
  subcommands: {
    lookup: {
      description: "Look up a Roblox user by username or ID.",
      defer: true,
      aliases: ["user"],
      ratelimit: { scope: "user", uses: 5, per: 15_000 },
      args: [{ name: "user", type: "string", required: true, description: "Username or numeric ID" }],
      async execute(ctx) {
        const u = await lookup(ctx.args.user);
        if (!u) return ctx.reply({ content: `No Roblox user matching \`${ctx.args.user}\`.`, ephemeral: true });

        const created = u.created ? Math.floor(new Date(u.created).getTime() / 1000) : null;
        const presenceLabel =
          u.presence?.userPresenceType != null ? PRESENCE_TYPES[u.presence.userPresenceType] ?? "Unknown" : "Unknown";

        const embed = new EmbedBuilder()
          .setColor(u.isBanned ? 0xe74c3c : EMBED)
          .setTitle(`${u.displayName} (@${u.name})${u.hasVerifiedBadge ? " ☑️" : ""}`)
          .setURL(u.profileUrl)
          .setThumbnail(u.headshot)
          .addFields(
            { name: "User ID", value: `\`${u.id}\``, inline: true },
            { name: "Created", value: created ? time(created, "D") : "—", inline: true },
            { name: "Status", value: u.isBanned ? "🔨 Banned" : presenceLabel, inline: true },
            { name: "Friends", value: fmt(u.friends), inline: true },
            { name: "Followers", value: fmt(u.followers), inline: true },
            { name: "Following", value: fmt(u.following), inline: true },
          );

        if (u.description) embed.addFields({ name: "Description", value: u.description.slice(0, 1024) });

        if (u.groups.length) {
          const top = [...u.groups]
            .sort((a, b) => (b.role?.rank ?? 0) - (a.role?.rank ?? 0))
            .slice(0, 5)
            .map((g) => `• **${g.group.name}** — ${g.role.name}`)
            .join("\n");
          embed.addFields({ name: `Groups (${u.groups.length})`, value: top });
        }

        await ctx.reply({ embeds: [embed] });
      },
    },

    avatar: {
      description: "Show a Roblox user's avatar headshot.",
      defer: true,
      ratelimit: { scope: "user", uses: 5, per: 15_000 },
      args: [{ name: "user", type: "string", required: true, description: "Username or numeric ID" }],
      async execute(ctx) {
        const u = await lookup(ctx.args.user);
        if (!u) return ctx.reply({ content: `No Roblox user matching \`${ctx.args.user}\`.`, ephemeral: true });
        const img = u.headshot ?? (await headshotUrl(u.id));
        if (!img) return ctx.reply({ content: "Couldn't fetch that avatar.", ephemeral: true });
        await ctx.reply({
          embeds: [new EmbedBuilder().setColor(EMBED).setTitle(`${u.displayName} (@${u.name})`).setURL(u.profileUrl).setImage(img)],
        });
      },
    },
  },
};

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

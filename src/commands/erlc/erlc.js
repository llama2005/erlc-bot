import { EmbedBuilder, time } from "discord.js";
import { erlc, splitPlayer, ErlcError } from "../../lib/erlc.js";
import { usersByIds, headshotUrl } from "../../lib/roblox.js";
import { getLinkByRoblox } from "../../lib/links.js";
import { getPublicIp } from "../../lib/publicIp.js";
import { erlcKey, erlcStaff, manageGuild } from "./_shared.js";

const EMBED = 0x2b6cb0;

const PERM_RANK = { "Server Owner": 5, "Server Co-Owner": 4, "Server Administrator": 3, "Server Moderator": 2, "Server Mod": 2 };
const PERM_FLAG = {
  "Server Owner": "👑",
  "Server Co-Owner": "🔑",
  "Server Administrator": "🛡️",
  "Server Moderator": "🚔",
  "Server Mod": "🚔",
};
const rankOf = (perm) => PERM_RANK[perm] ?? (perm && perm !== "Normal" ? 1 : 0);
const permFlag = (perm) => PERM_FLAG[perm] ?? "•";

function requireKey(ctx) {
  const key = erlcKey(ctx);
  if (!key) throw new ErlcError("ER:LC isn't connected for this server yet — an admin can add a Server-Key with `/config erlc-key` or on the dashboard.");
  return key;
}

function playerLink({ name, id }) {
  return id ? `[${name}](https://www.roblox.com/users/${id}/profile)` : name;
}

export default {
  name: "erlc",
  description: "Emergency Response: Liberty County private-server integration.",
  module: "erlc",
  guildOnly: true,
  aliases: ["prc"],
  permission: "erlc.read",
  subcommands: {
    status: {
      description: "Show ER:LC server status.",
      defer: true,
      ratelimit: { scope: "guild", uses: 4, per: 10_000 },
      async execute(ctx) {
        const key = requireKey(ctx);
        const [s, players, queue] = await Promise.all([
          erlc.server(key),
          erlc.players(key).catch(() => []),
          erlc.queue(key).catch(() => []),
        ]);
        const embed = new EmbedBuilder()
          .setColor(EMBED)
          .setTitle(s.Name || "ER:LC Server")
          .addFields(
            { name: "Players", value: `${s.CurrentPlayers}/${s.MaxPlayers}`, inline: true },
            { name: "Queue", value: `${Array.isArray(queue) ? queue.length : 0}`, inline: true },
            { name: "Join key", value: `\`${s.JoinKey}\``, inline: true },
            { name: "Owner", value: `[${s.OwnerId}](https://www.roblox.com/users/${s.OwnerId}/profile)`, inline: true },
            { name: "Verified req.", value: String(s.AccVerifiedReq ?? "—"), inline: true },
            { name: "Team balance", value: s.TeamBalance ? "on" : "off", inline: true },
          );
        if (Array.isArray(s.CoOwnerIds) && s.CoOwnerIds.length)
          embed.addFields({ name: "Co-owners", value: s.CoOwnerIds.join(", ") });
        if (Array.isArray(players) && players.length) {
          const staff = players.filter((p) => p.Permission && p.Permission !== "Normal");
          embed.addFields({ name: "Staff online", value: `${staff.length}`, inline: true });
        }
        await ctx.reply({ embeds: [embed] });
      },
    },

    players: {
      description: "List players currently in the server, grouped by team.",
      defer: true,
      ratelimit: { scope: "guild", uses: 4, per: 10_000 },
      async execute(ctx) {
        const list = await erlc.players(requireKey(ctx));
        if (!Array.isArray(list) || !list.length) return ctx.reply("Nobody is in the server right now.");

        const byTeam = new Map();
        for (const p of list) {
          const t = p.Team || "Unknown";
          if (!byTeam.has(t)) byTeam.set(t, []);
          byTeam.get(t).push(p);
        }

        const embed = new EmbedBuilder().setColor(EMBED).setTitle(`Players — ${list.length}`);
        for (const [team, members] of [...byTeam].sort((a, b) => b[1].length - a[1].length)) {
          members.sort((a, b) => rankOf(b.Permission) - rankOf(a.Permission) || splitPlayer(a.Player).name.localeCompare(splitPlayer(b.Player).name));
          const value = members
            .map((p) => {
              const who = splitPlayer(p.Player);
              return `${permFlag(p.Permission)} ${playerLink(who)}${p.Callsign ? ` \`[${p.Callsign}]\`` : ""}`;
            })
            .join("\n")
            .slice(0, 1024);
          embed.addFields({ name: `${team} — ${members.length}`, value });
        }
        await ctx.reply({ embeds: [embed] });
      },
    },

    player: {
      description: "Detailed info on a player currently in the server.",
      defer: true,
      args: [{ name: "player", type: "string", required: true, description: "In-game name", autocomplete: "erlcPlayers" }],
      async execute(ctx) {
        const key = requireKey(ctx);
        const [list, vehicles] = await Promise.all([erlc.players(key), erlc.vehicles(key).catch(() => [])]);
        const q = ctx.args.player.toLowerCase();
        const p = (Array.isArray(list) ? list : []).find((x) => splitPlayer(x.Player).name.toLowerCase().includes(q));
        if (!p) return ctx.reply({ content: `**${ctx.args.player}** isn't in the server right now.`, ephemeral: true });

        const who = splitPlayer(p.Player);
        const link = await getLinkByRoblox(who.id);
        const veh = (Array.isArray(vehicles) ? vehicles : []).find((v) => v.Owner && who.name.toLowerCase().startsWith(v.Owner.toLowerCase()));

        const embed = new EmbedBuilder()
          .setColor(EMBED)
          .setTitle(`${permFlag(p.Permission)} ${who.name}`)
          .setURL(`https://www.roblox.com/users/${who.id}/profile`)
          .setThumbnail(await headshotUrl(who.id).catch(() => null))
          .addFields(
            { name: "Roblox ID", value: `\`${who.id}\``, inline: true },
            { name: "Team", value: p.Team || "—", inline: true },
            { name: "Permission", value: p.Permission || "Normal", inline: true },
          );
        if (p.Callsign) embed.addFields({ name: "Callsign", value: `\`${p.Callsign}\``, inline: true });
        if (link) embed.addFields({ name: "Discord", value: `<@${link.discord_id}>`, inline: true });
        if (veh) embed.addFields({ name: "Vehicle", value: `${veh.Name}${veh.Texture ? ` _(${veh.Texture})_` : ""}` });
        await ctx.reply({ embeds: [embed] });
      },
    },

    staff: {
      description: "Show staff currently in the server.",
      defer: true,
      async execute(ctx) {
        const list = await erlc.players(requireKey(ctx));
        const staff = (Array.isArray(list) ? list : []).filter((p) => p.Permission && p.Permission !== "Normal");
        if (!staff.length) return ctx.reply("No staff are in the server right now.");
        const lines = staff.map((p) => `• ${playerLink(splitPlayer(p.Player))} — ${p.Permission}`);
        await ctx.reply({
          embeds: [new EmbedBuilder().setColor(EMBED).setTitle(`Staff online — ${staff.length}`).setDescription(lines.join("\n"))],
        });
      },
    },

    queue: {
      description: "Show players waiting in the join queue.",
      defer: true,
      async execute(ctx) {
        const ids = await erlc.queue(requireKey(ctx));
        if (!Array.isArray(ids) || !ids.length) return ctx.reply("The queue is empty.");
        const names = await usersByIds(ids);
        const lines = ids.map((id, i) => {
          const u = names.get(String(id));
          return `${i + 1}. ${playerLink({ name: u?.name ?? String(id), id })}`;
        });
        await ctx.reply({
          embeds: [new EmbedBuilder().setColor(EMBED).setTitle(`Queue — ${ids.length}`).setDescription(lines.join("\n").slice(0, 4000))],
        });
      },
    },

    joinlogs: {
      description: "Recent joins and leaves.",
      defer: true,
      async execute(ctx) {
        const logs = await erlc.joinLogs(requireKey(ctx));
        if (!Array.isArray(logs) || !logs.length) return ctx.reply("No join logs.");
        const lines = logs
          .sort((a, b) => b.Timestamp - a.Timestamp)
          .slice(0, 20)
          .map((l) => `${l.Join ? "🟢 join" : "🔴 leave"} ${playerLink(splitPlayer(l.Player))} · ${time(l.Timestamp, "R")}`);
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(EMBED).setTitle("Join logs").setDescription(lines.join("\n"))] });
      },
    },

    killlogs: {
      description: "Recent kill logs.",
      defer: true,
      async execute(ctx) {
        const logs = await erlc.killLogs(requireKey(ctx));
        if (!Array.isArray(logs) || !logs.length) return ctx.reply("No kill logs.");
        const lines = logs
          .sort((a, b) => b.Timestamp - a.Timestamp)
          .slice(0, 20)
          .map((l) => `${playerLink(splitPlayer(l.Killer))} → ${playerLink(splitPlayer(l.Killed))} · ${time(l.Timestamp, "R")}`);
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(EMBED).setTitle("Kill logs").setDescription(lines.join("\n"))] });
      },
    },

    commandlogs: {
      description: "Recent in-game commands run by staff.",
      defer: true,
      async execute(ctx) {
        const logs = await erlc.commandLogs(requireKey(ctx));
        if (!Array.isArray(logs) || !logs.length) return ctx.reply("No command logs.");
        const lines = logs
          .sort((a, b) => b.Timestamp - a.Timestamp)
          .slice(0, 20)
          .map((l) => `${playerLink(splitPlayer(l.Player))}: \`${l.Command}\` · ${time(l.Timestamp, "R")}`);
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(EMBED).setTitle("Command logs").setDescription(lines.join("\n").slice(0, 4000))] });
      },
    },

    modcalls: {
      description: "Recent moderator calls.",
      defer: true,
      async execute(ctx) {
        const logs = await erlc.modCalls(requireKey(ctx));
        if (!Array.isArray(logs) || !logs.length) return ctx.reply("No mod calls.");
        const lines = logs
          .sort((a, b) => b.Timestamp - a.Timestamp)
          .slice(0, 20)
          .map((l) => {
            const caller = playerLink(splitPlayer(l.Caller));
            const mod = l.Moderator ? playerLink(splitPlayer(l.Moderator)) : "_unanswered_";
            return `${caller} → ${mod} · ${time(l.Timestamp, "R")}`;
          });
        await ctx.reply({ embeds: [new EmbedBuilder().setColor(EMBED).setTitle("Mod calls").setDescription(lines.join("\n"))] });
      },
    },

    bans: {
      description: "List players banned from the server.",
      defer: true,
      async execute(ctx) {
        const bans = await erlc.bans(requireKey(ctx));
        const entries = Array.isArray(bans) ? [] : Object.entries(bans || {});
        if (!entries.length) return ctx.reply("No bans.");
        const lines = entries.slice(0, 40).map(([id, name]) => `• ${playerLink({ name, id })} (\`${id}\`)`);
        const embed = new EmbedBuilder()
          .setColor(EMBED)
          .setTitle(`Bans — ${entries.length}`)
          .setDescription(lines.join("\n").slice(0, 4000));
        if (entries.length > 40) embed.setFooter({ text: `Showing 40 of ${entries.length}` });
        await ctx.reply({ embeds: [embed] });
      },
    },

    vehicles: {
      description: "List spawned vehicles.",
      defer: true,
      async execute(ctx) {
        const list = await erlc.vehicles(requireKey(ctx));
        if (!Array.isArray(list) || !list.length) return ctx.reply("No vehicles spawned.");
        const lines = list.slice(0, 40).map((v) => `• **${v.Name}** — ${v.Owner}${v.Texture ? ` _(${v.Texture})_` : ""}`);
        await ctx.reply({
          embeds: [new EmbedBuilder().setColor(EMBED).setTitle(`Vehicles — ${list.length}`).setDescription(lines.join("\n").slice(0, 4000))],
        });
      },
    },

    pm: {
      description: "Send a private message to a player in-game (:pm).",
      permission: "erlc.message",
      defer: true,
      args: [
        { name: "player", type: "string", required: true, description: "In-game player name", autocomplete: "erlcPlayers" },
        { name: "message", type: "text", required: true, description: "Message to send" },
      ],
      ratelimit: { scope: "guild", uses: 1, per: 5000 },
      async execute(ctx) {
        await erlc.command(requireKey(ctx), `:pm ${ctx.args.player} ${ctx.args.message}`);
        await ctx.reply(`Sent PM to **${ctx.args.player}**.`);
      },
    },

    hint: {
      description: "Broadcast a hint to everyone in-game (:hint).",
      permission: "erlc.message",
      defer: true,
      args: [{ name: "message", type: "text", required: true, description: "Hint text" }],
      ratelimit: { scope: "guild", uses: 1, per: 5000 },
      async execute(ctx) {
        await erlc.command(requireKey(ctx), `:hint ${ctx.args.message}`);
        await ctx.reply("Hint sent.");
      },
    },

    message: {
      description: "Broadcast a message to everyone in-game (:m).",
      permission: "erlc.message",
      defer: true,
      args: [{ name: "message", type: "text", required: true, description: "Message text" }],
      ratelimit: { scope: "guild", uses: 1, per: 5000 },
      async execute(ctx) {
        await erlc.command(requireKey(ctx), `:m ${ctx.args.message}`);
        await ctx.reply("Message sent.");
      },
    },

    ip: {
      description: "Show the bot's public IP (for the api.erlc.gg command allowlist).",
      defer: true,
      ephemeral: true,
      permission: "config",
      async execute(ctx) {
        const ip = await getPublicIp();
        await ctx.reply({
          content: ip
            ? `This bot's current public IP: \`${ip}\`\nAllowlist it at <https://api.erlc.gg/server-owners> to run in-game commands. Note: on a home connection this can change — re-check with \`/erlc ip\` if commands start failing with code 4000.`
            : "Couldn't determine the public IP right now.",
          ephemeral: true,
        });
      },
    },

    command: {
      description: "Run a raw in-game command (Manage Server only).",
      defer: true,
      permission: "erlc.command",
      args: [{ name: "command", type: "text", required: true, description: "e.g. :kill noah, :weather rain" }],
      ratelimit: { scope: "guild", uses: 1, per: 5000 },
      async execute(ctx) {
        let cmd = ctx.args.command.trim();
        if (!cmd.startsWith(":")) cmd = `:${cmd}`;
        await erlc.command(requireKey(ctx), cmd);
        await ctx.reply(`Ran \`${cmd}\` in-game.`);
      },
    },
  },
};

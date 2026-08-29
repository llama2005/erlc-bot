import { EmbedBuilder, time } from "discord.js";
import { erlcStaff } from "../../lib/checks.js";
import { config } from "../../config.js";
import { erlc, splitPlayer } from "../../lib/erlc.js";
import { listActiveShifts } from "../../lib/shifts.js";

export default {
  name: "staff",
  description: "Staff overview — roles, who's on duty, and staff in-game.",
  module: "staff",
  guildOnly: true,
  defer: true,
  aliases: ["team"],
  permission: "erlc.read",
  ratelimit: { scope: "guild", uses: 4, per: 10_000 },
  async execute(ctx) {
    const cfg = ctx.config;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`Staff · ${ctx.guild.name}`)
      .addFields(
        { name: "Staff role", value: cfg.erlcStaffRole ? `<@&${cfg.erlcStaffRole}>` : "not set", inline: true },
        { name: "Admin role", value: cfg.erlcAdminRole ? `<@&${cfg.erlcAdminRole}>` : "not set", inline: true },
        { name: "On-duty role", value: cfg.shiftRole ? `<@&${cfg.shiftRole}>` : "not set", inline: true },
      );

    const onDuty = await listActiveShifts(ctx.guild.id);
    embed.addFields({
      name: `On duty — ${onDuty.length}`,
      value: onDuty.length
        ? onDuty.map((r) => `• <@${r.user_id}> · since ${time(Math.floor(r.started_at / 1000), "R")}`).join("\n").slice(0, 1024)
        : "nobody",
    });

    const key = cfg.erlcKey || config.erlc.devKey;
    if (key) {
      try {
        const players = await erlc.players(key);
        const inGame = (Array.isArray(players) ? players : []).filter((p) => p.Permission && p.Permission !== "Normal");
        embed.addFields({
          name: `Staff in-game — ${inGame.length}`,
          value: inGame.length
            ? inGame.map((p) => `• ${splitPlayer(p.Player).name} — ${p.Permission}`).join("\n").slice(0, 1024)
            : "none",
        });
      } catch {
        embed.addFields({ name: "Staff in-game", value: "_(ER:LC unavailable)_" });
      }
    }

    await ctx.reply({ embeds: [embed] });
  },
};

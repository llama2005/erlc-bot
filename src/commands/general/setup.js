import { EmbedBuilder } from "discord.js";
import { config } from "../../config.js";
import { getServers } from "../../lib/erlcServers.js";
import { COLORS } from "../../lib/style.js";

const line = (ok, label, fix) => `${ok ? "✅" : "⚠️"} **${label}** — ${ok ? "set" : fix}`;

export default {
  name: "setup",
  description: "Show what's configured and what still needs setting up.",
  module: "general",
  guildOnly: true,
  ephemeral: true,
  aliases: ["config-status", "checklist"],
  permission: "config",
  async execute(ctx) {
    const c = ctx.config;
    const dash = (config.links.dashboard || "").replace(/\/$/, "");
    const serverCount = (await getServers(ctx.guild.id)).length;

    const essentials = [
      line(serverCount > 0, "ER:LC server", "connect one with `/erlcserver add <key>` (or on the dashboard) to enable every ER:LC feature"),
      line(!!c.modlogChannel, "Moderation log channel", "`/config modlog #channel` — where cases are posted"),
      line(
        !!(c.erlcStaffRole || c.erlcAdminRole),
        "Staff roles",
        "`/config erlc-role @role` / `/config erlc-admin-role @role` — otherwise only members with **Manage Server** can use staff commands",
      ),
    ];

    const optional = [
      line(!!c.banreqChannel, "Ban-request channel", "`/config banreq #channel`"),
      line(!!c.appealChannel, "Appeal channel", "`/config appeal-channel #channel`"),
      line(!!c.loaChannel, "LOA channel", "`/config loa-channel #channel`"),
      line(!!c.statusChannel, "Server up/down alerts", "`/config status-channel #channel`"),
      line(
        !!(c.joinLogChannel || c.killLogChannel || c.ingameLogChannel || c.modcallLogChannel),
        "ER:LC live logs",
        "`/config join-log` · `kill-log` · `ingame-log` · `modcall-log`",
      ),
      line(!!c.sessionChannel, "Session (SSU/SSD) channel", "`/config session-channel #channel`"),
      line(!!c.shiftLogChannel, "Shift log channel", "`/config shift-log #channel` — clock-in/out + shift-admin actions"),
      line(
        !!(c.weeklyCaseQuota || c.weeklyShiftQuota) && !!c.quotaChannel,
        "Weekly staff quota report",
        "`/config quota-channel #channel` + `/config case-quota` / `shift-quota`",
      ),
    ];

    const done = [...essentials, ...optional].filter((l) => l.startsWith("✅")).length;
    const total = essentials.length + optional.length;

    const embed = new EmbedBuilder()
      .setColor(essentials.every((l) => l.startsWith("✅")) ? COLORS.success : COLORS.warn)
      .setTitle(`Setup · ${ctx.guild.name}`)
      .setDescription(`${done}/${total} configured. ⚠️ items still need attention.`)
      .addFields(
        { name: "Essentials", value: essentials.join("\n") },
        { name: "Optional", value: optional.join("\n") },
        {
          name: "Other",
          value: [
            `In-game auto-log: **${c.ingameAutolog ? "on" : "off"}** (\`/config ingame-autolog\`)`,
            `In-game clock in/out (\`:pm <name> clockin\`): **${c.ingameShiftCommands ? "on" : "off"}** (\`/config ingame-shifts\`)`,
            `External Discord mod-log: **${c.logExternalModeration ? "on" : "off"}** (\`/config external-log\`)${
              c.logExternalModeration && !ctx.guild.members.me?.permissions.has("ViewAuditLog")
                ? " — ⚠️ grant the bot **View Audit Log**"
                : ""
            }`,
            `Reason required: **${c.reasonRequired ? "on" : "off"}** (\`/config reason-required\`)`,
            `Void mode: **${c.hardVoid ? "hard-delete" : "keep greyed record"}** (\`/config hard-void\`)`,
            `Disabled modules: ${c.disabledModules.length ? c.disabledModules.join(", ") : "none"}`,
            `Prefix: \`${c.prefix}\``,
          ].join("\n"),
        },
      );
    if (dash) embed.addFields({ name: "Full settings", value: `Manage everything on the dashboard: ${dash}` });

    await ctx.reply({ embeds: [embed], ephemeral: true });
  },
};

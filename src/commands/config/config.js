import { EmbedBuilder } from "discord.js";
import { setGuildConfig } from "../../lib/guildConfig.js";
import { menuView } from "../../lib/settingsMenu.js";

/** setting name -> { field, kind, label } */
const SETTINGS = {
  prefix: { field: "prefix", kind: "prefix", label: "Prefix" },
  ai: { field: "aiEnabled", kind: "bool", label: "AI" },
  "reason-required": { field: "reasonRequired", kind: "bool", label: "Require reason" },
  modlog: { field: "modlogChannel", kind: "channel", label: "Modlog channel" },
  cmdlog: { field: "commandLogChannel", kind: "channel", label: "Bot command log" },
  banreq: { field: "banreqChannel", kind: "channel", label: "Ban-request channel" },
  "join-log": { field: "joinLogChannel", kind: "channel", label: "Join/leave log" },
  "kill-log": { field: "killLogChannel", kind: "channel", label: "Kill log" },
  "ingame-log": { field: "ingameLogChannel", kind: "channel", label: "In-game command log" },
  "modcall-log": { field: "modcallLogChannel", kind: "channel", label: "Mod-call log" },
  "session-channel": { field: "sessionChannel", kind: "channel", label: "Session channel" },
  "staff-alert": { field: "staffAlertChannel", kind: "channel", label: "Staff-alert channel" },
  "loa-channel": { field: "loaChannel", kind: "channel", label: "LOA channel" },
  "appeal-channel": { field: "appealChannel", kind: "channel", label: "Appeal channel" },
  "status-channel": { field: "statusChannel", kind: "channel", label: "Server status channel" },
  "announce-channel": { field: "announceChannel", kind: "channel", label: "Announcement channel" },
  "quota-channel": { field: "quotaChannel", kind: "channel", label: "Weekly quota report channel" },
  "ticket-category": { field: "ticketCategory", kind: "channel", label: "Ticket category" },
  "erlc-key": { field: "erlcKey", kind: "secret", label: "ER:LC API key" },
  "erlc-role": { field: "erlcStaffRole", kind: "role", label: "ER:LC staff role" },
  "erlc-admin-role": { field: "erlcAdminRole", kind: "role", label: "ER:LC admin role" },
  "shift-role": { field: "shiftRole", kind: "role", label: "On-duty role" },
  "session-role": { field: "sessionPingRole", kind: "role", label: "Session ping role" },
  "ticket-role": { field: "ticketStaffRole", kind: "role", label: "Ticket staff role" },
  "ingame-autolog": { field: "ingameAutolog", kind: "bool", label: "In-game auto-log" },
  "warn-trigger": { field: "ingameWarnTrigger", kind: "word", label: "In-game warn trigger word" },
  "case-quota": { field: "weeklyCaseQuota", kind: "int", label: "Weekly case quota" },
  "shift-quota": { field: "weeklyShiftQuota", kind: "duration", label: "Weekly shift-time quota" },
};
export const CONFIG_SETTING_NAMES = ["view", ...Object.keys(SETTINGS), "disable", "enable"];
const NAMES = CONFIG_SETTING_NAMES;
const CLEARWORDS = ["none", "off", "clear", "remove"];

function toggleInList(list, value, on) {
  const set = new Set(list);
  on ? set.add(value) : set.delete(value);
  return [...set];
}

export default {
  name: "config",
  description: "View or change this server's bot settings.",
  module: "config",
  guildOnly: true,
  ephemeral: true,
  aliases: ["settings", "cfg"],
  permission: "config",
  redactArgs: ["value"],
  args: [
    { name: "setting", type: "string", required: false, description: "What to configure", autocomplete: "configSettings" },
    { name: "value", type: "text", required: false, description: "New value / target (or 'none' to clear)" },
  ],
  async execute(ctx) {
    const cfg = ctx.config;
    const setting = ctx.args.setting?.toLowerCase();
    const value = ctx.args.value?.trim();
    const reply = (content) => ctx.reply({ content, ephemeral: true });

    // No setting on a slash command → open the interactive menu.
    if (!setting && ctx.isInteraction) {
      return ctx.reply({ ...menuView(ctx.guild), ephemeral: true });
    }

    if (!setting || setting === "view") {
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`Config · ${ctx.guild.name}`)
        .addFields(
          { name: "Prefix", value: `\`${cfg.prefix}\``, inline: true },
          { name: "AI", value: cfg.aiEnabled ? "enabled" : "disabled", inline: true },
          { name: "ER:LC key", value: cfg.erlcKey ? "set ✅" : "not set", inline: true },
          { name: "Modlog", value: cfg.modlogChannel ? `<#${cfg.modlogChannel}>` : "none", inline: true },
          { name: "Command log", value: cfg.commandLogChannel ? `<#${cfg.commandLogChannel}>` : "none", inline: true },
          { name: "Ban requests", value: cfg.banreqChannel ? `<#${cfg.banreqChannel}>` : "none", inline: true },
          { name: "Staff role", value: cfg.erlcStaffRole ? `<@&${cfg.erlcStaffRole}>` : "none", inline: true },
          { name: "Admin role", value: cfg.erlcAdminRole ? `<@&${cfg.erlcAdminRole}>` : "none", inline: true },
          { name: "On-duty role", value: cfg.shiftRole ? `<@&${cfg.shiftRole}>` : "none", inline: true },
          { name: "Disabled commands", value: cfg.disabledCommands.join(", ") || "none" },
          { name: "Disabled modules", value: cfg.disabledModules.join(", ") || "none" },
        )
        .setFooter({ text: `${cfg.prefix}config <${NAMES.join(" | ")}>` });
      return ctx.reply({ embeds: [embed], ephemeral: true });
    }

    if (setting === "disable" || setting === "enable") {
      if (!value) return reply(`Usage: \`config ${setting} <command | module:name>\``);
      const on = setting === "disable";
      const manager = ctx.client.manager;
      if (value.startsWith("module:")) {
        const mod = value.slice(7).toLowerCase();
        if (mod === "config") return reply("The `config` module can't be disabled.");
        const known = new Set([...manager.commands.values()].map((c) => c.module));
        if (!known.has(mod)) return reply(`No module \`${mod}\`. Known: ${[...known].join(", ")}`);
        await setGuildConfig(ctx.guild.id, { disabledModules: toggleInList(cfg.disabledModules, mod, on) });
        return reply(`Module \`${mod}\` ${on ? "disabled" : "enabled"}.`);
      }
      const cmd = manager.resolve(value.toLowerCase());
      if (!cmd) return reply(`No command \`${value}\`.`);
      if (cmd.module === "config") return reply("`config` commands can't be disabled.");
      await setGuildConfig(ctx.guild.id, { disabledCommands: toggleInList(cfg.disabledCommands, cmd.name, on) });
      return reply(`Command \`${cmd.name}\` ${on ? "disabled" : "enabled"}.`);
    }

    const spec = SETTINGS[setting];
    if (!spec) return reply(`Unknown setting. Options: ${NAMES.join(", ")}`);

    // For channel/role settings, no value is ambiguous — send them to the picker menu.
    if (!value && (spec.kind === "channel" || spec.kind === "role")) {
      if (ctx.isInteraction) return ctx.reply({ ...menuView(ctx.guild), ephemeral: true });
      return reply(`Run \`/config\` (no options) for a channel/role picker, or pass an ID: \`config ${setting} <id>\` — or \`none\` to clear.`);
    }

    const clearing = !value || CLEARWORDS.includes(value.toLowerCase());

    switch (spec.kind) {
      case "prefix": {
        if (clearing) return reply("Give a prefix of 1-5 characters.");
        if (value.length > 5) return reply("Prefix must be 1-5 characters.");
        await setGuildConfig(ctx.guild.id, { prefix: value });
        return reply(`Prefix set to \`${value}\`.`);
      }
      case "bool": {
        const on = ["on", "enable", "enabled", "true", "yes"].includes(value?.toLowerCase());
        const off = CLEARWORDS.includes(value?.toLowerCase()) || ["false", "no", "disable", "disabled"].includes(value?.toLowerCase());
        if (!on && !off) return reply(`Use \`config ${setting} on\` or \`config ${setting} off\`.`);
        await setGuildConfig(ctx.guild.id, { [spec.field]: on });
        return reply(`${spec.label} **${on ? "enabled" : "disabled"}**.`);
      }
      case "secret": {
        if (!ctx.isInteraction) await ctx.source.delete().catch(() => {});
        if (clearing) {
          await setGuildConfig(ctx.guild.id, { [spec.field]: null });
          return reply(`${spec.label} cleared.`);
        }
        await setGuildConfig(ctx.guild.id, { [spec.field]: value });
        return reply(`${spec.label} saved${ctx.isInteraction ? "." : " (your message was deleted)."}`);
      }
      case "role": {
        if (clearing) {
          await setGuildConfig(ctx.guild.id, { [spec.field]: null });
          return reply(`${spec.label} cleared.`);
        }
        const id = value.match(/\d{15,25}/)?.[0];
        const role = id && ctx.guild.roles.cache.get(id);
        if (!role) return reply("Give a role (mention or ID), or `none`.");
        await setGuildConfig(ctx.guild.id, { [spec.field]: role.id });
        return reply(`${spec.label} set to <@&${role.id}>.`);
      }
      case "channel": {
        if (clearing) {
          await setGuildConfig(ctx.guild.id, { [spec.field]: null });
          return reply(`${spec.label} cleared.`);
        }
        const id = value.match(/\d{15,25}/)?.[0];
        const channel = id && ctx.guild.channels.cache.get(id);
        if (!channel || !channel.isTextBased?.() || channel.isDMBased?.())
          return reply("Give a text channel in this server (mention or ID), or `none`.");
        // ticket-category expects a category channel (type 4)
        if (spec.field === "ticketCategory" && channel.type !== 4)
          return reply("Give a **category** channel for `ticket-category`.");
        await setGuildConfig(ctx.guild.id, { [spec.field]: channel.id });
        return reply(`${spec.label} set to <#${channel.id}>.`);
      }
      case "word": {
        if (clearing) {
          await setGuildConfig(ctx.guild.id, { [spec.field]: SETTINGS[setting]?.field === "ingameWarnTrigger" ? "warn" : null });
          return reply(`${spec.label} reset.`);
        }
        const w = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!w) return reply("Give a single word.");
        await setGuildConfig(ctx.guild.id, { [spec.field]: w });
        return reply(`${spec.label} set to \`${w}\`.`);
      }
      case "int": {
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n) || n < 0) return reply("Give a whole number (0 to disable).");
        await setGuildConfig(ctx.guild.id, { [spec.field]: n });
        return reply(`${spec.label} set to **${n}**${n === 0 ? " (disabled)" : ""}.`);
      }
      case "duration": {
        const { parseDuration, formatDuration } = await import("../../lib/util.js");
        if (clearing || value === "0") {
          await setGuildConfig(ctx.guild.id, { [spec.field]: 0 });
          return reply(`${spec.label} disabled.`);
        }
        const ms = parseDuration(value);
        if (!ms) return reply("Give a duration like `3h` or `90m` (or `0` to disable).");
        await setGuildConfig(ctx.guild.id, { [spec.field]: ms });
        return reply(`${spec.label} set to \`${formatDuration(ms)}\`.`);
      }
      default:
        return reply("Unhandled setting.");
    }
  },
};

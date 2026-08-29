import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js";
import { getGuildConfig, setGuildConfig } from "./guildConfig.js";
import { registerComponent } from "./components.js";

// Editable settings surfaced in the interactive menu (prefix + erlc-key stay text-only).
const FIELDS = {
  aiEnabled: { kind: "bool", label: "AI feature", desc: "Enable the /ai command + @mention replies" },
  reasonRequired: { kind: "bool", label: "Require reason", desc: "Force a reason on every moderation action" },
  // channels
  modlogChannel: { kind: "channel", label: "Modlog channel", desc: "Where moderation cases are posted" },
  commandLogChannel: { kind: "channel", label: "Bot command log", desc: "Logs every bot command that runs" },
  banreqChannel: { kind: "channel", label: "Ban-request channel", desc: "Where ban requests await approval" },
  joinLogChannel: { kind: "channel", label: "Join/leave log", desc: "Auto-posts ER:LC joins and leaves" },
  killLogChannel: { kind: "channel", label: "Kill log", desc: "Auto-posts ER:LC kill logs" },
  ingameLogChannel: { kind: "channel", label: "In-game command log", desc: "Auto-posts staff :commands run in-game" },
  modcallLogChannel: { kind: "channel", label: "Mod-call log", desc: "Auto-posts !mod calls and pings staff" },
  sessionChannel: { kind: "channel", label: "Session channel", desc: "Where /session SSU/SSD announcements go" },
  // roles
  erlcStaffRole: { kind: "role", label: "Staff role", desc: "Use ER:LC / moderation / shift / session commands" },
  erlcAdminRole: { kind: "role", label: "Admin role", desc: "Approve ban requests, shift admin, void others' cases" },
  shiftRole: { kind: "role", label: "On-duty role", desc: "Auto-assigned while clocked in" },
  sessionPingRole: { kind: "role", label: "Session ping role", desc: "Pinged on SSU/SSD announcements" },
  disabledModules: { kind: "modules", label: "Disabled modules", desc: "Turn whole command groups off" },
};

function canManage(interaction) {
  return !!interaction.memberPermissions?.has("ManageGuild");
}

function fieldValue(kind, v) {
  if (kind === "bool") return v ? "on" : "off";
  if (kind === "role") return v ? `<@&${v}>` : "—";
  if (kind === "channel") return v ? `<#${v}>` : "—";
  if (kind === "modules") return v.length ? v.join(", ") : "none";
  return String(v ?? "—");
}

function overviewEmbed(guild) {
  const c = getGuildConfig(guild.id);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`Settings · ${guild.name}`)
    .setDescription("Pick a setting below to change it. `prefix` and `erlc-key` are set with `/config`.")
    .addFields(
      { name: "Prefix", value: `\`${c.prefix}\``, inline: true },
      { name: "ER:LC key", value: c.erlcKey ? "set ✅" : "—", inline: true },
    );
  for (const [key, f] of Object.entries(FIELDS)) {
    if (f.kind === "modules") continue;
    embed.addFields({ name: f.label, value: fieldValue(f.kind, c[key]), inline: true });
  }
  embed.addFields({ name: "Disabled modules", value: fieldValue("modules", c.disabledModules) });
  return embed;
}

function rootSelect() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("cfg:pick")
    .setPlaceholder("Change a setting…")
    .addOptions(Object.entries(FIELDS).map(([value, f]) => ({ label: f.label, value, description: f.desc.slice(0, 100) })));
  return new ActionRowBuilder().addComponents(menu);
}

/** The default menu view: overview + root picker. */
export function menuView(guild) {
  return { embeds: [overviewEmbed(guild)], components: [rootSelect()] };
}

function backButton() {
  return new ButtonBuilder().setCustomId("cfg:back").setLabel("← Back").setStyle(ButtonStyle.Secondary);
}
function clearButton(field) {
  return new ButtonBuilder().setCustomId(`cfg:clear:${field}`).setLabel("Clear").setStyle(ButtonStyle.Danger);
}

function editorView(guild, field, client) {
  const f = FIELDS[field];
  const embed = overviewEmbed(guild).setFooter({ text: `Editing: ${f.label}` });
  const rows = [];

  if (f.kind === "role") {
    rows.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(`cfg:role:${field}`).setPlaceholder(`Pick the ${f.label.toLowerCase()}`).setMinValues(0).setMaxValues(1),
    ));
    rows.push(new ActionRowBuilder().addComponents(clearButton(field), backButton()));
  } else if (f.kind === "channel") {
    rows.push(new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`cfg:chan:${field}`)
        .setPlaceholder(`Pick the ${f.label.toLowerCase()}`)
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ));
    rows.push(new ActionRowBuilder().addComponents(clearButton(field), backButton()));
  } else if (f.kind === "bool") {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cfg:bool:${field}:on`).setLabel("Enable").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cfg:bool:${field}:off`).setLabel("Disable").setStyle(ButtonStyle.Danger),
      backButton(),
    ));
  } else if (f.kind === "modules") {
    const modules = [...new Set([...client.manager.commands.values()].map((c) => c.module))].filter((m) => m !== "config");
    const disabled = new Set(getGuildConfig(guild.id).disabledModules);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("cfg:modules")
        .setPlaceholder("Select modules to DISABLE")
        .setMinValues(0)
        .setMaxValues(Math.max(1, modules.length))
        .addOptions(
          (modules.length ? modules : ["general"]).map((m) => ({ label: m, value: m, default: disabled.has(m) })),
        ),
    ));
    rows.push(new ActionRowBuilder().addComponents(backButton()));
  }

  return { embeds: [embed], components: rows };
}

// --- component handlers ---
// Routing is driven purely by the customId (`cfg:<action>[:<field>[:<on|off>]]`),
// not by interaction.isXSelectMenu() guards.

async function guard(interaction) {
  if (canManage(interaction)) return true;
  const msg = { content: "You need **Manage Server** to change settings.", flags: 1 << 6 };
  await (interaction.deferred || interaction.replied ? interaction.followUp(msg) : interaction.reply(msg)).catch(() => {});
  return false;
}

registerComponent("cfg", async (interaction, parts, { client }) => {
  if (!(await guard(interaction))) return;
  const guild = interaction.guild;
  const [action, field, onoff] = parts;
  const set = async (patch) => {
    await setGuildConfig(guild.id, patch);
    return interaction.update(menuView(guild));
  };

  switch (action) {
    case "pick":
      return interaction.update(editorView(guild, interaction.values[0], client));
    case "back":
      return interaction.update(menuView(guild));
    case "clear":
      return set({ [field]: FIELDS[field]?.kind === "bool" ? false : null });
    case "bool":
      return set({ [field]: onoff === "on" });
    case "ai": // legacy customId
      return set({ aiEnabled: field === "on" });
    case "role":
      return set({ [field]: interaction.values?.[0] ?? null });
    case "chan":
      return set({ [field]: interaction.values?.[0] ?? null });
    case "modules":
      return set({ disabledModules: interaction.values ?? [] });
    default:
      return interaction.deferred || interaction.replied
        ? undefined
        : interaction.reply({ content: "Unknown control.", flags: 1 << 6 }).catch(() => {});
  }
});

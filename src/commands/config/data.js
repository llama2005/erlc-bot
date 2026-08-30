import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { many, GUILD_SCOPED_TABLES } from "../../lib/pg.js";
import { purgeGuildData } from "../../lib/botGuilds.js";
import { ensureGuildConfig, forgetGuildConfig } from "../../lib/guildConfig.js";
import { forgetPermGroups } from "../../lib/permissions.js";
import { registerComponent } from "../../lib/components.js";
import { ok, err } from "../../lib/style.js";

const ownerOnly = (ctx) => (ctx.isOwner ? true : "This command is restricted to the bot operators.");

/** Everything stored for one guild, keyed by table. `erlc_key` value is redacted. */
async function dumpGuild(guildId) {
  const out = {};
  for (const t of GUILD_SCOPED_TABLES) {
    const rows = await many(`SELECT * FROM ${t} WHERE guild_id=$1`, [guildId]).catch(() => []);
    if (t === "guild_config") for (const r of rows) if (r.erlc_key) r.erlc_key = "[redacted]";
    if (rows.length) out[t] = rows;
  }
  return out;
}

async function wipeGuild(guildId) {
  const rows = await purgeGuildData(guildId, { dropBotGuild: false });
  forgetGuildConfig(guildId);
  forgetPermGroups(guildId);
  await ensureGuildConfig(guildId); // re-materialise a clean default config row
  return rows;
}

registerComponent("data", async (interaction, [action, guildId]) => {
  if (action !== "del") return;
  if (!interaction.client.ownerIds?.includes(interaction.user.id))
    return interaction.reply({ content: "Not for you.", flags: 1 << 6 });
  if (interaction.guildId !== guildId)
    return interaction.reply({ content: "Guild mismatch.", flags: 1 << 6 });

  await interaction.update({ components: [] }).catch(() => {});
  const rows = await wipeGuild(guildId);
  await interaction.followUp({
    content: ok(`Wiped **${rows}** record(s) for this server. Config is reset to defaults; the bot still works.`),
    flags: 1 << 6,
  });
});

export default {
  name: "data",
  description: "Export or delete this server's stored data (operators only).",
  module: "config",
  guildOnly: true,
  ephemeral: true,
  check: ownerOnly,
  defaultSubcommand: "export",
  subcommands: {
    export: {
      description: "Download everything stored for this server as JSON.",
      defer: true,
      ephemeral: true,
      check: ownerOnly,
      async execute(ctx) {
        const dump = await dumpGuild(ctx.guild.id);
        const buf = Buffer.from(JSON.stringify({ guild_id: ctx.guild.id, exported_at: new Date().toISOString(), data: dump }, null, 2));
        const file = new AttachmentBuilder(buf, { name: `data-${ctx.guild.id}.json` });
        const tables = Object.keys(dump);
        await ctx.reply({
          content: tables.length ? `Data across ${tables.length} table(s): ${tables.join(", ")}.` : "No stored data for this server.",
          files: [file],
          ephemeral: true,
        });
      },
    },
    delete: {
      description: "Permanently delete ALL of this server's data.",
      ephemeral: true,
      check: ownerOnly,
      async execute(ctx) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`data:del:${ctx.guild.id}`)
            .setLabel("Delete everything")
            .setStyle(ButtonStyle.Danger),
        );
        await ctx.reply({
          content: err("This permanently deletes every case, shift, config value, and the ER:LC key for this server. Roblox verification links are unaffected. Confirm within 60s:"),
          components: [row],
          ephemeral: true,
        });
      },
    },
  },
};

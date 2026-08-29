import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { COLORS, ok, err } from "../../lib/style.js";
import { registerComponent } from "../../lib/components.js";
import { userByUsername, userById, headshotUrl } from "../../lib/roblox.js";
import { getLinkByDiscord, setLink, removeLink, startVerification, getPending, clearPending } from "../../lib/links.js";

async function view(userId) {
  const link = await getLinkByDiscord(userId);
  const embed = new EmbedBuilder().setColor(COLORS.primary).setTitle("Your connections");

  const row = new ActionRowBuilder();
  if (link) {
    embed
      .setThumbnail(await headshotUrl(link.roblox_id).catch(() => null))
      .setDescription(`**Roblox:** [${link.roblox_name}](https://www.roblox.com/users/${link.roblox_id}/profile) \`${link.roblox_id}\``);
    row.addComponents(
      new ButtonBuilder().setCustomId("conn:relink").setLabel("Re-link").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("conn:unlink").setLabel("Disconnect").setStyle(ButtonStyle.Danger),
    );
  } else {
    embed.setDescription("**Roblox:** not connected.");
    row.addComponents(new ButtonBuilder().setCustomId("conn:link").setLabel("Connect Roblox").setStyle(ButtonStyle.Success));
  }
  const pending = getPending(userId);
  if (pending) {
    embed.addFields({
      name: "Pending verification",
      value: `Add this to **${pending.robloxName}**'s Roblox profile description, then press **Verify**:\n\`${pending.code}\``,
    });
    row.addComponents(new ButtonBuilder().setCustomId("conn:verify").setLabel("Verify").setStyle(ButtonStyle.Primary));
  }
  return { embeds: [embed], components: [row] };
}

function linkModal() {
  return new ModalBuilder()
    .setCustomId("conn:linkmodal")
    .setTitle("Connect your Roblox account")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("username").setLabel("Roblox username").setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
}

registerComponent("conn", async (interaction, [action]) => {
  const uid = interaction.user.id;

  if (action === "link" || action === "relink") return interaction.showModal(linkModal());

  if (action === "linkmodal") {
    const username = interaction.fields.getTextInputValue("username").trim();
    const hit = await userByUsername(username);
    if (!hit) return interaction.reply({ content: err(`No Roblox user called \`${username}\`.`), flags: 1 << 6 });
    startVerification(uid, String(hit.id), hit.name);
    return interaction.reply({ ...(await view(uid)), flags: 1 << 6 });
  }

  if (action === "unlink") {
    await removeLink(uid);
    return interaction.update(await view(uid));
  }

  if (action === "verify") {
    const pending = getPending(uid);
    if (!pending) return interaction.reply({ content: err("No pending verification — press Connect first."), flags: 1 << 6 });
    const profile = await userById(pending.robloxId).catch(() => null);
    if (!(profile?.description || "").toLowerCase().includes(pending.code.toLowerCase()))
      return interaction.reply({ content: err(`Phrase not found in **${pending.robloxName}**'s description yet.\n\`${pending.code}\``), flags: 1 << 6 });
    clearPending(uid);
    await setLink(uid, pending.robloxId, pending.robloxName);
    return interaction.update(await view(uid));
  }
});

export default {
  name: "connections",
  description: "View and manage your account connections.",
  module: "connections",
  aliases: ["connect"],
  defer: false,
  async execute(ctx) {
    if (!ctx.isInteraction) return ctx.reply(ok("Use `/connections` for the interactive panel, or `/verify <username>`."));
    await ctx.reply({ ...(await view(ctx.author.id)), ephemeral: true });
  },
};

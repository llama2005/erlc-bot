import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from "discord.js";
import { registerComponent } from "../../lib/components.js";
import { COLORS, ok, err } from "../../lib/style.js";

// draft keyed by userId (one at a time per user)
const drafts = new Map();
const TTL = 15 * 60 * 1000;

const getDraft = (uid) => {
  const d = drafts.get(uid);
  if (d && d.expires > Date.now()) return d;
  drafts.delete(uid);
  return null;
};
const touch = (d) => ((d.expires = Date.now() + TTL), d);

function parseColor(v) {
  if (!v) return null;
  const s = v.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16);
  const named = { red: 0xed4245, green: 0x57f287, blue: 0x5865f2, yellow: 0xfee75c, orange: 0xe67e22, purple: 0x9b59b6, grey: 0x2b2d31, gray: 0x2b2d31, white: 0xffffff, black: 0x111111 };
  return named[s.toLowerCase()] ?? null;
}

function renderEmbed(d) {
  const e = new EmbedBuilder().setColor(d.color ?? COLORS.primary);
  if (d.title) e.setTitle(d.title.slice(0, 256));
  if (d.description) e.setDescription(d.description.slice(0, 4000));
  if (d.author) e.setAuthor({ name: d.author.slice(0, 256), iconURL: d.authorIcon || undefined });
  if (d.image) e.setImage(d.image);
  if (d.thumbnail) e.setThumbnail(d.thumbnail);
  if (d.footer) e.setFooter({ text: d.footer.slice(0, 2048) });
  for (const f of d.fields ?? []) e.addFields({ name: f.name.slice(0, 256), value: f.value.slice(0, 1024), inline: !!f.inline });
  if (!d.title && !d.description && !(d.fields ?? []).length && !d.image)
    e.setDescription("*Empty draft — use the buttons below to build it, then **Send**.*");
  return e;
}

function controls(d) {
  const b = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return [
    new ActionRowBuilder().addComponents(
      b("emb:title", "Title"),
      b("emb:desc", "Description"),
      b("emb:color", "Colour"),
      b("emb:media", "Image / Thumb"),
      b("emb:meta", "Author / Footer"),
    ),
    new ActionRowBuilder().addComponents(
      b("emb:field", "＋ Field"),
      b("emb:clearfields", "Clear fields"),
      b("emb:send", "Send", ButtonStyle.Success).setDisabled(!d.channelId),
      b("emb:cancel", "Cancel", ButtonStyle.Danger),
    ),
  ];
}

const view = (d) => ({
  content: d.channelId ? `Building an embed for <#${d.channelId}> — preview:` : "Building an embed — set a target channel with `/embed channel:`",
  embeds: [renderEmbed(d)],
  components: controls(d),
});

const input = (id, label, style, value, required = false, max) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value) t.setValue(String(value).slice(0, max || (style === TextInputStyle.Paragraph ? 4000 : 256)));
  if (max) t.setMaxLength(max);
  return new ActionRowBuilder().addComponents(t);
};

registerComponent("emb", async (interaction, parts) => {
  const uid = interaction.user.id;
  const d = getDraft(uid);
  if (!d) return interaction.reply({ content: err("This embed draft expired — run `/embed` again."), flags: 1 << 6 });

  // ---- modal submissions: customId is emb:m:<field> ----
  if (parts[0] === "m") {
    const field = parts[1];
    const f = interaction.fields;
    if (field === "title") d.title = f.getTextInputValue("title").trim() || null;
    else if (field === "desc") d.description = f.getTextInputValue("description").trim() || null;
    else if (field === "color") d.color = parseColor(f.getTextInputValue("color")) ?? d.color;
    else if (field === "media") {
      d.image = f.getTextInputValue("image").trim() || null;
      d.thumbnail = f.getTextInputValue("thumbnail").trim() || null;
    } else if (field === "meta") {
      d.author = f.getTextInputValue("author").trim() || null;
      d.authorIcon = f.getTextInputValue("authorIcon").trim() || null;
      d.footer = f.getTextInputValue("footer").trim() || null;
    } else if (field === "field") {
      (d.fields ??= []).push({
        name: f.getTextInputValue("name"),
        value: f.getTextInputValue("value"),
        inline: /^y/i.test(f.getTextInputValue("inline").trim()),
      });
      if (d.fields.length > 25) d.fields.length = 25;
    }
    touch(d);
    return interaction.update(view(d));
  }

  const action = parts[0];

  // buttons that open a modal
  const modals = {
    title: () =>
      new ModalBuilder().setCustomId("emb:m:title").setTitle("Title").addComponents(input("title", "Title", TextInputStyle.Short, d.title, false, 256)),
    desc: () =>
      new ModalBuilder()
        .setCustomId("emb:m:desc")
        .setTitle("Description")
        .addComponents(input("description", "Description (Markdown supported)", TextInputStyle.Paragraph, d.description)),
    color: () =>
      new ModalBuilder()
        .setCustomId("emb:m:color")
        .setTitle("Colour")
        .addComponents(input("color", "Hex (#5865f2) or a name (red, blue…)", TextInputStyle.Short, d.color ? `#${d.color.toString(16).padStart(6, "0")}` : "")),
    media: () =>
      new ModalBuilder()
        .setCustomId("emb:m:media")
        .setTitle("Image / Thumbnail")
        .addComponents(
          input("image", "Large image URL", TextInputStyle.Short, d.image),
          input("thumbnail", "Thumbnail URL", TextInputStyle.Short, d.thumbnail),
        ),
    meta: () =>
      new ModalBuilder()
        .setCustomId("emb:m:meta")
        .setTitle("Author & Footer")
        .addComponents(
          input("author", "Author text", TextInputStyle.Short, d.author),
          input("authorIcon", "Author icon URL", TextInputStyle.Short, d.authorIcon),
          input("footer", "Footer text", TextInputStyle.Short, d.footer),
        ),
    field: () =>
      new ModalBuilder()
        .setCustomId("emb:m:field")
        .setTitle("Add a field")
        .addComponents(
          input("name", "Field name", TextInputStyle.Short, "", true, 256),
          input("value", "Field value", TextInputStyle.Paragraph, "", true, 1024),
          input("inline", "Inline? (yes / no)", TextInputStyle.Short, "no"),
        ),
  };

  if (modals[action]) return interaction.showModal(modals[action]());

  if (action === "clearfields") {
    d.fields = [];
    touch(d);
    return interaction.update(view(d));
  }
  if (action === "cancel") {
    drafts.delete(uid);
    return interaction.update({ content: "Embed draft discarded.", embeds: [], components: [] });
  }
  if (action === "send") {
    const ch =
      interaction.guild.channels.cache.get(d.channelId) ??
      (await interaction.guild.channels.fetch(d.channelId).catch(() => null));
    if (!ch?.isTextBased?.()) return interaction.reply({ content: err("That channel is gone — run `/embed` again."), flags: 1 << 6 });
    await ch.send({ embeds: [renderEmbed(d)] });
    drafts.delete(uid);
    return interaction.update({ content: ok(`Embed sent to <#${ch.id}>.`), embeds: [], components: [] });
  }
});

export default {
  name: "embed",
  description: "Build and send a rich embed with a live preview.",
  module: "utility",
  guildOnly: true,
  ephemeral: true,
  defer: false,
  userPermissions: ["ManageGuild"],
  args: [
    { name: "channel", type: "channel", required: false, description: "Where to send it (default: here)" },
    { name: "from", type: "string", required: false, description: "Import an existing message link/ID to edit its embed" },
  ],
  async execute(ctx) {
    const channelId = ctx.args.channel?.id ?? ctx.channel.id;
    const d = touch({ channelId, fields: [], color: COLORS.primary });

    // optional: seed from an existing message's first embed
    if (ctx.args.from) {
      const id = ctx.args.from.match(/(\d{17,20})\/?(\d{17,20})?$/);
      const msgId = id?.[2] || id?.[1];
      if (msgId) {
        const msg = await ctx.channel.messages.fetch(msgId).catch(() => null);
        const e = msg?.embeds?.[0];
        if (e) {
          d.title = e.title;
          d.description = e.description;
          d.color = e.color ?? d.color;
          d.image = e.image?.url ?? null;
          d.thumbnail = e.thumbnail?.url ?? null;
          d.author = e.author?.name ?? null;
          d.footer = e.footer?.text ?? null;
          d.fields = (e.fields ?? []).map((x) => ({ name: x.name, value: x.value, inline: x.inline }));
        }
      }
    }

    drafts.set(ctx.author.id, d);
    await ctx.reply({ ...view(d), ephemeral: true });
  },
};

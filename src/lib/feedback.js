import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { registerComponent } from "./components.js";
import { captureFeedback, sentryEnabled } from "./sentry.js";

/** A "Report a problem" button tied to a Sentry error id — null when Sentry is off. */
export function feedbackButton(eventId) {
  if (!eventId || !sentryEnabled()) return null;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`feedback:${eventId}`).setLabel("Report a problem").setStyle(ButtonStyle.Secondary).setEmoji("🐛"),
  );
}

registerComponent("feedback", async (interaction, [eventId]) => {
  if (interaction.isButton()) {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`feedback:${eventId}`)
        .setTitle("Report a problem")
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("text")
              .setLabel("What were you doing? What happened?")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setMaxLength(1500),
          ),
        ),
    );
  }
  if (interaction.isModalSubmit()) {
    const text = interaction.fields.getTextInputValue("text").trim();
    captureFeedback(text, { user: interaction.user.id, tags: { errorId: eventId, guildId: interaction.guildId ?? "dm" } });
    return interaction.reply({ content: "Thanks — sent to the developers.", flags: 1 << 6 });
  }
});

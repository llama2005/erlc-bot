import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { registerComponent } from "./components.js";
import { isEnabled } from "./flags.js";
import { pendingActionFor, acknowledgeAction } from "./botActions.js";

/**
 * The action blocking this user, or null. Owners always pass. Honours the `ack-gate` flag.
 */
export async function gateCheck(userId, guildId, isOwner = false) {
  if (isOwner) return null;
  if (!isEnabled("ack-gate", { guildId })) return null;
  return pendingActionFor(userId, guildId);
}

/** Ephemeral reply payload telling a blocked user why + how to clear it. */
export function gateReply(action) {
  const timed = action.expires_at && Number(action.expires_at) > Date.now();
  const reason = action.reason ? `\n> ${action.reason}` : "";
  if (timed) {
    return {
      content: `🔒 You're locked out of the bot${action.is_global ? "" : " in this server"} until <t:${Math.floor(Number(action.expires_at) / 1000)}:f>.${reason}`,
      flags: MessageFlags.Ephemeral,
    };
  }
  return {
    content: `🔒 An action was taken against you and needs your acknowledgement before you can use the bot${action.is_global ? "" : " here"} again.${reason}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ack:${action.id}`).setLabel("Acknowledge").setStyle(ButtonStyle.Primary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  };
}

registerComponent("ack", async (interaction) => {
  const cleared = await acknowledgeAction(interaction.user.id, interaction.guildId);
  await interaction.reply({
    content: cleared
      ? "✅ Acknowledged — you can use the bot again."
      : "That lock is timed or no longer active; nothing to acknowledge.",
    flags: MessageFlags.Ephemeral,
  });
});

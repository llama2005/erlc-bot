// Keep the Discord side in sync when a review/case action is taken from the dashboard.
// The web process has no discord.js client, so everything here goes through the REST
// helpers in ./discord.js. All functions are best-effort and never throw.
import * as d from "./discord.js";
import { getCase, attachCaseMessage } from "../src/lib/cases.js";
import { renderCaseEmbed, caseButtons } from "../src/lib/caseLog.js";

const toBody = ({ embeds = [], components = [] }) => ({
  embeds: embeds.map((e) => (typeof e.toJSON === "function" ? e.toJSON() : e)),
  components: components.map((c) => (typeof c.toJSON === "function" ? c.toJSON() : c)),
});

/** Edit a stored review message (LOA / appeal / ban request) in place. No-op if we don't know it. */
export async function syncMessage(channelId, messageId, view) {
  if (!channelId || !messageId) return;
  try {
    await d.editChannelMessage(channelId, messageId, toBody(view));
  } catch (e) {
    console.warn("syncMessage failed:", e.message);
  }
}

/** REST twin of src/lib/caseLog.js#logCase — post a case to the guild's mod-log channel. */
export async function postCaseToModlog(guildId, cfg, caseRow) {
  if (!cfg?.modlogChannel || !Number.isInteger(Number(caseRow?.case_number))) return;
  try {
    const embed = await renderCaseEmbed({ id: guildId }, caseRow);
    const res = await d.postChannelMessage(cfg.modlogChannel, {
      ...toBody({ embeds: [embed], components: caseButtons(caseRow, { hard: !!cfg.hardVoid }) }),
    });
    if (!res.ok) return;
    const msg = await res.json();
    await attachCaseMessage(guildId, caseRow.case_number, cfg.modlogChannel, msg.id).catch(() => {});
  } catch (e) {
    console.warn("postCaseToModlog failed:", e.message);
  }
}

/** Re-render the stored mod-log message for a case after a dashboard reason/type/void edit. */
export async function refreshCaseModlog(guildId, cfg, caseNumber) {
  try {
    const c = await getCase(guildId, caseNumber);
    if (!c?.log_channel_id || !c?.log_message_id) return;
    const embed = await renderCaseEmbed({ id: guildId }, c);
    await d.editChannelMessage(
      c.log_channel_id,
      c.log_message_id,
      toBody({ embeds: [embed], components: caseButtons(c, { hard: !!cfg?.hardVoid }) }),
    );
  } catch (e) {
    console.warn("refreshCaseModlog failed:", e.message);
  }
}

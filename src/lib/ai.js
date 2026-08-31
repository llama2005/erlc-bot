import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

export const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT =
  "You are a helpful assistant in a Discord server. Keep replies concise and use Discord-flavored markdown. Answer directly without preambles like \"Sure!\".";

// channelId -> [{ role, content }, ...]
const histories = new Map();

function pushHistory(channelId, role, content) {
  const h = histories.get(channelId) ?? [];
  h.push({ role, content });
  while (h.length > config.ai.historyLimit) h.shift();
  histories.set(channelId, h);
}

export function clearHistory(channelId) {
  histories.delete(channelId);
}

/** Send a prompt to the AI model with per-channel rolling history. Returns the reply text. */
export async function askAI(channelId, prompt) {
  pushHistory(channelId, "user", prompt);

  const stream = anthropic.messages.stream({
    model: config.ai.model,
    max_tokens: config.ai.maxTokens,
    system: SYSTEM_PROMPT,
    output_config: { effort: config.ai.effort },
    messages: histories.get(channelId),
  });

  const final = await stream.finalMessage();
  const reply =
    final.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim() || "(no response)";

  pushHistory(channelId, "assistant", reply);
  return reply;
}

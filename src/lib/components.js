// Registry for message-component (button / select) interaction handlers.
// A component's customId is `${key}:${...parts}`; the handler for `key` is called
// with (interaction, parts, { client }).

const handlers = new Map();

export function registerComponent(key, handler) {
  handlers.set(key, handler);
}

export async function dispatchComponent(interaction, ctx) {
  const [key, ...parts] = interaction.customId.split(":");
  const handler = handlers.get(key);
  if (!handler) return false;
  await handler(interaction, parts, ctx);
  return true;
}

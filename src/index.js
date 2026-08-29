import { Client, Events, GatewayIntentBits, Partials, ActivityType } from "discord.js";
import { config, requireConfig } from "./config.js";
import { pool, initSchema } from "./lib/pg.js";
import { CommandManager } from "./lib/CommandManager.js";
import { getPublicIp } from "./lib/publicIp.js";
import { startErlcPoller } from "./lib/erlcPoller.js";
import { warmGuildConfigs, ensureGuildConfig, startConfigSync } from "./lib/guildConfig.js";
import { syncBotGuild, removeBotGuild, syncAllBotGuilds } from "./lib/botGuilds.js";

requireConfig("DISCORD_TOKEN", "ANTHROPIC_API_KEY", "DATABASE_URL");
await initSchema();
await warmGuildConfigs();
await startConfigSync().catch((e) => console.error("config sync setup failed:", e.message));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

client.ownerIds = config.ownerIds;
const manager = new CommandManager(client);
client.manager = manager;

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`In ${c.guilds.cache.size} server(s)`);
  c.user.setPresence({
    status: "online",
    activities: [{ name: `${config.defaultPrefix}help`, type: ActivityType.Listening }],
  });

  getPublicIp().then((ip) => ip && console.log(`Public IP: ${ip} (allowlist at https://api.erlc.gg/server-owners for in-game commands)`));

  await manager.load();
  const devGuild = config.devGuildId || (c.guilds.cache.size === 1 ? c.guilds.cache.firstKey() : "");
  await manager.registerSlashCommands(devGuild).catch((e) => console.error("Slash registration failed:", e));

  await syncAllBotGuilds(c).catch((e) => console.error("botGuilds sync failed:", e.message));
  startErlcPoller(c);
});

client.on(Events.GuildCreate, (guild) => {
  ensureGuildConfig(guild.id).catch(() => {});
  syncBotGuild(guild).catch(() => {});
});
client.on(Events.GuildDelete, (guild) => removeBotGuild(guild.id).catch(() => {}));

client.on(Events.MessageCreate, (message) => {
  manager.handleMessage(message).catch((e) => console.error("handleMessage error:", e));
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isAutocomplete()) {
    manager.handleAutocomplete(interaction).catch((e) => console.error("handleAutocomplete error:", e));
    return;
  }
  if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
    manager.handleComponent(interaction).catch((e) => console.error("handleComponent error:", e));
    return;
  }
  manager.handleInteraction(interaction).catch((e) => console.error("handleInteraction error:", e));
});

client.on(Events.Error, (e) => console.error("Client error:", e));
client.on(Events.ShardError, (e) => console.error("Shard error:", e));
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, async () => {
    console.log(`${sig} — shutting down`);
    client.destroy();
    await pool.end().catch(() => {});
    process.exit(0);
  });
}

client.login(config.discordToken);

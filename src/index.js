import { Client, Events, GatewayIntentBits, Partials, ActivityType, AuditLogEvent, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { config, requireConfig } from "./config.js";
import { pool, initSchema } from "./lib/pg.js";
import { CommandManager } from "./lib/CommandManager.js";
import { getPublicIp } from "./lib/publicIp.js";
import { startErlcPoller } from "./lib/erlcPoller.js";
import { startScheduler } from "./lib/scheduler.js";
import { warmGuildConfigs, ensureGuildConfig, startConfigSync, pruneGuildConfigCache } from "./lib/guildConfig.js";
import { startPermSync, prunePermCache } from "./lib/permissions.js";
import { prunePlayerCache } from "./lib/autocomplete.js";
import { syncBotGuild, removeBotGuild, syncAllBotGuilds } from "./lib/botGuilds.js";

requireConfig("DISCORD_TOKEN", "ANTHROPIC_API_KEY", "DATABASE_URL");
await initSchema();
await warmGuildConfigs();
await startConfigSync().catch((e) => console.error("config sync setup failed:", e.message));
await startPermSync().catch((e) => console.error("perm sync setup failed:", e.message));

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
  // Public bot → always register globally. DEV_GUILD_ID is a dev-instance-only fast path
  // (guild-scoped commands appear instantly; global takes ~1h to propagate).
  const devGuild = config.isDev ? config.devGuildId : "";
  await manager.registerSlashCommands(devGuild).catch((e) => console.error("Slash registration failed:", e));

  await syncAllBotGuilds(c).catch((e) => console.error("botGuilds sync failed:", e.message));
  startErlcPoller(c);
  startScheduler(c);

  // Evict in-memory per-guild caches for guilds the bot has left.
  const sweepCaches = () => {
    const active = [...c.guilds.cache.keys()];
    pruneGuildConfigCache(active);
    prunePermCache(active);
    prunePlayerCache(active);
  };
  setInterval(sweepCaches, 30 * 60_000).unref?.();
});

async function welcomeGuild(guild) {
  const dash = (config.links.dashboard || "").replace(/\/$/, "");
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Thanks for adding ${guild.client.user.username}!`)
    .setDescription(
      "ER:LC + Discord moderation, staff shifts, case logging, and more.\n\n" +
        "**Get started:** run `/setup` to see what needs configuring, then `/config erlc-key` to connect your ER:LC private server.",
    );
  const links = [
    dash && `[Dashboard](${dash})`,
    config.links.support && `[Support](${config.links.support})`,
    dash && `[Privacy](${dash}/privacy)`,
  ].filter(Boolean);
  if (links.length) embed.addFields({ name: "Links", value: links.join(" · ") });

  // Prefer the system channel, else the first text channel we can actually post in.
  const me = guild.members.me;
  const canPost = (ch) =>
    ch?.isTextBased?.() &&
    ch.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  const target =
    (canPost(guild.systemChannel) && guild.systemChannel) ||
    guild.channels.cache.filter((ch) => canPost(ch)).sort((a, b) => a.rawPosition - b.rawPosition).first();

  if (target) {
    await target.send({ embeds: [embed] }).catch(() => {});
    return;
  }
  // Nowhere to post — DM whoever added the bot.
  const log = await guild
    .fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 })
    .catch(() => null);
  const inviter = log?.entries.find((e) => e.target?.id === guild.client.user.id)?.executor;
  await inviter?.send({ embeds: [embed] }).catch(() => {});
}

client.on(Events.GuildCreate, (guild) => {
  ensureGuildConfig(guild.id).catch(() => {});
  syncBotGuild(guild).catch(() => {});
  welcomeGuild(guild).catch((e) => console.error("welcome:", e.message));
});
client.on(Events.GuildDelete, (guild) => {
  removeBotGuild(guild.id).catch(() => {});
  const active = [...client.guilds.cache.keys()];
  pruneGuildConfigCache(active);
  prunePermCache(active);
  prunePlayerCache(active);
});

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

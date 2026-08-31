import { fileURLToPath } from "node:url";
import path from "node:path";
import { ShardingManager } from "discord.js";
import { config } from "./config.js";
import { initSentry, captureError } from "./lib/sentry.js";

initSentry("shard-manager");

const here = path.dirname(fileURLToPath(import.meta.url));
const manager = new ShardingManager(path.join(here, "index.js"), {
  token: config.discordToken,
  totalShards: process.env.SHARD_COUNT ? Number(process.env.SHARD_COUNT) : "auto",
  respawn: true,
  mode: "process",
});

manager.on("shardCreate", (shard) => {
  console.log(`Spawned shard #${shard.id}`);
  shard.on("death", () => console.error(`Shard #${shard.id} died`));
  shard.on("error", (e) => {
    console.error(`Shard #${shard.id} error:`, e);
    captureError(e, { tags: { scope: "shard", shard: shard.id } });
  });
});

manager.spawn({ delay: 7500, timeout: 60_000 }).catch((e) => {
  console.error("Shard spawn failed:", e);
  captureError(e, { tags: { scope: "shard-spawn" } });
  process.exit(1);
});

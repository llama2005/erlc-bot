// Entrypoint: run under a ShardingManager when SHARDING=1, otherwise a single process
// (identical to running src/index.js directly).
if (process.env.SHARDING === "1") await import("./shard.js");
else await import("./index.js");

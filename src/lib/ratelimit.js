// Fixed-window rate limiter. Buckets keyed by scope + command + id.
const buckets = new Map();

/**
 * @param {{scope?: "user"|"guild"|"global", uses?: number, per?: number}} rule
 * @param {{commandName: string, userId: string, guildId?: string}} ctx
 * @returns {{limited: boolean, retryAfter: number}}
 */
export function checkRateLimit(rule, { commandName, userId, guildId }) {
  if (!rule || !rule.uses || !rule.per) return { limited: false, retryAfter: 0 };
  const scope = rule.scope || "user";
  const id = scope === "global" ? "global" : scope === "guild" ? guildId || "dm" : userId;
  const key = `${scope}:${commandName}:${id}`;

  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.reset) {
    bucket = { count: 0, reset: now + rule.per };
    buckets.set(key, bucket);
  }

  if (bucket.count >= rule.uses) {
    return { limited: true, retryAfter: bucket.reset - now };
  }
  bucket.count += 1;
  return { limited: false, retryAfter: 0 };
}

// Periodic cleanup of expired buckets.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now >= bucket.reset) buckets.delete(key);
}, 60_000).unref();

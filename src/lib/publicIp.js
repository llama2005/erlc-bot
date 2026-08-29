// Best-effort public IP discovery, cached and periodically refreshed. Used to help
// with the ER:LC command-endpoint IP allowlist (https://api.erlc.gg/server-owners).

const SOURCES = ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"];
const REFRESH_MS = 10 * 60 * 1000;

let current = null;
let fetchedAt = 0;

async function fetchOnce() {
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (/^[0-9a-f.:]+$/i.test(ip)) return ip;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Returns the cached public IP, refreshing if stale. Never throws. */
export async function getPublicIp() {
  if (current && Date.now() - fetchedAt < REFRESH_MS) return current;
  const ip = await fetchOnce();
  if (ip) {
    current = ip;
    fetchedAt = Date.now();
  }
  return current;
}

/** Synchronous last-known value (may be null before the first fetch). */
export const lastKnownIp = () => current;

import { config } from "../config.js";
import { sleep } from "./util.js";
import { lastKnownIp } from "./publicIp.js";

const BASE = "https://api.erlc.gg/v1";

// The command endpoint is limited to 1 request / 5s per Server-Key. We serialize
// calls per key and space them out instead of failing.
const COMMAND_COOLDOWN = 5000;
const MAX_QUEUED = 4;
const lastCommandAt = new Map();
const queues = new Map(); // key -> { chain: Promise, pending: number }

function enqueueCommand(key, fn) {
  const q = queues.get(key) || { chain: Promise.resolve(), pending: 0 };
  if (q.pending >= MAX_QUEUED) {
    throw new ErlcError("Too many ER:LC commands queued — try again in a few seconds.");
  }
  q.pending += 1;
  q.chain = q.chain
    .catch(() => {})
    .then(async () => {
      const wait = COMMAND_COOLDOWN - (Date.now() - (lastCommandAt.get(key) || 0));
      if (wait > 0) await sleep(wait);
      lastCommandAt.set(key, Date.now());
      return fn();
    })
    .finally(() => {
      q.pending -= 1;
    });
  queues.set(key, q);
  return q.chain;
}

export class ErlcError extends Error {
  constructor(message, { status, code, retryAfter } = {}) {
    super(message);
    this.name = "ErlcError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const CODE_MESSAGES = {
  1001: "Communication error reaching the ER:LC server — it may be offline or restarting.",
  1002: "ER:LC server-side error. Try again shortly.",
  2000: "No ER:LC Server-Key was provided.",
  2001: "Malformed ER:LC Server-Key.",
  2002: "Invalid ER:LC Server-Key — set a new one with `config erlc-key`.",
  2003: "Invalid global API key.",
  2004: "This ER:LC Server-Key has been banned from the API.",
  3001: "The command must be a non-empty string.",
  3002: "That resource can't be reached right now.",
  4000:
    "This bot's IP isn't allowlisted to run commands on this ER:LC server. " +
    "The server owner must add it at <https://api.erlc.gg/server-owners>.",
  4001: "Rate limited by the ER:LC API.",
  4002: "That in-game command is restricted.",
  4003: "That message/command was blocked by the ER:LC API.",
  9998: "The ER:LC API rejected the request (restricted resource).",
};

async function call(path, { key, method = "GET", body } = {}) {
  if (!key)
    throw new ErlcError("No ER:LC API key is set for this server. An admin can set one with `config erlc-key <key>`.");

  const headers = { "Server-Key": key };
  if (config.erlc.globalKey) headers.Authorization = config.erlc.globalKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new ErlcError(`Couldn't reach the ER:LC API (${err.message}).`);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After")) || data?.retry_after || 5;
    throw new ErlcError(`Rate limited by the ER:LC API — try again in ${Math.ceil(retryAfter)}s.`, {
      status: 429,
      retryAfter,
    });
  }

  if (!res.ok) {
    const code = data?.code;
    let message = CODE_MESSAGES[code] || data?.message || `ER:LC API error (HTTP ${res.status}).`;
    if (code === 4000) {
      const ip = lastKnownIp();
      if (ip) message += ` (this bot's current IP: \`${ip}\`)`;
    }
    throw new ErlcError(message, { status: res.status, code });
  }

  return data;
}

/** "cool_noah310110:2354532835" -> { name, id } */
export function splitPlayer(entry) {
  if (typeof entry !== "string") return { name: String(entry ?? "?"), id: null };
  const idx = entry.lastIndexOf(":");
  if (idx === -1) return { name: entry, id: null };
  return { name: entry.slice(0, idx), id: entry.slice(idx + 1) };
}

export const erlc = {
  server: (key) => call("/server", { key }),
  players: (key) => call("/server/players", { key }),
  queue: (key) => call("/server/queue", { key }),
  staff: (key) => call("/server/staff", { key }),
  joinLogs: (key) => call("/server/joinlogs", { key }),
  killLogs: (key) => call("/server/killlogs", { key }),
  commandLogs: (key) => call("/server/commandlogs", { key }),
  modCalls: (key) => call("/server/modcalls", { key }),
  bans: (key) => call("/server/bans", { key }),
  vehicles: (key) => call("/server/vehicles", { key }),

  /** Queue an in-game command; resolves once it has been sent (respects the 1/5s limit). */
  command(key, command) {
    const cmd = String(command || "").trim();
    if (!cmd) throw new ErlcError("The command must be a non-empty string.");
    return enqueueCommand(key, async () => {
      await call("/server/command", { key, method: "POST", body: { command: cmd } });
      return true;
    });
  },
};

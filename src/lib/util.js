/** Split text into <=`limit`-char chunks, preferring newline boundaries. */
export function chunkMessage(text, limit = 2000) {
  const chunks = [];
  let current = "";
  for (const line of String(text).split("\n")) {
    if (current.length + line.length + 1 > limit) {
      if (current) chunks.push(current);
      if (line.length > limit) {
        for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
        current = "";
      } else {
        current = line;
      }
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ["(empty)"];
}

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Parse "10m", "2h30m", "1d12h", "45s" → milliseconds. Returns null if unparseable. */
export function parseDuration(input) {
  if (input == null) return null;
  const str = String(input).trim().toLowerCase();
  if (/^\d+$/.test(str)) return Number(str) * 1000; // bare number = seconds
  const re = /(\d+(?:\.\d+)?)\s*(w|d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    total += parseFloat(m[1]) * UNITS[m[2]];
  }
  return matched ? total : null;
}

/** Human-readable duration from milliseconds. */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const parts = [];
  let s = Math.floor(ms / 1000);
  for (const [label, size] of [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]]) {
    if (s >= size) {
      parts.push(`${Math.floor(s / size)}${label}`);
      s %= size;
    }
  }
  return parts.join(" ");
}

/**
 * Verbose duration — "10 months, 3 weeks, 1 day, 21 hours, 36 minutes".
 * Months/weeks are approximate (30d / 7d), matching Whisp's shift readout.
 */
export function formatDurationLong(ms) {
  let s = Math.floor(Math.max(0, ms) / 1000);
  if (s === 0) return "0 seconds";
  const parts = [];
  for (const [label, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ]) {
    if (s >= size) {
      const n = Math.floor(s / size);
      parts.push(`${n} ${label}${n === 1 ? "" : "s"}`);
      s %= size;
    }
  }
  return parts.join(", ");
}

/** Tokenize a command string, respecting "double" and 'single' quotes. */
export function tokenize(str) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

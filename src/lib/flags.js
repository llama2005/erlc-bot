import crypto from "node:crypto";
import { many, query, notify, listen } from "./pg.js";

/**
 * Known flags. `default` is the answer when no DB row decides it:
 *  - `true`  = kill-switch for a shipped feature (per-guild config still gates it; a flag
 *              row set to `false` hard-disables it globally or for one guild/user)
 *  - `false` = new feature, off until a `global` row turns it on / rolls it out
 */
export const FLAGS = {
  "ingame-shifts": { description: "In-game :pm clockin / clockout", default: true },
  "external-log": { description: "Log Discord bans/kicks/timeouts done outside the bot", default: true },
  "bloxlink-fallback": { description: "Resolve accounts via Bloxlink when /verify has no link", default: true },
  "ack-gate": { description: "Lock users out of the bot until they acknowledge an action", default: true },
};

let rows = [];
const load = async () => {
  rows = await many("SELECT * FROM feature_flags");
};

const bucket = (s) => parseInt(crypto.createHash("md5").update(s).digest("hex").slice(0, 8), 16) % 100;
const find = (name, scope, target) => rows.find((r) => r.name === name && r.scope === scope && r.target === String(target ?? ""));

/** Is `name` enabled for this context? user override → guild override → global → flag default. */
export function isEnabled(name, { guildId, userId } = {}) {
  for (const [scope, target] of [
    ["user", userId],
    ["guild", guildId],
    ["global", ""],
  ]) {
    if (scope !== "global" && !target) continue;
    const r = find(name, scope, target);
    if (!r) continue;
    if (r.enabled != null) return r.enabled;
    if (r.rollout_pct > 0) return bucket(`${name}:${target || guildId || userId || ""}`) < r.rollout_pct;
  }
  return FLAGS[name]?.default ?? false;
}

export async function setFlag(name, scope, target = "", { enabled = null, rolloutPct = 0 } = {}) {
  await query(
    `INSERT INTO feature_flags (name, scope, target, enabled, rollout_pct, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (name, scope, target) DO UPDATE SET enabled=EXCLUDED.enabled, rollout_pct=EXCLUDED.rollout_pct, updated_at=EXCLUDED.updated_at`,
    [name, scope, String(target), enabled, rolloutPct, Date.now()],
  );
  await notify("feature_flags", name).catch(() => {});
  await load();
}

export async function clearFlag(name, scope, target = "") {
  await query("DELETE FROM feature_flags WHERE name=$1 AND scope=$2 AND target=$3", [name, scope, String(target)]);
  await notify("feature_flags", name).catch(() => {});
  await load();
}

export const listFlagRows = () => rows.slice();

export async function startFlagSync() {
  await load();
  await listen("feature_flags", () => load().catch(() => {}));
}

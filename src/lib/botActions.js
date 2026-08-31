import { one, many, query } from "./pg.js";

// Scout moderating its own users: an unacknowledged action locks the offender out of the
// bot (in that guild, or everywhere for a global action) until they press Acknowledge.
// A timed lock stays until it expires regardless.

const cache = new Map(); // `${userId}:${guildId}` -> { value, expires }
const TTL = 60_000;

/** The action currently blocking this user here, or null. */
export async function pendingActionFor(userId, guildId) {
  const k = `${userId}:${guildId || ""}`;
  const hit = cache.get(k);
  if (hit && hit.expires > Date.now()) return hit.value;
  const now = Date.now();
  const row = await one(
    `SELECT * FROM bot_actions
      WHERE target_id=$1 AND type='lock' AND acknowledged_at IS NULL
        AND (is_global OR guild_id=$2)
        AND (expires_at IS NULL OR expires_at > $3)
      ORDER BY created_at DESC LIMIT 1`,
    [String(userId), guildId || null, now],
  ).catch(() => null);
  cache.set(k, { value: row || null, expires: Date.now() + TTL });
  return row || null;
}

export function forgetAction(userId, guildId) {
  cache.delete(`${userId}:${guildId || ""}`);
  cache.delete(`${userId}:`);
}

export async function createAction({ guildId, targetId, type, reason, createdBy, expiresAt = null, isGlobal = false, proof = [] }) {
  const row = await one(
    `INSERT INTO bot_actions (guild_id, target_id, type, reason, created_by, created_at, expires_at, is_global)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [isGlobal ? null : guildId, String(targetId), type, reason || null, String(createdBy), Date.now(), expiresAt, isGlobal],
  );
  for (const url of proof.filter(Boolean)) await query("INSERT INTO bot_action_proof (action_id, url) VALUES ($1,$2)", [row.id, url]);
  forgetAction(targetId, guildId);
  return row;
}

/** Clear the newest active lock on a user (ack by the user, or an unlock by staff). */
export async function acknowledgeAction(userId, guildId, { byStaff = false } = {}) {
  const now = Date.now();
  const row = await one(
    `UPDATE bot_actions SET acknowledged_at=$1
      WHERE id = (
        SELECT id FROM bot_actions
         WHERE target_id=$2 AND type='lock' AND acknowledged_at IS NULL AND (is_global OR guild_id=$3)
           ${byStaff ? "" : "AND (expires_at IS NULL OR expires_at <= $4)"}
         ORDER BY created_at DESC LIMIT 1
      ) RETURNING *`,
    byStaff ? [now, String(userId), guildId || null] : [now, String(userId), guildId || null, now],
  ).catch(() => null);
  forgetAction(userId, guildId);
  return row;
}

export const listActions = (targetId, guildId) =>
  many(
    `SELECT * FROM bot_actions WHERE target_id=$1 AND (is_global OR guild_id=$2) ORDER BY created_at DESC LIMIT 15`,
    [String(targetId), guildId || null],
  );

export const proofFor = (actionId) => many("SELECT url FROM bot_action_proof WHERE action_id=$1", [actionId]);

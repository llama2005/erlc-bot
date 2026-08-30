import { many, one, query } from "./pg.js";

export const listAutohints = (guildId) => many("SELECT * FROM autohints WHERE guild_id=$1 ORDER BY id", [guildId]);

export const addAutohint = (guildId, message, intervalMs) =>
  one("INSERT INTO autohints (guild_id, message, interval_ms, next_at) VALUES ($1,$2,$3,$4) RETURNING *", [
    guildId,
    message,
    intervalMs,
    Date.now() + intervalMs,
  ]);

export const removeAutohint = async (guildId, id) =>
  (await query("DELETE FROM autohints WHERE guild_id=$1 AND id=$2", [guildId, id])).rowCount > 0;

export const toggleAutohint = async (guildId, id, enabled) =>
  (await query("UPDATE autohints SET enabled=$1 WHERE guild_id=$2 AND id=$3", [enabled, guildId, id])).rowCount > 0;

export const dueAutohints = () => many("SELECT * FROM autohints WHERE enabled=true AND next_at<=$1", [Date.now()]);
export const bumpAutohint = (id, intervalMs) =>
  query("UPDATE autohints SET next_at=$1 WHERE id=$2", [Date.now() + Number(intervalMs), id]);

import { many, one, query } from "./pg.js";

export const addReminder = ({ userId, channelId, guildId, text, dueAt }) =>
  one("INSERT INTO reminders (user_id, channel_id, guild_id, text, due_at, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [
    userId,
    channelId,
    guildId ?? null,
    text,
    dueAt,
    Date.now(),
  ]);

export const dueReminders = () => many("SELECT * FROM reminders WHERE due_at<=$1 ORDER BY due_at LIMIT 25", [Date.now()]);
export const deleteReminder = (id) => query("DELETE FROM reminders WHERE id=$1", [id]);
export const listReminders = (userId) => many("SELECT * FROM reminders WHERE user_id=$1 ORDER BY due_at", [userId]);

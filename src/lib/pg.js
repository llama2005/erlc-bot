import pg from "pg";
import { config } from "../config.js";

// epoch-ms BIGINTs come back as strings by default — parse to Number.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// Strip whitespace, surrounding quotes, and a pasted "DATABASE_URL=" prefix.
const rawUrl = (config.databaseUrl || "")
  .trim()
  .replace(/^["']|["']$/g, "")
  .replace(/^DATABASE_URL\s*=\s*/i, "");

if (rawUrl && !/^postgres(ql)?:\/\//i.test(rawUrl)) {
  throw new Error(
    `DATABASE_URL doesn't look like a Postgres connection string (got "${rawUrl.slice(0, 24)}…"). ` +
      `It must start with postgresql:// — copy the full string from Neon (Dashboard → Connect).`,
  );
}

// Strip sslmode/channel_binding query params — we set `ssl` explicitly below, and
// pg v8 prints a deprecation warning when it sees sslmode in the connection string.
const cleanUrl = rawUrl.replace(/([?&])(sslmode|channel_binding)=[^&]*/g, "$1").replace(/[?&]+$/, "");
const isLocal = /@(localhost|127\.0\.0\.1)/.test(rawUrl);

export const pool = new pg.Pool({
  connectionString: cleanUrl,
  ssl: isLocal || !rawUrl ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
});

pool.on("error", (err) => console.error("pg pool error:", err.message));

export const query = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] ?? null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id            TEXT PRIMARY KEY,
    prefix              TEXT,
    disabled_commands   TEXT[] NOT NULL DEFAULT '{}',
    disabled_modules    TEXT[] NOT NULL DEFAULT '{}',
    modlog_channel      TEXT,
    command_log_channel TEXT,
    ai_enabled          BOOLEAN NOT NULL DEFAULT true,
    reason_required     BOOLEAN NOT NULL DEFAULT false,
    erlc_key            TEXT,
    erlc_staff_role     TEXT,
    erlc_admin_role     TEXT,
    shift_role          TEXT,
    banreq_channel      TEXT,
    join_log_channel    TEXT,
    kill_log_channel    TEXT,
    ingame_log_channel  TEXT,
    modcall_log_channel TEXT,
    session_channel     TEXT,
    session_ping_role   TEXT,
    staff_alert_channel TEXT
  );

  CREATE TABLE IF NOT EXISTS guild_counters (
    guild_id  TEXT PRIMARY KEY,
    next_case BIGINT NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS mod_cases (
    guild_id      TEXT NOT NULL,
    case_number   BIGINT NOT NULL,
    platform      TEXT NOT NULL,
    subject_id    TEXT NOT NULL,
    subject_name  TEXT NOT NULL,
    type          TEXT NOT NULL,
    reason        TEXT,
    duration_ms   BIGINT,
    moderator_id  TEXT NOT NULL,
    moderator_tag TEXT,
    created_at    BIGINT NOT NULL,
    executed      BOOLEAN NOT NULL DEFAULT true,
    voided        BOOLEAN NOT NULL DEFAULT false,
    voided_by     TEXT,
    voided_reason TEXT,
    PRIMARY KEY (guild_id, case_number)
  );
  CREATE INDEX IF NOT EXISTS idx_cases_subject ON mod_cases (guild_id, platform, subject_id);
  CREATE INDEX IF NOT EXISTS idx_cases_recent ON mod_cases (guild_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS mod_types (
    guild_id   TEXT NOT NULL,
    name       TEXT NOT NULL,
    is_ban     BOOLEAN NOT NULL DEFAULT false,
    ingame_cmd TEXT,
    PRIMARY KEY (guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS roblox_links (
    discord_id  TEXT PRIMARY KEY,
    roblox_id   TEXT NOT NULL,
    roblox_name TEXT NOT NULL,
    linked_at   BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_roblox_links_roblox ON roblox_links (roblox_id);

  CREATE TABLE IF NOT EXISTS shift_types (
    guild_id TEXT NOT NULL,
    name     TEXT NOT NULL,
    PRIMARY KEY (guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    shift_type  TEXT NOT NULL DEFAULT 'default',
    started_at  BIGINT NOT NULL,
    ended_at    BIGINT,
    duration_ms BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_shifts_active ON shifts (guild_id, ended_at);
  CREATE INDEX IF NOT EXISTS idx_shifts_user ON shifts (guild_id, user_id, started_at);

  CREATE TABLE IF NOT EXISTS ban_requests (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id     TEXT NOT NULL,
    roblox_id    TEXT NOT NULL,
    roblox_name  TEXT NOT NULL,
    reason       TEXT,
    requested_by TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    resolved_by  TEXT,
    message_id   TEXT,
    channel_id   TEXT,
    created_at   BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_banreq_guild ON ban_requests (guild_id, status);

  CREATE TABLE IF NOT EXISTS erlc_cursor (
    guild_id TEXT NOT NULL,
    log_type TEXT NOT NULL,
    last_ts  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, log_type)
  );

  CREATE TABLE IF NOT EXISTS perm_groups (
    guild_id TEXT NOT NULL,
    role_id  TEXT NOT NULL,
    name     TEXT NOT NULL,
    nodes    TEXT[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (guild_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS bot_guilds (
    guild_id     TEXT PRIMARY KEY,
    name         TEXT,
    icon         TEXT,
    member_count INTEGER,
    owner_id     TEXT,
    updated_at   BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loa (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    reason      TEXT,
    starts_at   BIGINT NOT NULL,
    ends_at     BIGINT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    message_id  TEXT,
    channel_id  TEXT,
    created_at  BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loa_lookup ON loa (guild_id, user_id, status);

  CREATE TABLE IF NOT EXISTS appeals (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    roblox_id   TEXT,
    roblox_name TEXT,
    reason      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    message_id  TEXT,
    channel_id  TEXT,
    created_at  BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_appeals_guild ON appeals (guild_id, status);

  CREATE TABLE IF NOT EXISTS autohints (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    message    TEXT NOT NULL,
    interval_ms BIGINT NOT NULL,
    next_at    BIGINT NOT NULL,
    enabled    BOOLEAN NOT NULL DEFAULT true
  );
  CREATE INDEX IF NOT EXISTS idx_autohints_guild ON autohints (guild_id);

  CREATE TABLE IF NOT EXISTS reminders (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id  TEXT,
    text      TEXT NOT NULL,
    due_at    BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders (due_at);

  CREATE TABLE IF NOT EXISTS button_role_panels (
    message_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    roles      JSONB NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    opener_id  TEXT NOT NULL,
    subject    TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    created_at BIGINT NOT NULL,
    closed_at  BIGINT,
    closed_by  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets (guild_id, status);

  CREATE TABLE IF NOT EXISTS erlc_status (
    guild_id  TEXT PRIMARY KEY,
    online    BOOLEAN,
    players   INTEGER,
    checked_at BIGINT NOT NULL
  );
`;

// Forward migrations for columns added after a guild's DB was first created.
const MIGRATIONS = `
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS staff_alert_channel TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS loa_channel TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS appeal_channel TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS quota_channel TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS status_channel TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS announce_channel TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_category TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ticket_staff_role TEXT;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS weekly_shift_quota BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS weekly_case_quota INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS last_quota_report BIGINT NOT NULL DEFAULT 0;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ingame_autolog BOOLEAN NOT NULL DEFAULT true;
  ALTER TABLE guild_config ADD COLUMN IF NOT EXISTS ingame_warn_trigger TEXT NOT NULL DEFAULT 'warn';
  ALTER TABLE mod_cases ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'discord';
`;

export async function initSchema() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
}

/**
 * Subscribe to a Postgres NOTIFY channel on a dedicated connection.
 * Reconnects automatically if the connection drops.
 */
export async function listen(channel, handler) {
  const connect = async () => {
    const client = new pg.Client({ connectionString: cleanUrl, ssl: isLocal || !rawUrl ? false : { rejectUnauthorized: false } });
    client.on("notification", (msg) => {
      if (msg.channel === channel) handler(msg.payload);
    });
    client.on("error", (err) => {
      console.error(`LISTEN ${channel} error:`, err.message);
      client.end().catch(() => {});
      setTimeout(connect, 3000);
    });
    await client.connect();
    await client.query(`LISTEN ${channel}`);
    return client;
  };
  return connect();
}

export const notify = (channel, payload) => pool.query("SELECT pg_notify($1, $2)", [channel, String(payload)]);

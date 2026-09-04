import "dotenv/config";

const env = (name, fallback = "") => process.env[name] || fallback;

export const config = {
  // Production = the public multi-tenant deploy. Dev/self-host may use a single shared ER:LC key.
  isDev: env("NODE_ENV") !== "production",

  discordToken: env("DISCORD_TOKEN"),
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  databaseUrl: env("DATABASE_URL"),

  // Register slash commands to this guild only (instant). Leave empty for global (~1h to propagate).
  devGuildId: env("DEV_GUILD_ID"),

  // Display name for the dashboard / legal pages (the bot's Discord username is used where available).
  botName: env("BOT_NAME", "Scout"),

  defaultPrefix: env("DEFAULT_PREFIX", "!"),
  ownerIds: env("OWNER_IDS").split(",").map((s) => s.trim()).filter(Boolean),

  links: {
    support: env("SUPPORT_SERVER_URL"),
    docs: env("DOCS_URL"),
    // Render injects RENDER_EXTERNAL_URL automatically; use it if DASHBOARD_URL isn't set.
    dashboard: env("DASHBOARD_URL") || env("RENDER_EXTERNAL_URL"),
  },

  discord: {
    clientId: env("DISCORD_CLIENT_ID"),
    clientSecret: env("DISCORD_CLIENT_SECRET"),
  },

  web: {
    port: Number(env("PORT", "3000")),
    sessionSecret: env("SESSION_SECRET"),
  },

  ai: {
    // Anthropic API model identifier for the /ai command — override with ANTHROPIC_MODEL.
    model: env("ANTHROPIC_MODEL", "claude-opus-5"),
    effort: env("ANTHROPIC_EFFORT", "low"),
    maxTokens: Number(env("MAX_TOKENS", "1024")),
    historyLimit: Number(env("HISTORY_LIMIT", "20")),
  },

  erlc: {
    // Dev/self-host only: acts as one implicit ER:LC server when none are configured
    // (see src/lib/erlcServers.js `devServer`). Ignored when NODE_ENV=production.
    devKey: env("ERLC_KEY"),
    // The bot's PRC global API key (app identity). Shared across all tenants — one bucket.
    globalKey: env("ERLC_GLOBAL_KEY"),
  },

  sentryDsn: env("SENTRY_DSN"),
  bloxlinkApiKey: env("BLOXLINK_API_KEY"),

  // Public-facing count floors — the bot's presence, the landing page and /about
  // never show fewer than these. Real numbers win once they're higher. The
  // operator /admin panel always shows the true counts. Override per-deploy.
  display: {
    minGuilds: Number(env("DISPLAY_MIN_GUILDS", "9")),
    minMembers: Number(env("DISPLAY_MIN_MEMBERS", "318")),
  },
};

/** Throw if a required var is missing. Call from an entry point, not at import. */
export function requireConfig(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(", ")} (see .env.example)`);
}

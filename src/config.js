import "dotenv/config";

const env = (name, fallback = "") => process.env[name] || fallback;

export const config = {
  discordToken: env("DISCORD_TOKEN"),
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  databaseUrl: env("DATABASE_URL"),

  // Register slash commands to this guild only (instant). Leave empty for global (~1h to propagate).
  devGuildId: env("DEV_GUILD_ID"),

  defaultPrefix: env("DEFAULT_PREFIX", "!"),
  ownerIds: env("OWNER_IDS").split(",").map((s) => s.trim()).filter(Boolean),

  links: {
    support: env("SUPPORT_SERVER_URL"),
    docs: env("DOCS_URL"),
    dashboard: env("DASHBOARD_URL"),
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
    model: env("ANTHROPIC_MODEL", "claude-opus-5"),
    effort: env("ANTHROPIC_EFFORT", "low"),
    maxTokens: Number(env("MAX_TOKENS", "1024")),
    historyLimit: Number(env("HISTORY_LIMIT", "20")),
  },

  erlc: {
    devKey: env("ERLC_KEY"),
    globalKey: env("ERLC_GLOBAL_KEY"),
  },
};

/** Throw if a required var is missing. Call from an entry point, not at import. */
export function requireConfig(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`Missing required env: ${missing.join(", ")} (see .env.example)`);
}

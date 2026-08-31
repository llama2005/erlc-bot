import * as Sentry from "@sentry/node";
import { config } from "../config.js";

let on = false;

/** Initialise Sentry. No-op unless SENTRY_DSN is set. Call once per process at startup. */
export function initSentry(serverName) {
  if (on || !config.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.isDev ? "development" : "production",
    release: (process.env.RENDER_GIT_COMMIT || "").slice(0, 7) || undefined,
    serverName,
    tracesSampleRate: 0,
    beforeSend: scrub,
  });
  on = true;
  console.log(`Sentry enabled (${serverName}).`);
}

const SECRET = /(server-key|authorization|token|api[_-]?key|dsn|database_url|session_secret)/i;

function scrub(event) {
  try {
    if (event.request?.headers) for (const h of Object.keys(event.request.headers)) if (SECRET.test(h)) event.request.headers[h] = "[redacted]";
    const s = JSON.stringify(event.extra || {});
    if (s.length > 20_000) event.extra = { note: "extra trimmed" };
  } catch {
    /* leave as-is */
  }
  return event;
}

/** Capture an error with structured tags. Safe to call when Sentry is off. */
export function captureError(err, { tags = {}, user, extra } = {}) {
  if (!on) return null;
  return Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v != null) scope.setTag(k, String(v));
    if (user) scope.setUser({ id: String(user) });
    if (extra) scope.setExtras(extra);
    return Sentry.captureException(err);
  });
}

/** Capture free-text user feedback tied to an earlier error id. */
export function captureFeedback(text, { user, tags = {} } = {}) {
  if (!on) return null;
  return Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) if (v != null) scope.setTag(k, String(v));
    if (user) scope.setUser({ id: String(user) });
    scope.setLevel("info");
    return Sentry.captureMessage(`User feedback: ${text}`);
  });
}

export const sentryEnabled = () => on;
export const flushSentry = (ms = 2000) => (on ? Sentry.close(ms) : Promise.resolve());
export { Sentry };

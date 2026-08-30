# Deploying erlc-bot (bot + dashboard)

The stack is **three pieces**:

| Piece | What | Where |
|---|---|---|
| Postgres | all data (cases, config, shifts, links…) | **Neon** free tier (neon.tech) |
| `src/index.js` | the Discord bot | a worker/always-on process |
| `web/server.js` | the dashboard | a web service |

Both processes connect to the same `DATABASE_URL` and stay in sync via Postgres
`LISTEN/NOTIFY` (change config on the dashboard → the bot picks it up within a second).

For in-game ER:LC command **execution** (`:pm` / `:ban` / `:kick`) the bot process
needs a **stable outbound IP** allowlisted at <https://api.erlc.gg/server-owners>.
Everything else (case logging, shifts, verify, dashboard, auto-log poller) works
without it.

---

## 1. Database (Neon)

1. neon.tech → new project → copy the **connection string** (`postgresql://…`).
2. That's your `DATABASE_URL`. The bot creates its tables automatically on first run.

## 2. Discord app (OAuth for the dashboard)

Developer Portal → your application:

- **OAuth2 → General**: copy **Client ID** and **Client Secret**.
- **OAuth2 → Redirects**: add `https://<your-dashboard-url>/auth/callback`
  (and `http://localhost:3000/auth/callback` for local dev).

## 3. Push to GitHub

```bash
cd ~/discord-ai-bot
git init && git add -A && git commit -m "initial"
gh repo create erlc-bot --private --source=. --push
```
`.env` and secrets are git-ignored.

## 4. Render (recommended — runs both processes)

Render → **New → Blueprint** → pick the repo. `render.yaml` defines two Starter
services: `erlc-bot` (worker) and `erlc-bot-dashboard` (web).

For **each** service → **Environment**, set the `sync: false` vars:

| Var | erlc-bot | erlc-bot-dashboard |
|---|---|---|
| `DATABASE_URL` | ✅ | ✅ |
| `DISCORD_TOKEN` | ✅ | ✅ |
| `ANTHROPIC_API_KEY` | ✅ | — |
| `OWNER_IDS` | ✅ | — |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | — | ✅ |
| `DASHBOARD_URL` | — | ✅ = the dashboard's own `https://…onrender.com` URL |

`SESSION_SECRET` is auto-generated. `NODE_ENV=production` is set in `render.yaml` — this
is the public multi-tenant mode: the shared `ERLC_KEY` fallback is **disabled** (every
guild sets its own key via `/config erlc-key` or the dashboard) and slash commands
register **globally** (~1h to first appear). Don't set `DEV_GUILD_ID` in production;
it's a dev-instance-only fast path. Deploy.

Then: **erlc-bot → Settings → Outbound IP Addresses** lists 3 IPs — allowlist all
three at api.erlc.gg/server-owners, and add `<DASHBOARD_URL>/auth/callback` to the
Discord app's redirects.

Updates: `git push` (autoDeploy).

## 5. Alternative — bot on a VPS, dashboard on Render

If you want the absolute cheapest static IP: run the **bot** on a Hetzner CX22
(~€4/mo) with systemd (see the VPS section below), and the **dashboard** on Render's
free web tier or the same VPS. Both just need `DATABASE_URL`.

---

# VPS path (bot only)

Target **Ubuntu 24.04 LTS**, smallest tier. `deploy/setup.sh` installs Node 24, a
firewall, and the systemd unit.

```bash
# get the code onto the box (private repo)
sudo useradd -m -s /bin/bash bot
sudo -u bot git clone git@github.com:<you>/erlc-bot.git /home/bot/erlc-bot
sudo bash /home/bot/erlc-bot/deploy/setup.sh
cd /home/bot/erlc-bot && sudo -u bot cp .env.example .env && sudo -u bot nano .env
sudo systemctl start erlc-bot
sudo journalctl -u erlc-bot -f          # note the "Public IP:" line → allowlist it
```

Updating: `sudo -u bot bash -lc 'cd /home/bot/erlc-bot && git pull && npm ci --omit=dev' && sudo systemctl restart erlc-bot`

To also run the dashboard on the VPS, add a second systemd unit with
`ExecStart=/usr/bin/node web/server.js` and put it behind Caddy/nginx for TLS.

## Common issues

| Symptom | Fix |
|---|---|
| `better-sqlite3` build fails | not used any more — ignore; if `pg` won't install, `apt install build-essential python3` |
| Bot starts then exits | check `DATABASE_URL` is reachable and `requireConfig` vars are all set |
| Dashboard login loops | `DASHBOARD_URL` must exactly match the Discord OAuth redirect origin |
| In-game commands 4000 | the **bot** process's IP isn't allowlisted (dashboard IP doesn't matter) |

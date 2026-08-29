#!/usr/bin/env bash
# One-time VPS setup for erlc-bot on Ubuntu 24.04.
# Run as root (or with sudo):  sudo bash deploy/setup.sh
set -euo pipefail

BOT_USER=bot
APP_DIR="/home/$BOT_USER/erlc-bot"

echo "==> System packages"
apt-get update -y
apt-get install -y curl git build-essential python3 ufw unattended-upgrades

echo "==> Node.js 24"
if ! command -v node >/dev/null || [[ "$(node -v)" != v24* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Bot user"
id "$BOT_USER" &>/dev/null || useradd -m -s /bin/bash "$BOT_USER"

echo "==> Firewall (SSH only — the bot makes only outbound connections)"
ufw allow OpenSSH
ufw --force enable

echo "==> App dependencies"
if [[ -d "$APP_DIR" ]]; then
  chown -R "$BOT_USER:$BOT_USER" "$APP_DIR"
  sudo -u "$BOT_USER" bash -lc "cd '$APP_DIR' && npm ci --omit=dev || npm install --omit=dev"
else
  echo "!! $APP_DIR not found — copy the project there first (see deploy/README.md), then re-run."
  exit 1
fi

echo "==> systemd service"
install -m 644 "$APP_DIR/deploy/erlc-bot.service" /etc/systemd/system/erlc-bot.service
systemctl daemon-reload
systemctl enable erlc-bot

echo
echo "Done. Now:"
echo "  1. Put your secrets in $APP_DIR/.env  (cp .env.example .env && nano .env)"
echo "  2. systemctl start erlc-bot"
echo "  3. journalctl -u erlc-bot -f          # watch logs; note the 'Public IP:' line"
echo "  4. Allowlist that IP at https://api.erlc.gg/server-owners"

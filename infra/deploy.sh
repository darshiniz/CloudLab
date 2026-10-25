#!/usr/bin/env bash
# Deploy the latest code from GitHub on the CONTROL VM.   Run as the 'cloudlab' admin user (needs sudo):
#   cd ~/cloudlab && bash infra/deploy.sh
# Pulls main, installs backend dependencies, builds the frontend, restarts the API (and instance 2 if load balancing is on).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/cloudlab/backend
WEB=/var/www/cloudlab

cd "$REPO"
echo "==> Pulling latest code"
git pull --ff-only

echo "==> Backend"
sudo rsync -a --delete --exclude node_modules --exclude data --exclude .env "$REPO/backend/" "$APP/"
sudo chown -R cloudlab:cloudlab "$APP"
( cd "$APP" && sudo -u cloudlab npm ci --omit=dev --no-audit --no-fund )

echo "==> Frontend"
( cd "$REPO/frontend" && npm ci --no-audit --no-fund && VITE_USE_MOCKS=false VITE_API_BASE_URL=/api/v1 npm run build )
sudo mkdir -p "$WEB" && sudo rsync -a --delete "$REPO/frontend/dist/" "$WEB/"

echo "==> Restarting"
sudo systemctl restart cloudlab-api
if systemctl is-enabled --quiet cloudlab-api-2 2>/dev/null; then sudo systemctl restart cloudlab-api-2; fi
for i in $(seq 1 20); do curl -fs http://127.0.0.1:5000/api/v1/health >/dev/null && { echo "API healthy. Deployed $(git rev-parse --short HEAD)."; exit 0; }; sleep 1; done
echo "API did not come up: sudo journalctl -u cloudlab-api -n 50"; exit 1
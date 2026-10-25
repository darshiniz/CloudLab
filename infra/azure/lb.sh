#!/usr/bin/env bash
# Turn nginx load balancing between two API instances on or off.  Run on the CONTROL VM:
#   sudo bash infra/azure/lb.sh on      # 2 API instances behind nginx (least_conn)
#   sudo bash infra/azure/lb.sh off     # back to a single instance
#   sudo bash infra/azure/lb.sh status
set -euo pipefail
SITE=/etc/nginx/sites-available/cloudlab
UP=/etc/nginx/conf.d/cloudlab-upstream.conf
HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }

# One-time: make the site use the upstream group instead of a fixed port (certbot-edited files keep working).
if grep -q 'proxy_pass http://127.0.0.1:5000' "$SITE"; then
  sed -i 's#proxy_pass http://127.0.0.1:5000;#proxy_pass http://cloudlab_api;#' "$SITE"
fi
grep -q 'proxy_pass http://cloudlab_api' "$SITE" || { echo "Could not find the API proxy_pass in $SITE"; exit 1; }

case "${1:-status}" in
  on)
    if [ ! -f /etc/cloudlab/api-2.env ]; then
      cat > /etc/cloudlab/api-2.env <<'ENV'
PORT=5001
INSTANCE_ID=api-5001
JOBS_ENABLED=false
ENV
      chown root:cloudlab /etc/cloudlab/api-2.env; chmod 640 /etc/cloudlab/api-2.env
    fi
    cp "$HERE/cloudlab-api-2.service" /etc/systemd/system/cloudlab-api-2.service
    systemctl daemon-reload
    systemctl enable --now cloudlab-api-2
    for i in $(seq 1 20); do curl -fs http://127.0.0.1:5001/api/v1/health >/dev/null && break; sleep 1; done
    curl -fs http://127.0.0.1:5001/api/v1/health >/dev/null || { echo "Instance 2 did not become healthy: journalctl -u cloudlab-api-2"; exit 1; }
    cat > "$UP" <<'CONF'
upstream cloudlab_api {
    least_conn;
    server 127.0.0.1:5000;
    server 127.0.0.1:5001;
}
CONF
    echo "Load balancing ON: 2 API instances (5000, 5001)." ;;
  off)
    cat > "$UP" <<'CONF'
upstream cloudlab_api {
    server 127.0.0.1:5000;
}
CONF
    systemctl disable --now cloudlab-api-2 2>/dev/null || true
    echo "Load balancing OFF: single instance (5000)." ;;
  status)
    cat "$UP" 2>/dev/null || echo "No upstream file yet. Run: sudo bash $0 on|off"
    systemctl is-active cloudlab-api cloudlab-api-2 || true
    exit 0 ;;
  *) echo "Usage: sudo bash $0 on|off|status"; exit 1 ;;
esac
nginx -t && systemctl reload nginx

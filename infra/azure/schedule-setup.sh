#!/usr/bin/env bash
# Run once on the CONTROL VM:  sudo bash infra/azure/schedule-setup.sh
# 1. turns on the app's scheduled lab shutdown (BRD BR-13: running labs stop at 16:55 IST, reason "Scheduled Shutdown")
# 2. installs the weekly workspace backup (BRD section 16: Fridays 16:30 IST, 4 archives kept)
# Safe to run again.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE=/etc/cloudlab/api.env
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found (run control-setup.sh first)"; exit 1; }

setvar() {  # setvar NAME VALUE : replace the line if present, else append (the file holds secrets: never print it)
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
setvar SCHEDULED_STOP_ENABLED true
setvar SCHEDULED_STOP_TIME 16:55
setvar SCHEDULED_STOP_UTC_OFFSET_MIN 330
echo "scheduled lab shutdown: on (16:55 IST)"

install -m 755 "$HERE/backup.sh" /usr/local/bin/cloudlab-backup
cat > /etc/systemd/system/cloudlab-backup.service <<'EOF'
[Unit]
Description=CloudLab weekly workspace archive
After=network-online.target mnt-cloudlab.mount

[Service]
Type=oneshot
ExecStart=/usr/local/bin/cloudlab-backup
Nice=10
EOF
cat > /etc/systemd/system/cloudlab-backup.timer <<'EOF'
[Unit]
Description=Run the CloudLab workspace archive every Friday at 16:30 IST

[Timer]
OnCalendar=Fri 16:30 Asia/Kolkata
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now cloudlab-backup.timer

systemctl restart cloudlab-api
systemctl is-active --quiet cloudlab-api-2 2>/dev/null && systemctl restart cloudlab-api-2 || true
echo
systemctl list-timers cloudlab-backup.timer --no-pager | head -4
echo
echo "Done. Test the backup now with:  sudo systemctl start cloudlab-backup && sudo journalctl -u cloudlab-backup -n 20 --no-pager"

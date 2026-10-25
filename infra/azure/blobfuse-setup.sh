#!/usr/bin/env bash
# Mounts the Azure Blob container at /mnt/cloudlab using blobfuse2 and the VM's managed identity (no keys stored).
# Run as root on ALL THREE VMs:   STORAGE_ACCOUNT=cloudlabstore123 CONTAINER=cloudlab bash blobfuse-setup.sh
set -euo pipefail
: "${STORAGE_ACCOUNT:?set STORAGE_ACCOUNT}"
CONTAINER="${CONTAINER:-cloudlab}"
MOUNT=/mnt/cloudlab
CACHE=/mnt/blobfuse-cache

apt-get update && apt-get install -y wget fuse3
[ -f /etc/apt/sources.list.d/microsoft-prod.list ] || { wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/ms.deb && dpkg -i /tmp/ms.deb && apt-get update; }
apt-get install -y blobfuse2

mkdir -p "$MOUNT" "$CACHE" /etc/cloudlab
# "adls" = hierarchical namespace (real folders, atomic rename). The storage account must be created with --hns true.
cat > /etc/cloudlab/blobfuse2.yaml <<EOF
allow-other: true
logging:
  type: syslog
  level: log_warning
components:
  - libfuse
  - file_cache
  - attr_cache
  - azstorage
libfuse:
  default-permission: 0777   # lab containers run as uid 1000; the mount itself is owned by root
  attribute-timeout-sec: 2
  entry-timeout-sec: 2
  negative-entry-timeout-sec: 2
file_cache:
  path: $CACHE
  timeout-sec: 2
  allow-non-empty-temp: true
attr_cache:
  timeout-sec: 2
azstorage:
  type: adls
  account-name: $STORAGE_ACCOUNT
  container: $CONTAINER
  mode: msi
EOF
chmod 600 /etc/cloudlab/blobfuse2.yaml

# Mount at boot with a small systemd unit
cat > /etc/systemd/system/cloudlab-blobfuse.service <<EOF
[Unit]
Description=Mount CloudLab Blob storage
After=network-online.target
Wants=network-online.target
Before=docker.service cloudlab-api.service

[Service]
Type=forking
ExecStart=/usr/bin/blobfuse2 mount $MOUNT --config-file=/etc/cloudlab/blobfuse2.yaml -o allow_other
ExecStop=/bin/fusermount3 -u $MOUNT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now cloudlab-blobfuse
sleep 3
mountpoint -q "$MOUNT" && echo "Mounted $CONTAINER at $MOUNT" || { echo "MOUNT FAILED. Check: journalctl -u cloudlab-blobfuse and that the VM identity has 'Storage Blob Data Contributor' on the account"; exit 1; }
touch "$MOUNT/.mount-test" && rm "$MOUNT/.mount-test" && echo "Write test OK"

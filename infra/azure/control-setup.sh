#!/usr/bin/env bash
# Control VM (Azure, Debian 12). Run once as root:
#   sudo STORAGE_ACCOUNT=cloudlabstore123 bash infra/azure/control-setup.sh
set -euo pipefail
: "${STORAGE_ACCOUNT:?set STORAGE_ACCOUNT}"
HERE="$(cd "$(dirname "$0")" && pwd)"

apt-get update && apt-get install -y curl gnupg ca-certificates lsb-release nginx openssh-client docker.io
# Only the docker CLI is used here (it talks to the workers over SSH); the local daemon is not needed.
systemctl disable --now docker docker.socket 2>/dev/null || true
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs

id cloudlab >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin cloudlab
mkdir -p /etc/cloudlab /opt/cloudlab

STORAGE_ACCOUNT="$STORAGE_ACCOUNT" bash "$HERE/blobfuse-setup.sh"

# SSH key the API uses to reach each worker's Docker (DOCKER_HOST=ssh://cloudlab@<worker-private-ip>)
install -d -m 700 -o cloudlab -g cloudlab /home/cloudlab/.ssh
[ -f /home/cloudlab/.ssh/id_ed25519 ] || sudo -u cloudlab ssh-keygen -t ed25519 -N '' -f /home/cloudlab/.ssh/id_ed25519
cat <<EOF

Public key to give the workers (CONTROL_PUBKEY):
$(cat /home/cloudlab/.ssh/id_ed25519.pub)

Next: see docs/DEPLOYMENT_AZURE.md, Part 8 onward.
EOF

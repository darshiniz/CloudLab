#!/usr/bin/env bash
# Control VM (e2-medium, asia-south1). Run once as root:  sudo bash control-setup.sh
set -euo pipefail
BUCKET="${BUCKET:-cloudlab-storage}"
MOUNT=/mnt/cloudlab

# Node 22, nginx, SSH client, gcsfuse
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx openssh-client curl gnupg lsb-release
echo "deb [signed-by=/usr/share/keyrings/cloud.google.asc] https://packages.cloud.google.com/apt gcsfuse-$(lsb_release -c -s) main" > /etc/apt/sources.list.d/gcsfuse.list
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg -o /usr/share/keyrings/cloud.google.asc
apt-get update && apt-get install -y gcsfuse

id cloudlab >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin cloudlab
mkdir -p "$MOUNT" /etc/cloudlab /opt/cloudlab

# Same bucket mount as the workers: uid/gid 1000 matches the IDE user inside lab containers
grep -q "$BUCKET $MOUNT" /etc/fstab || echo "$BUCKET $MOUNT gcsfuse rw,_netdev,allow_other,implicit_dirs,uid=1000,gid=1000,file_mode=666,dir_mode=777,only_dir=,x-systemd.requires=network-online.target" >> /etc/fstab
mount -a

# SSH key the API uses to reach each worker's Docker (DOCKER_HOST=ssh://cloudlab@<worker-internal-ip>)
install -d -m 700 -o cloudlab -g cloudlab /home/cloudlab/.ssh
[ -f /home/cloudlab/.ssh/id_ed25519 ] || sudo -u cloudlab ssh-keygen -t ed25519 -N '' -f /home/cloudlab/.ssh/id_ed25519
cat <<EOF

Public key to put in worker-setup.sh (CONTROL_PUBKEY):
$(cat /home/cloudlab/.ssh/id_ed25519.pub)

Next:
  1. Copy the repo's backend/ folder to /opt/cloudlab/backend and run: npm ci --omit=dev
  2. Create /etc/cloudlab/api.env from .env.example (DRIVER=docker, DB_CLIENT=mysql, STORAGE_ROOT=$MOUNT, JWT_SECRET, WORKER_*_DOCKER_HOST/IP)
  3. After the workers are set up, accept their host keys once:  sudo -u cloudlab ssh-keyscan -H <worker-ip> >> /home/cloudlab/.ssh/known_hosts
  4. cp infra/cloudlab-api.service /etc/systemd/system/ && systemctl enable --now cloudlab-api
  5. cp infra/nginx.conf /etc/nginx/sites-available/cloudlab, enable it, run certbot, reload nginx
EOF

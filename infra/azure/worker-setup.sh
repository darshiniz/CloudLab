#!/usr/bin/env bash
# Worker VM (Azure, Debian 12). Run once on EACH worker as root:
#   sudo -E CONTROL_PUBKEY="ssh-ed25519 AAAA... cloudlab@cloudlab-control" CONTROL_IP=10.0.0.4 \
#        STORAGE_ACCOUNT=cloudlabstore123 bash infra/azure/worker-setup.sh
set -euo pipefail
: "${CONTROL_PUBKEY:?paste the public key printed by control-setup.sh}"
: "${CONTROL_IP:?the PRIVATE ip of the control VM}"
: "${STORAGE_ACCOUNT:?set STORAGE_ACCOUNT}"
HERE="$(cd "$(dirname "$0")" && pwd)"

apt-get update && apt-get install -y curl gnupg lsb-release iptables ca-certificates git

# --- Docker -------------------------------------------------------------------------------------
curl -fsSL https://get.docker.com | sh
cat > /etc/docker/daemon.json <<'EOF'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "2" }, "live-restore": true, "userland-proxy": false }
EOF
systemctl restart docker

# --- deploy user: the API reaches Docker over SSH, so Docker never listens on a network port ----
id cloudlab >/dev/null 2>&1 || useradd --create-home --shell /bin/bash cloudlab
usermod -aG docker cloudlab
install -d -m 700 -o cloudlab -g cloudlab /home/cloudlab/.ssh
echo "from=\"$CONTROL_IP\",no-agent-forwarding,no-port-forwarding,no-X11-forwarding $CONTROL_PUBKEY" > /home/cloudlab/.ssh/authorized_keys
chown cloudlab:cloudlab /home/cloudlab/.ssh/authorized_keys && chmod 600 /home/cloudlab/.ssh/authorized_keys

# --- Blob storage as the shared file system -----------------------------------------------------
STORAGE_ACCOUNT="$STORAGE_ACCOUNT" bash "$HERE/blobfuse-setup.sh"
systemctl restart docker   # so Docker starts after the mount exists

# --- Lab network + egress rules -----------------------------------------------------------------
docker network inspect cloudlab-labs >/dev/null 2>&1 || docker network create --driver bridge --opt com.docker.network.bridge.enable_icc=false cloudlab-labs
SUBNET=$(docker network inspect cloudlab-labs -f '{{(index .IPAM.Config 0).Subnet}}')

# Rules live in DOCKER-USER so Docker does not overwrite them. Inserted in reverse order (last -I ends up first).
iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -j RETURN
# Labs may NOT reach: Azure's metadata service (169.254.169.254) and WireServer (168.63.129.16),
# the VNet (database, other VMs) and each other. Internet downloads (pip/npm/maven) keep working.
iptables -I DOCKER-USER -s "$SUBNET" -d 169.254.169.254 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 168.63.129.16 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 10.0.0.0/8 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 172.16.0.0/12 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 192.168.0.0/16 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 100.64.0.0/10 -j DROP
iptables -I DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent && netfilter-persistent save
docker run --rm --network cloudlab-labs curlimages/curl -s -m 3 http://169.254.169.254/ >/dev/null && echo "WARNING: metadata service reachable from labs" || echo "metadata service blocked"

echo "Worker ready. Next: build the lab images (docs/DEPLOYMENT_AZURE.md, Part 9). No inbound internet access to this VM is needed."

#!/usr/bin/env bash
# Worker VM (e2-medium, asia-south1). Run once on EACH worker as root:
#   CONTROL_PUBKEY="ssh-ed25519 AAAA... cloudlab@control" CONTROL_IP=10.0.0.2 sudo -E bash worker-setup.sh
set -euo pipefail
: "${CONTROL_PUBKEY:?paste the public key printed by control-setup.sh}"
BUCKET="${BUCKET:-cloudlab-storage}"
MOUNT=/mnt/cloudlab
REGISTRY="${REGISTRY:-asia-south1-docker.pkg.dev/PROJECT/cloudlab}"

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
echo "from=\"${CONTROL_IP:-10.0.0.0/8}\",no-agent-forwarding,no-port-forwarding,no-X11-forwarding $CONTROL_PUBKEY" > /home/cloudlab/.ssh/authorized_keys
chown cloudlab:cloudlab /home/cloudlab/.ssh/authorized_keys && chmod 600 /home/cloudlab/.ssh/authorized_keys

# --- Cloud Storage bucket as the shared file system --------------------------------------------
echo "deb [signed-by=/usr/share/keyrings/cloud.google.asc] https://packages.cloud.google.com/apt gcsfuse-$(lsb_release -c -s) main" > /etc/apt/sources.list.d/gcsfuse.list
curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg -o /usr/share/keyrings/cloud.google.asc
apt-get update && apt-get install -y gcsfuse
mkdir -p "$MOUNT"
# uid/gid 1000 = the IDE user inside the lab images; permissive modes because gcsfuse ignores chmod
grep -q "$BUCKET $MOUNT" /etc/fstab || echo "$BUCKET $MOUNT gcsfuse rw,_netdev,allow_other,implicit_dirs,uid=1000,gid=1000,file_mode=666,dir_mode=777,x-systemd.requires=network-online.target" >> /etc/fstab
mount -a

# --- Lab network + egress rules -----------------------------------------------------------------
docker network inspect cloudlab-labs >/dev/null 2>&1 || docker network create --driver bridge --opt com.docker.network.bridge.enable_icc=false cloudlab-labs
SUBNET=$(docker network inspect cloudlab-labs -f '{{(index .IPAM.Config 0).Subnet}}')

# Rules live in DOCKER-USER so Docker does not overwrite them. Inserted in reverse order (last -I ends up first).
iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -j RETURN
# Lab containers may NOT reach: the GCP metadata server (service-account tokens!), the VPC (Cloud SQL, other VMs), or each other
iptables -I DOCKER-USER -s "$SUBNET" -d 169.254.169.254 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 10.0.0.0/8 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 172.16.0.0/12 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 192.168.0.0/16 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 100.64.0.0/10 -j DROP
# ...but pip/npm/maven downloads from the internet keep working, and replies to the IDE proxy are allowed
iptables -I DOCKER-USER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
apt-get install -y iptables-persistent && netfilter-persistent save
# Host-side check that the metadata server is unreachable from a lab (must print "blocked"):
docker run --rm --network cloudlab-labs curlimages/curl -s -m 3 http://169.254.169.254/ >/dev/null && echo "WARNING: metadata server reachable" || echo "metadata server blocked"

# --- Images -------------------------------------------------------------------------------------
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet || true
for i in python java web; do docker pull "$REGISTRY/$i:1.0" && docker tag "$REGISTRY/$i:1.0" "cloudlab/$i:1.0" || echo "pull $i failed (build and push images first)"; done

echo "Worker ready. Firewall: allow tcp/22 and tcp/20000-20999 from the control VM's internal IP only; no public ports."

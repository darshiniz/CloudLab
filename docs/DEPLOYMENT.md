# Deploying CloudLab on Google Cloud (step by step)

This turns the laptop demo into the real thing: real Docker containers on two worker VMs, a real browser IDE (code-server) per lab, MySQL, and a storage bucket.
Follow the parts in order. **Commands were written from Google's documentation but have not been run end to end** — if one fails, read the error, fix, continue, and note it here for the next person.

## 0. What you are building

```
Internet ─> [control VM: nginx + API + frontend files] ──SSH──> [worker-1: Docker]  \
                     │  └─ /lab/<id> proxy ───────────────────> [worker-2: Docker]   > lab containers
                     ├─> Cloud SQL (MySQL, private IP)                              /
                     └─> Cloud Storage bucket, mounted at /mnt/cloudlab on all 3 VMs (gcsfuse)
```

| Piece | Why it is needed |
|---|---|
| Google Cloud account + project | Everything lives in one project |
| 3 VMs (e2-medium: 2 vCPU, 4 GB) in `asia-south1` | 1 control (API, nginx) + 2 workers (Docker, student labs) |
| Cloud SQL MySQL | Users, labs, environments, audit log (replaces the local SQLite file) |
| Cloud Storage bucket | Students' files and datasets; mounted into every VM so API and containers see the same folders |
| Artifact Registry | Stores the 3 lab images (python, java, web) so both workers can pull them |
| Firewall rules | Only 80/443 public; lab ports only from the control VM |
| (optional) a domain name | Needed for HTTPS (Let's Encrypt). Without it, use plain HTTP for a demo |

**Cost.** Per Google's pricing page an e2-medium in Mumbai is about **$0.04/hour (about $29/month)**, so three VMs are about **$88/month**; add roughly $10–15 for Cloud SQL, $10 for disks, cents for the bucket: about **$110–120/month if left on 24/7**. The **free trial gives $300 for 90 days** (whichever ends first), so you can run it about 2.5 months continuously — or much longer if you **stop the VMs when not demoing** (stopped VMs cost only their disks). Set a budget alert (Part 1).

---

## Part 1. Google Cloud account and the $300 credit

1. Go to https://cloud.google.com/free and click **Get started for free**. Sign in with a Google account (a personal Gmail is fine).
2. Enter name/address and a payment method. A card is required to verify identity; you are **not charged** unless you manually upgrade to a paid account. A pending authorization of a small amount may appear temporarily.
3. Eligibility: only people who have never been paying Google Cloud customers or used the trial before. If you are not eligible, ask your college whether it has Google Cloud credits (many MCA programmes do), or use a teammate's account.
4. When the trial ends (credit spent or 90 days) workloads stop; you have 30 days to upgrade and recover, otherwise they are deleted. **Do not click Upgrade** unless you mean to pay.
5. **Budget alert:** console → Billing → Budgets & alerts → Create budget → e.g. ₹/$ 250 with alerts at 50 %, 90 %. 
6. Create the project: console → project picker → **New project** → name `cloudlab` → note the **Project ID** (e.g. `cloudlab-123456`).
7. Install the CLI on your PC: https://cloud.google.com/sdk/docs/install, then in a terminal:
   ```
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   gcloud config set compute/region asia-south1
   gcloud config set compute/zone asia-south1-a
   ```
8. Enable the APIs (takes a minute):
   ```
   gcloud services enable compute.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com servicenetworking.googleapis.com iap.googleapis.com storage.googleapis.com
   ```

> If you hit a "quota" error creating VMs, open console → IAM & Admin → Quotas, and request an increase for the region, or try another zone (`asia-south1-b`).

## Part 2. Network and firewall

The `default` network is fine. Tighten it:

```
# remove the world-open SSH rule; we will use IAP (Google's authenticated tunnel) instead
gcloud compute firewall-rules delete default-allow-ssh --quiet
gcloud compute firewall-rules delete default-allow-rdp --quiet

# SSH only through IAP
gcloud compute firewall-rules create allow-iap-ssh --allow=tcp:22 --source-ranges=35.235.240.0/20

# website: only the control VM
gcloud compute firewall-rules create allow-web --allow=tcp:80,tcp:443 --target-tags=control

# lab ports (and SSH for Docker) on the workers: only from the control VM
gcloud compute firewall-rules create allow-control-to-workers --allow=tcp:22,tcp:20000-20999 --source-tags=control --target-tags=worker
```
(`default-allow-internal` stays: VMs can talk to each other and to Cloud SQL. Lab containers are blocked from the internal network separately by the iptables rules in `worker-setup.sh`.)

## Part 3. Storage bucket and image registry

```
gcloud storage buckets create gs://cloudlab-YOURNAME-storage --location=asia-south1 --uniform-bucket-level-access
gcloud artifacts repositories create cloudlab --repository-format=docker --location=asia-south1
```
Bucket names are global: pick something unique. Remember it; it is `BUCKET` below.
The VMs use the project's default service account to read/write the bucket and pull images (the `--scopes=cloud-platform` flag below allows it).

## Part 4. Cloud SQL (MySQL)

Private IP, so the database is never exposed to the internet.

1. One-time private-services setup:
   ```
   gcloud compute addresses create google-managed-services-default --global --purpose=VPC_PEERING --prefix-length=16 --network=default
   gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com --ranges=google-managed-services-default --network=default
   ```
2. Create the instance. Easiest in the console: **SQL → Create instance → MySQL**; edition **Enterprise**; preset **Sandbox**/smallest (db-f1-micro or similar); region `asia-south1`; **Connections: Private IP only** (network `default`); set a root password. (CLI equivalent: `gcloud sql instances create cloudlab-db --database-version=MYSQL_8_0 --edition=ENTERPRISE --tier=db-f1-micro --region=asia-south1 --network=default --no-assign-ip`.)
3. Create the database and user (console → your instance → Databases / Users, or Cloud Shell):
   - database `cloudlab` (character set `utf8mb4`)
   - user `cloudlab` with a strong password
4. Write down the instance's **private IP address** (instance overview). That is `DB_HOST`.

## Part 5. Create the three VMs

```
# control VM
gcloud compute instances create cloudlab-control --machine-type=e2-medium --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --scopes=cloud-platform --tags=control

# workers (bigger disk: images + caches)
for n in 1 2; do
  gcloud compute instances create cloudlab-worker-$n --machine-type=e2-medium --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size=40GB --scopes=cloud-platform --tags=worker
done

gcloud compute instances list
```
Note each VM's **INTERNAL_IP** (10.x.x.x) and the control VM's **EXTERNAL_IP**. Workers get an external IP only so they can download images and packages; the firewall blocks all inbound traffic to them except from the control VM and IAP.

Connect with: `gcloud compute ssh cloudlab-control --tunnel-through-iap`.

## Part 6. Get the code onto the VMs

Simplest: push the repo to GitHub (private is fine), then on each VM:
```
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/YOUR-USERNAME/cloudlab.git
```
(for a private repo use a GitHub personal access token as the password, or copy the folder with `gcloud compute scp --recurse --tunnel-through-iap cloudlab cloudlab-control:~`).

## Part 7. Control VM setup

On `cloudlab-control`:
```
cd cloudlab
sudo BUCKET=cloudlab-YOURNAME-storage bash infra/control-setup.sh
```
This installs Node 22, nginx, the docker CLI, gcsfuse; mounts the bucket at `/mnt/cloudlab`; creates the `cloudlab` user and an SSH key for reaching the workers. **It prints a public key — copy the whole `ssh-ed25519 …` line.** Also check `df /mnt/cloudlab` shows the bucket.

## Part 8. Worker setup (do both workers)

On each `cloudlab-worker-N`, with the key from Part 7 and the **control VM's internal IP**:
```
cd cloudlab
sudo -E CONTROL_PUBKEY="ssh-ed25519 AAAA... cloudlab@cloudlab-control" CONTROL_IP=10.x.x.x \
     BUCKET=cloudlab-YOURNAME-storage REGISTRY=asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/cloudlab \
     bash infra/worker-setup.sh
```
It installs Docker, mounts the bucket, creates the isolated lab network, adds the iptables rules that stop labs reaching Google's metadata server and your internal network, and tries to pull images (this fails the first time — images don't exist yet; fine).
**Check it:** the script ends by running a test that must print `metadata server blocked`.

## Part 9. Build and publish the lab images

On **worker-1** (it has Docker):
```
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet
cd ~/cloudlab
REGISTRY=asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/cloudlab bash infra/images/build.sh push
```
This builds `cloudlab/python:1.0`, `cloudlab/java:1.0`, `cloudlab/web:1.0` (takes 10–20 min the first time) and pushes them. Then on **worker-2**:
```
gcloud auth configure-docker asia-south1-docker.pkg.dev --quiet
for i in python java web; do
  docker pull asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/cloudlab/$i:1.0
  docker tag  asia-south1-docker.pkg.dev/YOUR_PROJECT_ID/cloudlab/$i:1.0 cloudlab/$i:1.0
done
```
**Test one by hand on worker-1** before involving the API:
```
docker run --rm -p 127.0.0.1:8080:8080 -v /mnt/cloudlab:/workspace cloudlab/python:1.0
# in a second SSH session on worker-1:   curl -s localhost:8080/healthz
```
Expect `{"status":"alive"...}`. Stop with Ctrl+C.

## Part 10. Backend configuration

On the control VM:
```
sudo mkdir -p /opt/cloudlab && sudo cp -r ~/cloudlab/backend /opt/cloudlab/
cd /opt/cloudlab/backend && sudo npm ci --omit=dev
sudo chown -R cloudlab:cloudlab /opt/cloudlab
sudo tee /etc/cloudlab/api.env >/dev/null <<EOF
NODE_ENV=production
PORT=5000
TRUST_PROXY=true
PUBLIC_BASE_URL=http://EXTERNAL_IP_OR_DOMAIN       # https://your.domain once you have TLS
CORS_ORIGINS=http://EXTERNAL_IP_OR_DOMAIN
JWT_SECRET=$(openssl rand -hex 32)

DB_CLIENT=mysql
DB_HOST=CLOUD_SQL_PRIVATE_IP
DB_USER=cloudlab
DB_PASSWORD=THE_DB_PASSWORD
DB_NAME=cloudlab

STORAGE_ROOT=/mnt/cloudlab
GCS_BUCKET_NAME=cloudlab-YOURNAME-storage
STORAGE_TOTAL_GB=50

DRIVER=docker
WORKER_1_DOCKER_HOST=ssh://cloudlab@WORKER1_INTERNAL_IP
WORKER_1_IP=WORKER1_INTERNAL_IP
WORKER_2_DOCKER_HOST=ssh://cloudlab@WORKER2_INTERNAL_IP
WORKER_2_IP=WORKER2_INTERNAL_IP

SEED_ADMIN_EMAIL=admin@gbs.edu
SEED_ADMIN_PASSWORD=CHOOSE_A_STRONG_PASSWORD
SEED_DEMO_DATA=false
EOF
sudo chmod 600 /etc/cloudlab/api.env
```
The server refuses to start in production with the default JWT secret, admin password, or `DRIVER=mock`.

Accept the workers' SSH host keys once (as the `cloudlab` user) and test Docker over SSH:
```
sudo -u cloudlab sh -c 'ssh-keyscan -H WORKER1_INTERNAL_IP WORKER2_INTERNAL_IP >> ~/.ssh/known_hosts'
sudo -u cloudlab env DOCKER_HOST=ssh://cloudlab@WORKER1_INTERNAL_IP docker ps
```
That must list containers (empty is fine) without a password prompt.

## Part 11. Create tables and start the API

The schema has so far only been tested on SQLite, **so this is the step most likely to need a fix**: if the migration reports a MySQL error, send me the message.
```
cd /opt/cloudlab/backend
sudo -u cloudlab env $(sudo cat /etc/cloudlab/api.env | xargs) node scripts/seed.js     # creates tables, admin, lab templates
sudo cp ~/cloudlab/infra/cloudlab-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cloudlab-api
sudo systemctl status cloudlab-api --no-pager
curl -s localhost:5000/api/v1/health
```
Logs: `sudo journalctl -u cloudlab-api -f`.

## Part 12. Frontend and nginx

On your PC, in `frontend/`:
```
# .env
VITE_USE_MOCKS=false
VITE_API_BASE_URL=/api/v1
npm install && npm run build
gcloud compute scp --recurse --tunnel-through-iap dist cloudlab-control:~/dist
```
On the control VM:
```
sudo mkdir -p /var/www/cloudlab && sudo cp -r ~/dist/* /var/www/cloudlab/
sudo cp ~/cloudlab/infra/nginx.conf /etc/nginx/sites-available/cloudlab
```
Edit that file: **for a first demo without a domain**, replace the two `server` blocks with a single one that does `listen 80;` and `server_name _;`, and delete the `ssl_*` lines and the redirect block. Then:
```
sudo ln -sf /etc/nginx/sites-available/cloudlab /etc/nginx/sites-enabled/cloudlab && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Open `http://EXTERNAL_IP/` and log in as `admin@gbs.edu`.

**HTTPS (recommended before real students use it).** Get a domain (your college, or a free one at https://www.duckdns.org), point an A record at the control VM's external IP, restore the original `nginx.conf` with your domain, run `sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d your.domain`, then set `PUBLIC_BASE_URL` and `CORS_ORIGINS` to `https://your.domain` and `sudo systemctl restart cloudlab-api`.

## Part 13. Create users and run a real lab

1. Log in as admin → **Users** → create a faculty account and a couple of student accounts (students need roll numbers).
2. Log in as a student → create a **Python lab** (small). Watch the 7 steps; the first start of a lab can take a minute while the container boots.
3. **Open workspace**: you should get a real VS Code in the browser. Create a file, wait 2 seconds (autosave), then in the bucket (console → Storage) check it appeared under `students/<id>/projects/`.
4. Stop the lab, start it again: the file is still there.
5. Admin → **Infrastructure** shows both workers online and slots used.

## Part 14. Acceptance tests before the demo

These prove the BRD claims on real machines (the laptop mock cannot):

| Test | How | Pass when |
|---|---|---|
| Capacity | Create labs until a worker is full (`maxLabsPerWorker`, default 4) | 5th lab goes to the other worker; when both are full the next one is **queued**, the one after that gets `CAPACITY_FULL` |
| Memory fit (BRD "to be tested") | Start 4 standard labs on one worker, run a Python script using ~1.5 GB in each | no VM crash; an over-limit lab is stopped and the student is told why. If labs die, lower `maxLabsPerWorker` in Admin → Policy |
| Idle auto-stop | Admin → Policy → inactivity 15 min; leave a lab untouched | goes **inactive**, then **stopped**; entry appears in the auto-stop log; files remain |
| Isolation | In a lab terminal: `curl -m 3 http://169.254.169.254` and `ping 10.0.0.x` (another VM) | both fail. And `ls /workspace` shows only that student's files |
| Reconciliation | On the worker `docker kill cl-env_...` | within a minute the lab shows stopped |
| Reboot | `sudo reboot` the control VM | API and nginx come back by themselves; running labs are still listed |
| Quota | Upload files past 5 GB (or lower `STORAGE_QUOTA_BYTES` to test) | `STORAGE_QUOTA_EXCEEDED` |

## Part 15. Running costs and housekeeping

* **Stop VMs when not in use:** `gcloud compute instances stop cloudlab-control cloudlab-worker-1 cloudlab-worker-2` (start again with `start`; labs that were running become stopped after the reconcile job). Also stop the Cloud SQL instance (console → Stop) between demo sessions.
* Watch billing: console → Billing → Reports.
* Before the trial ends, export what you need (database dump from Cloud SQL, bucket contents), then delete the project to be sure nothing keeps billing: console → IAM & Admin → Settings → **Shut down**.
* Updating the code later: `git pull` on the control VM, copy `backend` to `/opt/cloudlab`, `npm ci --omit=dev`, `sudo systemctl restart cloudlab-api`; rebuild and copy the frontend `dist` for UI changes.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Lab stays "failed" at *Create container* | `sudo journalctl -u cloudlab-api` shows the docker error. Usually: image not on that worker, SSH host key not accepted, or `docker ps` over SSH fails (Part 10) |
| Lab runs but "Open workspace" shows 502 | Port not reachable from control VM: firewall rule `allow-control-to-workers`, or `WORKER_n_IP` is wrong |
| Workspace loads but files are not saved | Bucket mount missing on that worker (`df /mnt/cloudlab`); check `/etc/fstab` line and `sudo mount -a` |
| Login works but pages say network error | nginx `/api/` block not proxying to port 5000, or `CORS_ORIGINS` wrong |
| API will not start | `journalctl` shows "Unsafe production configuration" — fix the listed env values |
| `gcsfuse` permission errors | VM created without `--scopes=cloud-platform`; stop VM, edit access scopes, start again |

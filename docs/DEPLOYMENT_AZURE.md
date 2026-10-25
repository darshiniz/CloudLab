# Deploying CloudLab on Microsoft Azure (step by step)

Same system as the Google Cloud guide (`DEPLOYMENT.md`), mapped to Azure:

| Piece | Google Cloud version | **Azure version (this guide)** |
|---|---|---|
| 3 VMs, 2 vCPU / 4 GB | e2-medium | **Standard_B2s** (Debian 12) |
| Database | Cloud SQL MySQL | **Azure Database for MySQL – Flexible Server** (Burstable B1ms) |
| Shared file storage | Cloud Storage + gcsfuse | **Storage account (Blob, hierarchical namespace) + blobfuse2** |
| Lab image registry | Artifact Registry | **none**: images are built on worker-1 and copied to worker-2 over SSH |
| Firewall | VPC firewall rules | **Network Security Groups (NSG)** |
| HTTPS name | needed your own domain | **free Azure DNS name** (`<name>.centralindia.cloudapp.azure.com`) |

**Commands were written from Microsoft's documentation but have not been run end to end.** If one fails, read the error, fix it, and carry on. Commands for your **Windows PC are PowerShell**; commands for the VMs are marked **(VM)** and are bash.

## 0. Architecture

```
Internet ─> [control VM: nginx + API + frontend files] ──SSH──> [worker-1: Docker]  \
                  │   └── /lab/<id> proxy ────────────────────> [worker-2: Docker]   > lab containers
                  ├─> Azure Database for MySQL (TLS, firewall allows only the control VM)
                  └─> Blob storage (hierarchical namespace) mounted at /mnt/cloudlab on all 3 VMs (blobfuse2, managed identity)
```

## Part 1. Account and credits

You have two options; pick one.

**A. Azure for Students (best for you):** about **$100 credit valid 12 months**, no credit card in the usual flow, verified with an academic email (your college address). Sign up at https://azure.microsoft.com/free/students (or aka.ms/azure4students). Rules from Microsoft's FAQ: full-time student at an accredited institution, **one subscription per student**, for education/demo use (not production), you can't use the credit on Marketplace items. When the credit or 12 months run out you must upgrade or the resources are removed (90 days to upgrade). If your college email is not recognised, ask the college IT office, or use option B.

**B. Azure free account:** a card is required (use a card with international/online payments enabled). Historically it gives about **$200 for 30 days** plus 12 months of some free services (including a small MySQL flexible server) — **check the current terms at https://azure.microsoft.com/free** before relying on them. You are not charged unless you upgrade to pay-as-you-go.

**Budget reality check.** Prices change; estimate with https://azure.microsoft.com/pricing/calculator. As a rough guide a B2s VM costs about **$30–40/month if left on**, so three VMs plus the database could use **the whole $100 in about one month**. The fix is simple: **stop (deallocate) the VMs and the database whenever you are not working or demoing** (Part 15). Deallocated VMs do not charge for compute, only for disks/IPs.

After signing up:
1. Portal https://portal.azure.com → **Cost Management + Billing → Budgets → Add**: set a budget (e.g. $80) with email alerts at 50 % and 90 %.
2. Install the Azure CLI on your PC (PowerShell): `winget install -e --id Microsoft.AzureCLI`, then **close and reopen PowerShell** and run `az login`. Check: `az account show`.

## Part 2. Resource group and region

Student subscriptions are sometimes restricted to a few regions. Try Central India first; if you get a `RequestDisallowedByAzure` error, use a region the error lists (e.g. `southeastasia`, `uaenorth`) and use it for everything.

```powershell
$RG  = "cloudlab-rg"
$LOC = "centralindia"
az group create -n $RG -l $LOC
```
Check you have enough VM quota (3 VMs x 2 vCPUs = 6 vCPUs):
```powershell
az vm list-usage -l $LOC -o table
```
Look at "Total Regional vCPUs" and "Standard BS Family vCPUs": the limit must be at least 6. If it is lower, request more in portal → Quotas, or use two VMs while developing (see Troubleshooting).

## Part 3. Storage account (shared files)

```powershell
$SA = "cloudlabstore" + (Get-Random -Maximum 99999)     # must be globally unique, lowercase letters+digits
az storage account create -n $SA -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 --hns true --allow-blob-public-access false
az storage container create --account-name $SA -n cloudlab --auth-mode key
echo $SA     # write this name down
```
`--hns true` (hierarchical namespace) gives real folders and fast renames, which the lab IDEs need.

## Part 4. Network, VMs and firewall

```powershell
$DNS  = "cloudlab-" + (Get-Random -Maximum 99999)     # becomes $DNS.centralindia.cloudapp.azure.com
$MYIP = (Invoke-RestMethod https://api.ipify.org)      # your current public IP

az network vnet create -g $RG -n cloudlab-vnet --address-prefix 10.0.0.0/16 --subnet-name main --subnet-prefix 10.0.0.0/24

# control VM (public IP with a free DNS name; no inbound rules yet)
az vm create -g $RG -n cloudlab-control --image Debian:debian-12:12-gen2:latest --size Standard_B2s --vnet-name cloudlab-vnet --subnet main --admin-username azureuser --generate-ssh-keys --public-ip-sku Standard --public-ip-address-dns-name $DNS --nsg-rule NONE --os-disk-size-gb 30 --assign-identity "[system]"

# two workers
foreach ($n in 1,2) { az vm create -g $RG -n "cloudlab-worker-$n" --image Debian:debian-12:12-gen2:latest --size Standard_B2s --vnet-name cloudlab-vnet --subnet main --admin-username azureuser --generate-ssh-keys --public-ip-sku Standard --nsg-rule NONE --os-disk-size-gb 64 --assign-identity "[system]" }

az vm list -g $RG -d --query "[].{name:name, private:privateIps, public:publicIps}" -o table
```
Write down the **private** and **public** IPs. (`--generate-ssh-keys` created a key in `C:\Users\<you>\.ssh`; you log in with `ssh azureuser@<public-ip>` from PowerShell.)

Firewall (NSG) rules. VMs in the same virtual network can already talk to each other, so workers need **no** inbound rule from the internet except your own SSH:
```powershell
az network nsg list -g $RG -o table       # confirm names: cloudlab-controlNSG, cloudlab-worker-1NSG, cloudlab-worker-2NSG
foreach ($nsg in "cloudlab-controlNSG","cloudlab-worker-1NSG","cloudlab-worker-2NSG") {
  az network nsg rule create -g $RG --nsg-name $nsg -n ssh-from-me --priority 100 --access Allow --protocol Tcp --destination-port-ranges 22 --source-address-prefixes $MYIP
}
az network nsg rule create -g $RG --nsg-name cloudlab-controlNSG -n web --priority 110 --access Allow --protocol Tcp --destination-port-ranges 80 443 --source-address-prefixes "*"
```
If your home/college IP changes later, SSH will time out: update the `ssh-from-me` rules (portal → the NSG → Inbound rules).

## Part 5. Let the VMs read the storage (managed identity)

```powershell
$SAID = az storage account show -n $SA -g $RG --query id -o tsv
foreach ($vm in "cloudlab-control","cloudlab-worker-1","cloudlab-worker-2") {
  $principal = az vm show -g $RG -n $vm --query identity.principalId -o tsv
  az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role "Storage Blob Data Contributor" --scope $SAID
}
```
Role assignments can take **up to ~10 minutes** to start working.

## Part 6. Database (Azure Database for MySQL Flexible Server)

```powershell
$DB = "cloudlab-db-" + (Get-Random -Maximum 99999)
$CONTROL_PUBLIC_IP = az vm show -g $RG -n cloudlab-control -d --query publicIps -o tsv
$DBPASS = "Choose-A-Strong-Passw0rd"      # letters, digits, - or _ only (avoid $ and quotes in PowerShell). Keep it secret.

az mysql flexible-server create -g $RG -n $DB -l $LOC --admin-user cloudlabadmin --admin-password $DBPASS --sku-name Standard_B1ms --tier Burstable --storage-size 20 --version 8.0.21 --public-access $CONTROL_PUBLIC_IP --yes
az mysql flexible-server db create -g $RG --server-name $DB --database-name cloudlab
```
`--public-access <ip>` creates a firewall rule that lets **only the control VM** connect. TLS is mandatory on Azure MySQL, which is why the backend has `DB_SSL=true`. The host name is `$DB.mysql.database.azure.com`.

## Part 7. Get the code onto the VMs

Push your repo to GitHub first. Then **(VM)** — connect with `ssh azureuser@<public-ip>` (PowerShell) to each VM and run:
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/YOUR-USERNAME/cloudlab.git
```
(Private repo: use a GitHub personal access token as the password.)

## Part 8. Control VM and worker setup

**(VM) control** — mounts storage, installs Node 22 + nginx + docker CLI, and prints an SSH public key:
```bash
cd cloudlab
sudo STORAGE_ACCOUNT=cloudlabstoreXXXXX bash infra/azure/control-setup.sh
df /mnt/cloudlab        # must show the mount
```
If the mount fails with a permissions error, wait 5–10 minutes (role propagation, Part 5) and run `sudo systemctl restart cloudlab-blobfuse`.

**(VM) each worker** — use the **control VM's private IP** and the public key printed above (all on one line):
```bash
cd cloudlab
sudo -E CONTROL_PUBKEY="ssh-ed25519 AAAA... cloudlab@cloudlab-control" CONTROL_IP=10.0.0.4 STORAGE_ACCOUNT=cloudlabstoreXXXXX bash infra/azure/worker-setup.sh
```
It must end with `metadata service blocked`. (It also blocks Azure's WireServer 168.63.129.16, the virtual network, and lab-to-lab traffic.)

## Part 9. Build the lab images

**(VM) worker-1:**
```bash
cd ~/cloudlab
bash infra/images/build.sh        # builds cloudlab/python:1.0, java:1.0, web:1.0 locally (10–20 min the first time)
docker run --rm -p 127.0.0.1:8080:8080 -v /mnt/cloudlab:/workspace cloudlab/python:1.0
# second SSH session on worker-1:   curl -s localhost:8080/healthz      (expect {"status":"alive"...}); Ctrl+C the first one
```
Copy the images to worker-2 through the control VM (**(VM) control**), after accepting host keys (see Part 10 first command):
```bash
sudo -u cloudlab sh -c "ssh cloudlab@WORKER1_PRIVATE_IP 'docker save cloudlab/python:1.0 cloudlab/java:1.0 cloudlab/web:1.0' | ssh cloudlab@WORKER2_PRIVATE_IP 'docker load'"
ssh azureuser@... (worker-2):  docker images | grep cloudlab      # three images
```

## Part 10. Backend configuration (VM control)

First accept the workers' host keys and test Docker over SSH:
```bash
sudo -u cloudlab sh -c 'ssh-keyscan -H WORKER1_PRIVATE_IP WORKER2_PRIVATE_IP >> ~/.ssh/known_hosts'
sudo -u cloudlab env DOCKER_HOST=ssh://cloudlab@WORKER1_PRIVATE_IP docker ps
```
That must work without a password prompt. Then install the backend and write its settings:
```bash
sudo cp -r ~/cloudlab/backend /opt/cloudlab/ && cd /opt/cloudlab/backend && sudo npm ci --omit=dev
sudo chown -R cloudlab:cloudlab /opt/cloudlab
sudo tee /etc/cloudlab/api.env >/dev/null <<EOF
NODE_ENV=production
PORT=5000
TRUST_PROXY=true
PUBLIC_BASE_URL=http://YOUR-DNS.centralindia.cloudapp.azure.com
CORS_ORIGINS=http://YOUR-DNS.centralindia.cloudapp.azure.com
JWT_SECRET=$(openssl rand -hex 32)

DB_CLIENT=mysql
DB_HOST=YOUR-DB.mysql.database.azure.com
DB_USER=cloudlabadmin
DB_PASSWORD=THE_DB_PASSWORD
DB_NAME=cloudlab
DB_SSL=true

STORAGE_ROOT=/mnt/cloudlab
GCS_BUCKET_NAME=YOUR-STORAGE-ACCOUNT        # only a display label in the admin page
STORAGE_TOTAL_GB=50

DRIVER=docker
WORKER_1_DOCKER_HOST=ssh://cloudlab@WORKER1_PRIVATE_IP
WORKER_1_IP=WORKER1_PRIVATE_IP
WORKER_2_DOCKER_HOST=ssh://cloudlab@WORKER2_PRIVATE_IP
WORKER_2_IP=WORKER2_PRIVATE_IP

SEED_ADMIN_EMAIL=admin@gbs.edu
SEED_ADMIN_PASSWORD=CHOOSE_A_STRONG_PASSWORD
SEED_DEMO_DATA=false
EOF
sudo chmod 600 /etc/cloudlab/api.env
```
Also set the machine type/region shown in the admin page if you want: `MACHINE_TYPE=Standard_B2s`, `GCP_REGION=centralindia` (the variable name is a leftover; it is just a label).

## Part 11. Create tables and start the API (VM control)

The schema has only been tested on SQLite, **so this is the step most likely to need a fix** — if it prints a MySQL error, send it back for a code fix.
```bash
cd /opt/cloudlab/backend
sudo -u cloudlab env $(sudo cat /etc/cloudlab/api.env | xargs) node scripts/seed.js
sudo cp ~/cloudlab/infra/cloudlab-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cloudlab-api
curl -s localhost:5000/api/v1/health
```
Logs: `sudo journalctl -u cloudlab-api -f`.

## Part 12. Frontend, nginx, HTTPS

**(PowerShell)** build the frontend and copy it to the control VM:
```powershell
cd C:\cloudlab\frontend
# .env must contain:  VITE_USE_MOCKS=false   and   VITE_API_BASE_URL=/api/v1
npm install; npm run build
scp -r dist azureuser@CONTROL_PUBLIC_IP:~/dist
```
**(VM control):**
```bash
sudo mkdir -p /var/www/cloudlab && sudo cp -r ~/dist/* /var/www/cloudlab/
sudo cp ~/cloudlab/infra/azure/nginx-http.conf /etc/nginx/sites-available/cloudlab
sudo nano /etc/nginx/sites-available/cloudlab        # replace YOUR-DNS-NAME... with your real DNS name
sudo ln -sf /etc/nginx/sites-available/cloudlab /etc/nginx/sites-enabled/cloudlab && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```
Open `http://YOUR-DNS.centralindia.cloudapp.azure.com/` and log in as `admin@gbs.edu`.

**HTTPS (free, using the Azure DNS name):**
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR-DNS.centralindia.cloudapp.azure.com
sudo sed -i 's#http://YOUR-DNS#https://YOUR-DNS#g' /etc/cloudlab/api.env      # PUBLIC_BASE_URL and CORS_ORIGINS
sudo systemctl restart cloudlab-api
```

## Part 13. First real lab

1. Admin → **Users** → create a faculty and a few students (students need roll numbers).
2. Student → create a **Python lab** (small). Watch the 7 steps.
3. **Open workspace**: real VS Code in the browser. Create a file, wait 2 s, then check it exists in the storage account (portal → Storage account → Containers → cloudlab → `students/<id>/projects/`).
4. Stop and start the lab: the file is still there.
5. Admin → **Infrastructure** shows both workers online.

## Part 14. Acceptance tests

| Test | How | Pass when |
|---|---|---|
| Capacity | Create labs until a worker is full (`maxLabsPerWorker`, default 4) | next goes to the other worker; when both are full the next is **queued**, the one after that gets `CAPACITY_FULL` |
| Memory fit ("to be tested" in the BRD) | 4 standard labs on one worker, each running a ~1.5 GB Python script | no VM crash; over-limit lab is stopped with a clear message. If labs die, lower `maxLabsPerWorker` in Admin → Policy |
| Idle auto-stop | Admin → Policy → 15 min; leave a lab untouched | inactive, then stopped; entry in the auto-stop log; files remain |
| Isolation | In a lab terminal: `curl -m 3 http://169.254.169.254`, `curl -m 3 http://168.63.129.16`, `ping 10.0.0.4` | all fail; `ls /workspace` shows only that student's files |
| Reconciliation | On a worker: `docker kill cl-env_...` | within a minute the lab shows stopped |
| Reboot | `sudo reboot` the control VM | API, nginx and the storage mount come back by themselves |
| Quota | Lower `STORAGE_QUOTA_BYTES`, upload past it | `STORAGE_QUOTA_EXCEEDED` |

## Part 15. Costs and housekeeping

```powershell
# stop paying for compute when you are not using it
az vm deallocate -g $RG -n cloudlab-control
az vm deallocate -g $RG -n cloudlab-worker-1
az vm deallocate -g $RG -n cloudlab-worker-2
az mysql flexible-server stop -g $RG -n $DB          # Azure restarts it automatically after 7 days
# start again
az vm start -g $RG -n cloudlab-control; az vm start -g $RG -n cloudlab-worker-1; az vm start -g $RG -n cloudlab-worker-2
az mysql flexible-server start -g $RG -n $DB
```
Use **deallocate**, not just "shut down" inside the OS: only deallocated VMs stop compute billing. Static public IPs, disks and storage still cost a little. Check **Cost Management → Cost analysis** every few days.
Before the credit ends, export what you need, then delete everything: `az group delete -n $RG --yes` (this removes all resources in the group).
Updating the code later: `git pull` on the control VM, copy `backend` to `/opt/cloudlab`, `npm ci --omit=dev`, `sudo systemctl restart cloudlab-api`; rebuild and copy `dist` for UI changes.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `RequestDisallowedByAzure` / region or size not allowed | Student policy. Use a region/size that the error lists for **all** resources (change `$LOC`); try `Standard_B2s_v2` or `Standard_B2as_v2` if B2s is not offered |
| `QuotaExceeded` for vCPUs | Request a quota increase, or temporarily use 2 VMs: skip worker-2 and set `WORKER_2_DOCKER_HOST=` and disable it in Admin; ask for help adapting this |
| `ssh` times out | Your IP changed: update the `ssh-from-me` NSG rules |
| Blob mount fails | Role not propagated yet (wait, restart `cloudlab-blobfuse`), wrong `STORAGE_ACCOUNT` name, or the storage account was not created with `--hns true` |
| API error about SSL/TLS or "insecure connection" | `DB_SSL=true` missing in `/etc/cloudlab/api.env` |
| API cannot connect to MySQL | Firewall rule allows only the control VM's public IP; re-create with the right IP: `az mysql flexible-server firewall-rule create ...` or edit it in the portal → Networking |
| Lab stuck "failed" at Create container | `journalctl -u cloudlab-api`: usually image missing on that worker (`docker images`), SSH host key not accepted, or `docker ps` over SSH failing |
| Workspace shows 502 | The control VM cannot reach `WORKER_n_IP:port`: wrong private IP in `api.env`, or the lab container is not running |
| Files are not saved | Mount missing on that worker: `df /mnt/cloudlab`, `systemctl status cloudlab-blobfuse` |


---

# Part 2: Elasticity, load balancing and CI (optional extras)

## A. Autoscaler (scale out / scale in worker VMs)

Control VM, once (use your own resource group and VM names):

```bash
PRINCIPAL=$(az vm show -g cloudlab-rg -n cloudlab-control --query identity.principalId -o tsv)
SUB=$(az account show --query id -o tsv)
az role assignment create --assignee-object-id $PRINCIPAL --assignee-principal-type ServicePrincipal \
  --role "Virtual Machine Contributor" --scope /subscriptions/$SUB/resourceGroups/cloudlab-rg
```

Then add to `/etc/cloudlab/api.env`: `CLOUD_PROVIDER=azure`, `AZURE_RESOURCE_GROUP=cloudlab-rg`, `WORKER_1_VM_NAME=...`, `WORKER_2_VM_NAME=...` and `sudo systemctl restart cloudlab-api`.
Open **Admin > Infrastructure > Elasticity**: manual Scale out / Scale in buttons and the Automatic scaling switch.
Rules: scale out when a lab has waited 60 s in the queue and a worker is stopped; scale in when a worker has had no labs for 10 min (at least 1 worker always stays on).

## B. HTTP load balancing (nginx, two API instances)

```bash
sudo bash infra/azure/lb.sh on        # starts API instance 2 (port 5001) and balances 5000/5001 with least_conn
curl -sI https://YOUR-DNS-NAME/api/v1/health | grep -i x-served-by    # repeat: the value changes
sudo systemctl stop cloudlab-api-2    # failover demo: the site keeps working
sudo bash infra/azure/lb.sh off
```

Only instance 1 runs the background jobs (monitor, auto-stop, queue, autoscaler).

## C. CI and deployment

`.github/workflows/ci.yml` runs on every push: backend tests, frontend build, shell script syntax check and the four lab image builds (see the Actions tab on GitHub).
To deploy new code on the control VM: `cd ~/cloudlab && bash infra/deploy.sh`.

# Part 3: Registration, Data Science lab, daily schedule, weekly backup, resource tests

## D. Data Science lab image (once, then after every Dockerfile change)

**(VM) worker-1:**
```bash
cd ~/cloudlab && git pull
LABS=datascience bash infra/images/build.sh        # 10-15 min the first time (Python libraries + R)
```
Copy it to worker-2 (**(VM) control**, same pattern as Part 9):
```bash
sudo -u cloudlab sh -c "ssh cloudlab@WORKER1_PRIVATE_IP 'docker save cloudlab/datascience:1.0' | ssh cloudlab@WORKER2_PRIVATE_IP 'docker load'"
```
Then deploy the new code (`bash infra/deploy.sh`). On first start the existing "Data Science" template switches from "Coming soon" to available by itself.

## E. Self-registration (admin approval)

Nothing to install. Settings in `/etc/cloudlab/api.env` (all optional, defaults shown): `REGISTRATION_ENABLED=true`, `REGISTRATION_EMAIL_DOMAIN=gbs.edu`, `REGISTRATION_MAX_STUDENTS=15`, `REGISTRATION_RATE_PER_MIN=10`. Set `REGISTRATION_ENABLED=false` to close registration (for example after the class is full or after the course).

Because the 15-student cap counts **active + pending** students, the existing demo accounts count too. If you have more than 15 student accounts today the page will say registration is closed; raise `REGISTRATION_MAX_STUDENTS` or deactivate unused accounts.

## F. Daily schedule (08:50 start, 16:55 lab stop, 17:00 shutdown) and weekly backup

**(VM) control**, once:
```bash
cd ~/cloudlab && git pull
sudo bash infra/azure/schedule-setup.sh
```
This turns on the app's scheduled lab shutdown (`SCHEDULED_STOP_ENABLED=true`, 16:55 IST), installs the weekly backup timer (Fridays 16:30 IST, newest 4 archives kept in `/mnt/cloudlab/archive`) and restarts the API. Test the backup straight away:
```bash
sudo systemctl start cloudlab-backup && sudo journalctl -u cloudlab-backup -n 20 --no-pager
ls -lh /mnt/cloudlab/archive
```

**(Windows PowerShell)**, once, to start and stop the VMs themselves:
```powershell
az login
.\infra\azure\vm-schedule.ps1
```
It sets Azure's auto-shutdown to 17:00 IST on all three VMs and creates a small Automation account whose runbook starts them at 08:50 IST Monday to Friday. Run `.\infra\azure\vm-schedule.ps1 -Off` to remove the morning start (holidays, end of the project).

Notes:
* The 17:00 shutdown is a *deallocate*, so the VMs stop costing compute; the morning start needs the Automation account (a few cents a month).
* The app notices VMs started or stopped by the schedule within a minute (scaling log lines with source "schedule"). Worker-2 comes back up at 08:50 even if the autoscaler had switched it off the day before.
* The weekly archive stays in the same storage account (folder `archive/`). It protects against deleted or damaged files, not against losing the whole storage account.
* Database backup is separate: Azure Database for MySQL keeps automatic backups (7 days by default).

## G. Resource limit tests (BRD T-01 to T-05)

See `docs/RESOURCE_TESTS.md`. Manual walk-throughs for assignments, marks, registration and the schedule are in `docs/MANUAL_TESTS.md`.

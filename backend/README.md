# CloudLab backend

Node 22 + Express 5 API for the CloudLab on-demand virtual lab platform. It implements **API Contract v1.0** (all 52 endpoints) and the BRD rules for provisioning, capacity, queueing, auto-stop and storage.
Anything the contract leaves open, or where this code had to choose, is written down in [docs/CONTRACT_NOTES.md](../docs/CONTRACT_NOTES.md).

## Run it on your laptop (no Docker needed)

```bash
npm install
cp .env.example .env          # optional, defaults work
npm run seed                  # creates tables, admin, demo users, labs, sample datasets
npm start                     # http://localhost:5000/api/v1/health
npm test                      # 53 tests, ~15 s
```

`DRIVER=mock` (the default) simulates Docker: labs go through the 7 provisioning steps, "Open workspace" shows a placeholder page. Use `MOCK_STEP_DELAY_MS=2000` to watch the steps slowly.

| Account | Email | Password |
|---|---|---|
| Admin | `admin@gbs.edu` | `admin123` |
| Faculty | `sonia@gbs.edu` | `faculty123` |
| Students | `anushka@gbs.edu`, `darshini@gbs.edu`, `riya@gbs.edu`, `sneha@gbs.edu` | `student123` |

These are the same accounts as the frontend's "try a demo role" buttons.

Frontend: set `VITE_API_BASE_URL=http://localhost:5000/api/v1` and add the frontend origin to `CORS_ORIGINS` (CORS is configured in one place, `src/app.js`).
Postman: import `postman/CloudLab.postman_collection.json`, run **POST /auth/login**, then everything else works (`node scripts/make-postman.js` regenerates it).

## How it fits the architecture

```
Browser ──HTTPS──> nginx (control VM) ──> Node API ──SSH (DOCKER_HOST)──> Worker 1 / Worker 2 (Docker)
                                            │  │                              └ lab containers, ports on internal IP only
                                            │  └── /lab/<envId>/…  authenticated reverse proxy to the lab's IDE (HTTP + WebSocket)
                                            ├── Cloud SQL (MySQL)   [SQLite in development]
                                            └── Cloud Storage bucket mounted at STORAGE_ROOT with gcsfuse (same path on control and workers)
```

| Folder | What is in it |
|---|---|
| `src/routes` | One file per contract section (auth, labs, environments, projects, datasets, usage, faculty, admin) |
| `src/services/environments.js` | The core: slot reservation, FIFO queue, the 7 provisioning steps, stop/start/restart/delete, cancellation |
| `src/drivers` | `DockerCliDriver` (real) and `MockDriver` (dev/tests) behind one interface |
| `src/jobs` | `autostop` (inactive → stop), `reconcile` (DB vs Docker, every 60 s and at boot), `monitor` (node status, alerts, metrics every 30 s) |
| `src/proxy/workspace.js` | `/lab/:envId` proxy: workspace token → HttpOnly cookie, owner check, WebSocket upgrade |
| `src/services/storage.js` | Path safety (no `..`, symlink escapes blocked), 5 GB quota, uploads |
| `src/constants.js` | Every enum from contract section 3, in one place |
| `../infra/` | nginx, systemd, VM setup scripts (iptables rules, gcsfuse), lab Dockerfiles |

### The rules that matter (and where they are enforced)

* **Capacity (BR-09)** – a slot on a worker is reserved inside one database transaction (`forUpdate` on the worker rows) *before* any container exists, so two simultaneous requests can never take the last slot. Full → FIFO queue (max `MAX_QUEUE_LENGTH`) → `503 CAPACITY_FULL`. Stopping/deleting a lab hands its slot to the head of the queue.
* **Isolation (BR-10)** – every container gets `--cpus`, `--memory` = `--memory-swap` (hard limit, no swap), `--pids-limit 256`, `--cap-drop ALL`, `no-new-privileges`, a bridge network with inter-container traffic disabled, a port bound to the worker's internal IP, and only its own `/workspace`, read-only `/data/shared`, and `/data/mine` mounted. `infra/worker-setup.sh` blocks the metadata server and internal ranges from containers.
* **Auto-stop (BR-11)** – activity = a file changed in the student's workspace, CPU ≥ 5 %, or the "Keep running" button. Open-tab heartbeats alone do **not** count. After `inactivityMinutes − 5` the lab becomes `inactive` (warning), then it is stopped and a row is written to the auto-stop log. The session length (`durationMinutes`) is a hard limit. Files are on the bucket, so nothing is lost when a container stops.
* **Reconciliation (FR-21)** – every 60 s and at boot: a lab the DB thinks is running but Docker doesn't → `stopped` (OOM is reported as such); orphan containers are removed; interrupted provisioning → `failed` so Retry works. An unreachable worker is never judged.
* **Security** – bcrypt passwords, JWT HS256 with revocation on logout, deactivated users locked out immediately, `404` (not `403`) for other people's resources, rate-limited login, strict validation (docker image names can't start with `-`), CSV formula escaping, helmet, internal errors never leak details.

## Going to production on GCP (outline)

1. Create: 3 e2-medium VMs (control + 2 workers, asia-south1), Cloud SQL MySQL, a bucket, Artifact Registry.
2. `bash infra/images/build.sh push` (from the repo root) to build and push the three lab images.
3. Workers: `infra/worker-setup.sh`. Control VM: `infra/control-setup.sh`, then follow the printed steps (env file, systemd unit, nginx + certbot).
4. Required env: `NODE_ENV=production`, `DRIVER=docker`, `DB_CLIENT=mysql`, `JWT_SECRET`, `SEED_ADMIN_PASSWORD`, `WORKER_n_DOCKER_HOST/IP`, `PUBLIC_BASE_URL`, `CORS_ORIGINS`. The server refuses to start in production with unsafe values.
5. Run the capacity tests T-01…T-05 from the BRD on a real worker before the demo (see docs/CONTRACT_NOTES.md → "Things only a real worker can answer").

## Tests

`npm test` runs against SQLite + MockDriver: contract shapes and error codes, role matrix, queue/capacity (including 12 simultaneous requests), failure/retry, deletion during provisioning, auto-stop, reconciliation, files/quota/traversal/symlinks, datasets, reports, the workspace proxy, CORS/rate limit, and `DockerCliDriver` command construction against a fake `docker` binary.

## Connecting the frontend

The frontend lives in `../frontend`. Start this backend (`npm run seed && npm start`, port **5000**), then in `frontend/.env` set `VITE_USE_MOCKS=false` and run `npm run dev`. The demo accounts are the same on both sides. See the root README.

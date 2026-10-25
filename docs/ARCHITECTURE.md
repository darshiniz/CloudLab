# Architecture

## The pieces

```
Browser
  │ HTTPS
  ▼
nginx (control VM) ── serves the React build (frontend/dist)
  │  /api/*  ──► Node API (backend/, port 5000)
  │  /lab/*  ──► Node API ──► authenticated reverse proxy ──► the student's lab IDE
  ▼
Node API ──► database (SQLite in dev, MySQL/Cloud SQL in production)
        ──► Docker on worker-1 / worker-2  (docker CLI over SSH: DOCKER_HOST=ssh://cloudlab@<internal-ip>)
        ──► files in a Cloud Storage bucket, mounted with gcsfuse at the same path on control + workers
```

* **3 VMs** (e2-medium, asia-south1): 1 control (nginx + API), 2 workers (Docker + lab containers).
* A **lab** is one Docker container running the code-server IDE (`infra/images/*`). Its port is published on the worker's *internal* IP only; the browser reaches it only through `/lab/<envId>` on the API, which checks a short-lived workspace token and that the lab belongs to the user.
* **Files** (projects, datasets) live in the bucket, so stopping or deleting a container loses nothing.

## Request flow: creating a lab

1. `POST /environments` → validate, then in **one DB transaction** reserve a slot on a worker (rows locked) or join the FIFO queue; no slot and a full queue → `503 CAPACITY_FULL`. Returns `202`.
2. A background routine runs the 7 provisioning steps (validate → check resources → select template → create container → allocate CPU/RAM → mount storage → start) and updates `provisioning.steps` as it goes. The frontend polls `GET /environments/:id` every 2 s.
3. `GET /environments/:id/access` returns the workspace URL; the browser opens it in an iframe; the proxy swaps the token for an HttpOnly cookie and forwards HTTP + WebSocket to the lab.
4. Background jobs keep it honest: **auto-stop** (idle → `inactive` → stopped), **reconcile** (database vs Docker every 60 s), **monitor** (node health, alerts, metrics every 30 s).

## Why these choices

| Decision | Reason |
|---|---|
| Reserve the slot *before* creating the container | Two simultaneous requests can never take the last slot (BRD BR-09) |
| Hard memory limit, no swap; all capabilities dropped; pids limit | One student cannot starve or break others (BR-10) |
| Docker over SSH, ports on internal IP | Docker is never exposed on a network port |
| iptables DOCKER-USER rules | Lab code cannot reach the GCP metadata server (service-account tokens) or the VPC |
| Mock driver | The whole system, including tests, runs without Docker |
| One shared bucket mount | Any worker can run any student's lab; restart on another worker keeps files |

## Where things are

| Concern | File |
|---|---|
| Endpoints | `backend/src/routes/*` (one file per contract section) |
| Provisioning, queue, lifecycle | `backend/src/services/environments.js` |
| Docker commands | `backend/src/drivers/docker.js` (real), `mock.js` (dev/tests) |
| Auto-stop / reconcile / monitor | `backend/src/jobs/*` |
| Lab IDE proxy | `backend/src/proxy/workspace.js` |
| File safety, quota | `backend/src/services/storage.js` |
| Reports, CSV | `backend/src/services/reports.js` |
| Enums (single source) | `backend/src/constants.js` and `frontend/src/constants/enums.js` (must stay identical) |
| Database tables | `backend/src/db/schema.js` |
| Frontend API calls | `frontend/src/services/api.js` (the only place that talks to the backend) |

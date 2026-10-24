# Contract notes

The contract is the law. This file lists every place where the code had to **interpret** it or **add** to it, so the frontend developer can check them and so the contract can be updated first (golden rule 2). Nothing here changes an existing field name, path or enum value.

## A. Additions (proposed change-log rows for contract v1.1)

| # | Addition | Why |
|---|---|---|
| 1 | `429 RATE_LIMITED` for too many login attempts (10/min per IP) | Login brute-force protection. Frontend: show the message. |
| 2 | `POST /environments/:id/heartbeat` accepts an **optional** body `{ "keepRunning": true }` | The "Keep running" button. Plain heartbeats stay body-less and, per BRD BR-11, do **not** count as activity. Only `keepRunning` (or `HEARTBEAT_COUNTS_AS_ACTIVITY=true`) resets the idle timer. |
| 3 | `POST /environments/:id/restart` is also allowed from `failed` | Section 9 step 5 says Retry calls `/restart`, but the status table lists only running/inactive/stopped. |
| 4 | `GET /environments` hides `terminated` labs unless `status=terminated` or `includeTerminated=true` | Keeps lists clean; the frontend never needs them by default. |
| 5 | `status` on `GET /environments` accepts a comma list (`status=running,inactive`) | Convenience; a single value works as in the contract. |

## B. Interpretations

| Topic | What the code does |
|---|---|
| `GET /health` | Returns `{ "data": { "status": "ok", "time": "…" } }` (same envelope as everything else). |
| Heartbeat/access/datasets-mount by admin or faculty | `403 FORBIDDEN` (the contract lists these as **Owner** only). Admin can still start/stop/restart/delete/metrics any lab. |
| Faculty and environments | Faculty can read students' environments, never act on them; a faculty member's own or an admin's labs are `404` to faculty. |
| Lab template limits vs `size` | `size` decides the lab's real resources (small 1 vCPU/1 GB, standard 2 vCPU/2 GB), capped by the template's `limits`. Changing a template affects **new** labs only. |
| `durationMinutes` | A hard session limit: the lab is stopped when it passes, even if active. `autoStopAt` = the earlier of idle limit and session end. |
| Environment `usage` | Live CPU/memory % of the container against its own limits; `0` when not running. |
| Activity `progress` | `assigned` = target students; `inProgress` = students with a live lab on the activity's template created after the activity; `completed` = students who created such a lab and have none live. A proxy until there is a submit action. |
| Activity visibility | Faculty see their own activities; admins see all. |
| `usage/me`, faculty usage | Hours come from `usage_sessions` (one row per running period, closed on stop/delete/restart/crash). `weekStart` is the Monday as `YYYY-MM-DD`. |
| Chart series `t` | ISO timestamp rounded to 5 minutes (last 2 hours, average of both workers). |
| `admin/overview` stats | `activeLabs` = provisioning + running + inactive; `runningContainers` = running + inactive; CPU/memory = average of the online workers; `storagePercent` = bucket usage ÷ `STORAGE_TOTAL_GB`. |
| `admin/analytics` | Counts are for labs **created** inside the range (default: last 30 days); `counts.stopped/terminated` use each lab's current status; top students = top 5 by hours. |
| Worker CPU/memory % | Sum of lab containers (`docker stats`) relative to the VM's cores/RAM, plus a fixed OS/Docker baseline (`WORKER_BASELINE_MEM_MB`, 600). It is an estimate; the control VM uses real OS numbers. |
| `terminalUrl` | Same URL as `workspaceUrl`: the IDE has an integrated terminal. |
| Dataset `mine` | Visible only to the uploader (faculty/admin never see students' private data). Dataset names are unique per scope (per uploader for `mine`). |
| Project delete | Removes the project's folder and files. |
| Per-student limit | At most 3 live labs per student (`409 INVALID_STATE` with a clear message). |
| Validation messages | `details` is a `{ field: message }` map, e.g. `size: "must be small or standard"`. Nested fields use dots (`assignTo.studentIds`). |

## C. Things to know about capacity (read before the demo)

* **Slots, not memory, decide admission.** `maxLabsPerWorker` (default 4) is the only admission limit. Four *standard* labs would ask for 4 × 2 GB = 8 GB on a 4 GB e2-medium. Docker's `--memory` limit is hard, so the kernel kills an over-using container rather than the VM, but under real load labs can be OOM-killed. Options: set `maxLabsPerWorker` to 2 for standard-heavy classes, steer students to `small`, or use e2-standard-2 workers. The reconciler reports OOM kills to the student ("stopped: it used more memory than its limit").
* **Things only a real worker can answer** (BRD tests T-01…T-05): how many labs of each size actually fit, whether code-server idles under the 768 MB figure, gcsfuse write latency for autosave, and time-to-ready after a cold image pull. The mock cannot tell you these.
* gcsfuse is not POSIX: no atomic rename guarantees and slower metadata. Fine for coursework; avoid `node_modules`/`venv` inside `/workspace` for large projects (activity detection already ignores them).

## D. Security decisions worth defending

* Lab ports are published on the worker's **internal** IP only; the browser reaches a lab solely through `/lab/:envId`, which checks a short-lived workspace token (separate from the login token, rejected by the REST API) and that the lab belongs to that user.
* Docker is reached over SSH (`DOCKER_HOST=ssh://cloudlab@internal-ip`), never over an open TCP port. The `cloudlab` key is restricted with `from="<control ip>"`.
* The container's IDE runs with all capabilities dropped; the metadata server (169.254.169.254) and VPC ranges are blocked by iptables in `DOCKER-USER`. Test: `docker run --rm --network cloudlab-labs curlimages/curl -m 3 http://169.254.169.254/` must fail.
* The API process has no write access to anything except its data folder and the mounted bucket.

## E. Frontend integration (checked against the frontend's mock server)

The frontend's `src/mocks/server.js` was run next to this backend and the JSON shapes of ~30 requests compared per role: identical, apart from the points below.

* **Lists always carry `meta`** (`{page,pageSize,total}`), including labs, projects, files, datasets and activities (default pageSize 100 for those, like the mock). The Datasets page reads `meta.total`.
* **"Coming soon" templates** are `enabled: true, comingSoon: true` (as in the frontend mock data); creating a lab on one returns 422.
* **Idle timer vs heartbeat.** The frontend's Policy page says an open workspace "sends a heartbeat" that keeps a lab running, but BRD BR-11 says an open tab alone is not activity. This backend follows the BRD: the automatic 60 s heartbeat does not reset the idle timer; the "I'm still here" button must send `POST …/heartbeat` with `{ "keepRunning": true }` (already applied in `frontend/`). Alternative if the team prefers the simpler rule: set `HEARTBEAT_COUNTS_AS_ACTIVITY=true` and no frontend change is needed (an abandoned open tab then keeps a lab alive until its session time ends).
* **The Workspace page showed a fake editor.** With the real backend it needs an iframe on `access.workspaceUrl` (already applied in `frontend/`). In dev the page (`:5173`) and the lab (`:5000`) are the same *site*, so the lab cookie works inside the iframe; in production nginx serves both from one origin.
* The Policy page text says "after 10 min with no heartbeat it becomes inactive"; the backend's warning window is the last 5 minutes before the idle limit (`INACTIVE_WARNING_MINUTES`).
* Demo accounts match the frontend's login page: `anushka@gbs.edu`/`student123`, `sonia@gbs.edu`/`faculty123`, `admin@gbs.edu`/`admin123`.

# Development guide

## Setup
Node 22.13+ (24 works). Nothing is compiled. See the root README for the two-terminal start.

## Mock vs real backend
`frontend/.env`: `VITE_USE_MOCKS=true` (frontend only, fake data), `false` (real backend), or a list such as `projects,datasets` to mock only those modules.
Backend: `DRIVER=mock` simulates Docker; `DRIVER=docker` uses real Docker (needs `WORKER_n_DOCKER_HOST` or a local Docker).

## Demo accounts (development seed only)
`anushka@gbs.edu` / `student123`, `sonia@gbs.edu` / `faculty123`, `admin@gbs.edu` / `admin123`. In production set `SEED_DEMO_DATA=false` and create users from the admin screen.

## Tests
`cd backend && npm test` (about 15 s). They cover contract shapes, roles, capacity and queue, failures, auto-stop, reconciliation, files and quota, the lab proxy, and the Docker command builder (against a fake `docker`). Add a test for every bug you fix.

## Changing the API
API Contract v1.0 is the law: change `docs/reference/` first, add a change-log row, tell the other person, then change code on both sides. Enum values live in two identical files (see ARCHITECTURE.md).

## Useful scripts
* `npm run seed` (idempotent), `npm run migrate`
* `node scripts/make-postman.js` regenerates `backend/postman/CloudLab.postman_collection.json`
* Delete `backend/data/` to reset the local database and files.

## Conventions
camelCase JSON, prefixed ids (`usr_`, `env_` …), errors as `{error:{code,message,details}}`, lists as `{data,meta}`, long actions return `202` and are polled.

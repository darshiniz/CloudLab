# CloudLab

Cloud-Based On-Demand Virtual Lab Provisioning Platform (Goa Business School, MCA).
Students request a lab (Python, Java, Web); the platform starts an isolated Docker container on one of two worker VMs and opens a browser IDE for it. Idle labs stop automatically, files live in Cloud Storage.

```
cloudlab/
├─ frontend/   React + Vite + Tailwind app (student / faculty / admin screens)
├─ backend/    Node + Express REST API: auth, provisioning, queue, auto-stop, storage, reports
├─ infra/      Deployment: nginx, systemd, VM setup scripts, lab Docker images (code-server)
└─ docs/       CONTRACT_NOTES.md (where the backend interprets or extends API Contract v1.0)
```

The API Contract v1.0 is the agreement between `frontend/` and `backend/`; change it first, then the code.

## Run everything on your laptop (no Docker, no cloud)

Needs Node 22.13 or newer (Node 24 works too). Nothing has to be compiled. Two terminals:

```bash
# terminal 1: backend on http://localhost:5000
cd backend
npm install
npm run seed
npm start

# terminal 2: frontend on http://localhost:5173
cd frontend
cp .env.example .env        # then set VITE_USE_MOCKS=false
npm install
npm run dev
```

Open http://localhost:5173 and use a demo button, or log in with:

| Role | Email | Password |
|---|---|---|
| Student | `anushka@gbs.edu` | `student123` |
| Faculty | `sonia@gbs.edu` | `faculty123` |
| Admin | `admin@gbs.edu` | `admin123` |

Locally the backend uses a simulated Docker (`DRIVER=mock`): labs go through the 7 provisioning steps and the workspace shows a placeholder page. With `VITE_USE_MOCKS=true` the frontend ignores the backend completely and uses its built-in fake data.

## Tests

`cd backend && npm test` (53 tests, about 15 s, no Docker needed).

## Deploying to Google Cloud

1. 3 e2-medium VMs in asia-south1 (control + 2 workers), Cloud SQL (MySQL), a Cloud Storage bucket, Artifact Registry.
2. Build and push lab images (repo root): `REGISTRY=asia-south1-docker.pkg.dev/PROJECT/cloudlab bash infra/images/build.sh push`
3. Each worker: `infra/worker-setup.sh`. Control VM: `infra/control-setup.sh` and follow its printed steps.
4. Frontend: `cd frontend && npm run build`, copy `dist/` to `/var/www/cloudlab` on the control VM (served by `infra/nginx.conf`).

Details, security rules and capacity caveats: [backend/README.md](backend/README.md) and [docs/CONTRACT_NOTES.md](docs/CONTRACT_NOTES.md).

## Team

Anushka Marcelo (25P0320011) · Darshini Zoraunkar (25P0320018)

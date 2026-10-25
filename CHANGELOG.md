# Changelog

## 0.1.0 - first commit
* Frontend (React/Vite/Tailwind): student, faculty and admin screens with a built-in mock backend.
* Backend (Node/Express): all 52 endpoints of API Contract v1.0, provisioning engine with slot reservation and FIFO queue, auto-stop, reconciliation, monitoring, lab IDE proxy, file/dataset storage with quota, reports and CSV export. 53 automated tests.
* Frontend integration: "I'm still here" sends `keepRunning`; the Workspace page embeds the real IDE when the backend is real.
* Infra: nginx, systemd unit, control/worker setup scripts, code-server lab images (Python, Java, Web).
* Verified locally with the simulated Docker driver only. Real Docker, gcsfuse and GCP are **not yet tested** (see docs/DEPLOYMENT.md).

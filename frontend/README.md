# CloudLab Frontend

React frontend for **CloudLab, the Cloud-Based On-Demand Virtual Lab Provisioning Platform**.
It follows the **CloudLab Frontend Build Guide** (design system and Prompts 0–4) and the **CloudLab API Contract v1.0**.

It runs on mock data out of the box. When the Express backend is ready, you switch modules over one at a time with a single setting (see [Connecting the real backend](#connecting-the-real-backend)).

---

## Run it

Install [Node.js 20+](https://nodejs.org) first, then:

```bash
npm install
npm run dev
```

Open **http://localhost:5173**.

| Role | Email | Password |
|---|---|---|
| Student | `anushka@gbs.edu` | `student123` |
| Faculty | `sonia@gbs.edu` | `faculty123` |
| Admin | `admin@gbs.edu` | `admin123` |

The **Student / Faculty / Admin** buttons on the login page sign you in with one click.

- The other students (`darshini@`, `riya@`, `priya@`, …) also use `student123`.
- `vaishnavi@gbs.edu` is a deactivated account, so you can show the "account deactivated" error.

> **Windows "Part of this app has been blocked" popup?** `package.json` already swaps Rollup for its WebAssembly build (`overrides`), so Smart App Control has nothing to block. If you see the popup anyway, delete `node_modules` and `package-lock.json`, then run `npm install` again.

### Demo data

- **Refreshing keeps your data.** Labs, users and files you create are saved in the browser, so F5 doesn't lose them.
- **Reset demo data** in the profile menu (top right) puts everything back to the starting data. It also resets on its own after 12 hours.
- **The cluster starts at 7 of 8 slots used.** Your first new lab provisions, and the next one is queued.

---

## Demo script (about 3 minutes)

This follows the acceptance demo on the MVP slide.

1. **Landing page:** scroll through it. The terminal types, the "How it works" line draws itself, and the counters count up.
2. **Student:** log in.
   - The overview shows the **"Java OOP Lab auto-stops in 8 min due to inactivity"** warning.
   - **Lab Catalog → Python Development → Create Lab.** Name it, pick Standard, and click Create.
   - Watch the **7-step provisioning stepper** tick off and end on **Running → Open workspace**.
3. **Workspace:** file explorer, code editor, terminal (type `help`, `ls /data/shared`, `nproc`), session timer, live CPU/RAM/disk meters, and a Stop button.
4. **Queued state:** create one more lab. You'll see **"All servers are at capacity. You are #1 in the queue."**
5. **Failed state:** put the word **"fail"** in a lab name. Provisioning stops at "Create container" and shows **Retry**.
6. **Admin:** log in in another browser (or a private window).
   - **Infrastructure** shows the Control VM, Worker VM 1 and Worker VM 2 slot gauges, the queue, and the Cloud Storage folders.
   - **Active Environments** shows your new lab live, with resource-hungry rows highlighted.
7. **Admin, Inactivity Policy:** move the slider and save. The change appears in **System Settings → Audit log**.
8. **Faculty:**
   - **Students:** click a row to open the side drawer.
   - **Assign Activity:** create an activity and see its progress bar.

---

## What's in it

| Area | Views |
|---|---|
| **Public** | Landing page (all 10 sections from Prompt 1), Login (split layout, animated terminal, demo role picker, validation, error toasts) |
| **Student** `/student` | Overview, Lab Catalog, Create Lab modal (sizes, duration, Requested → 7-step stepper, failed and queued states), My Labs (cards or table, Start/Stop/Restart/Delete/Open, inactivity warning, Deleted tab for terminated labs), **Workspace** `/student/workspace/:id`, Projects & Files (browse, upload, download, delete, storage meter), Datasets (shared + mine, mount in lab, upload), Usage (area chart + donut) |
| **Faculty** `/faculty` (teal) | Overview, Students (searchable table + read-only drawer), Lab Templates (read-only), Assign Lab Activity (form + progress), Datasets (upload CSV, courses, delete), Usage Monitor (sessions table + charts), and the "view and assign only" banner |
| **Admin** `/admin` (violet) | Monitoring overview (count-up stat cards with sparklines, CPU/memory line chart, lab-state donut, alerts), Infrastructure (3 VMs, slot gauges, 8-slot cluster, admission queue, Cloud Storage), Active Environments, User Management (role chips, status toggle, add user, change role), Lab Templates (create/edit, enabled toggle), Inactivity Policy (slider 15–120, toggle, max labs per worker, rule preview, auto-stop log), Usage Analytics (+ CSV export), System Settings (region, defaults, audit log) |

### Build Guide "must show" checklist

- [x] Second worker VM: Control/API VM, Worker VM 1 and Worker VM 2, each with 4 lab slots
- [x] Datasets page for students and faculty, with shared read-only and private folders mounted at `/data`
- [x] Queue message: "All servers are at capacity. You are #N in the queue."
- [x] Inactivity warning: "Auto-stops in 8 min due to inactivity."
- [x] Lab states: Requested, Provisioning, Running, Inactive, Stopped, Failed, Terminated (plus Queued, from the contract)
- [x] Python, Java and Web Development active; Data Science and Cloud Computing shown as "Coming soon"
- [x] The same look on every page, works on phones, correct badge colours, every sidebar link has a page, mock data in `/mocks`, smooth animations that respect *reduce motion*

---

## Project structure

```
src/
├── constants/enums.js        ← Contract §3 enums + error codes + allowed status moves. COPY THIS FILE TO THE BACKEND.
├── services/api.js           ← The ONLY place that calls the backend (Contract golden rule 4). One function per endpoint.
├── mocks/
│   ├── data/*.js             ← Mock records in the exact shapes of Contract §5 (User, LabTemplate, Environment, …)
│   └── server.js             ← Fake backend: same paths, envelope, errors, roles and status moves as the contract
├── context/                  ← AuthContext (login, /auth/me, auto-logout on 401), ToastContext (central error handler)
├── hooks/                    ← useQuery (load + poll), useAction (button actions + error toast), useCountUp, useAccent
├── config/navigation.js      ← Sidebar links for each role
├── components/
│   ├── ui/                   ← Reusable: Button, Card, StatusBadge, ResourceBar, StatCard, Sparkline, DataTable,
│   │                           EmptyState, Skeleton, Modal, Drawer, Tabs, Form fields, Dropzone, Banner, RoleBadge…
│   ├── layout/               ← DashboardLayout (shared by all 3 roles), Sidebar (collapsible), Topbar, Logo, ProtectedRoute
│   ├── labs/                 ← LabCard, EnvironmentCard, CreateLabModal, ProvisioningStepper, InactivityWarning, LabIcon
│   ├── charts/               ← Area, Line, Bar and Donut charts with one dark theme (Recharts)
│   └── landing/              ← AnimatedTerminal
├── pages/public | student | faculty | admin
└── tailwind.config.js        ← Design tokens from Prompt 0 (colours, fonts, glow)
postman/CloudLab_API_v1.postman_collection.json  ← All 52 endpoints for testing the backend (Contract §10)
```

**Reusable components:** every dashboard uses the same `DashboardLayout` (sidebar + top bar + footer). Only the `role` prop changes, which switches the links and the accent colour (Student blue `#3B82F6`, Faculty teal `#14B8A6`, Admin violet `#8B5CF6`).

---

## Connecting the real backend

Copy `.env.example` to `.env` and edit it:

```bash
VITE_API_BASE_URL=/api/v1   # Vite forwards /api to http://localhost:5000 (vite.config.js)
VITE_USE_MOCKS=true         # true = all mocked, false = all real, or a list of modules that STAY mocked
```

Contract §10 says to connect one module at a time, in this order: auth → labs → environments → projects → datasets → usage → faculty → admin. For example, once auth and labs work on the backend:

```bash
VITE_USE_MOCKS=environments,projects,datasets,usage,faculty,admin
```

Restart `npm run dev` after changing `.env`.

What the frontend expects from the backend (all from the contract):

- `{ "data": …, "meta": { page, pageSize, total } }` on success and `{ "error": { code, message, details } }` on errors.
- The `X-Request-Id` header on every response. It shows up in error toasts.
- `Authorization: Bearer <JWT>` is sent on every call. A 401 logs the user out.
- Create, start and restart return **202**. The frontend polls `GET /environments/:id` every 2 s.
- The workspace sends `POST /environments/:id/heartbeat` every 60 s.

---

### Testing the backend with Postman

Import `postman/CloudLab_API_v1.postman_collection.json` into Postman (or Thunder Client in VS Code) and run a **Login** request first. It saves the token for every other request. Each request automatically checks the `{ data }` / `{ error }` envelope and the `X-Request-Id` header. `baseUrl` defaults to `http://localhost:5000/api/v1`.

---

## Contract issues to settle (for the change log, §12)

Found while building. Each needs a decision from both of you:

1. **Retry after a failure.** §9 says Retry calls `POST /environments/:id/restart`, but the §7.3 table only allows restart from running/inactive/stopped. The frontend (and mock) also allow it from **failed**. Suggest adding `failed` to the restart row.
2. **`durationMinutes`** is sent in `POST /environments` but isn't in the Environment model, so the UI can't show it back. Either add `durationMinutes` to the model or use it only to set `autoStopAt`.
3. **When a lab becomes `inactive`.** The contract says "based on the Policy" but not when. The mock marks it inactive after 10 idle minutes and stops it at `inactivityMinutes`. Agree on the real rule.
4. **The Build Guide's example numbers** (e.g. "Active labs 42") don't fit 2 workers × 4 slots. The dashboards show live numbers instead, which stay consistent with 8 slots.
5. **`GET /activities/mine`** (students seeing assigned activities) is listed as a gap in §8 and isn't built.
6. **No password reset endpoint.** `PATCH /admin/users/:id` can't change a password. Probably needed for the demo.

---

## Tech

React 18 + Vite 5, Tailwind CSS 3, Framer Motion, Lucide icons, Recharts, React Router 6.
Fonts: Inter (UI) and JetBrains Mono (terminal, code, IDs), loaded from Google Fonts.

`npm run build` creates a production build in `dist/`. Nginx serves it on the Control VM.

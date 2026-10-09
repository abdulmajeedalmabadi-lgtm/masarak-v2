# MASARAK | مسارك

A mobile-first Arabic indoor hospital navigation application, with a React patient experience and role-protected reception, clinic and administrator workspaces. Navigation is deterministic A* over a two-floor corridor graph; location is explicitly confirmed through QR checkpoints or known manual locations. Optional phone sensors estimate walking progress experimentally; QR remains authoritative for arrival. It does not claim precise indoor GPS, clinical acuity assessment, or regulatory compliance.

## Requirements

- Node.js **22.12+**, npm, PostgreSQL 16+ (or Docker for the included database compose file).
- A camera requires HTTPS, except localhost. Browser speech, notifications and vibration depend on device support and permission.
- No paid service or AI provider is required.

## Start with PostgreSQL

```sh
npm ci
cp .env.example .env
```

PowerShell: `Copy-Item .env.example .env`. Set a private `DATABASE_URL`, `JWT_SECRET` (at least 32 cryptographically random characters), and `DEMO_PASSWORD` (at least 12 characters). Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Never commit these values.

For Docker: supply a private `POSTGRES_PASSWORD` in `.env`, update `DATABASE_URL` to match, then run `docker compose up -d db`. For an existing database, grant the application schema rights to its dedicated database user.

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Web: [http://localhost:5173](http://localhost:5173). API health: [http://localhost:4000/api/health](http://localhost:4000/api/health). The development proxy supplies `/api` and Socket.IO; frontend production URLs are configured through `VITE_API_URL` or a same-origin reverse proxy.

Seeding refuses a nonempty staff database and creates three fictional journeys, three waiting tickets, all hospital map data and these accounts:

| Username | Role | Clinic |
|---|---|---|
| `admin.demo` | Administrator | All |
| `reception.demo` | Reception | — |
| `triage.demo` | Clinical staff | Triage 104 |

All seed accounts use the **private password you supply in `DEMO_PASSWORD`**. No working credentials are distributed. Deactivate demo accounts and replace them with individual staff accounts before a real installation.

## Local demonstration without PostgreSQL

For a new checkout without `.env`, run `npm run demo:setup` to generate a private local `.env` with random secrets automatically. Read `DEMO_PASSWORD` from that local file to sign in. Alternatively set `STORAGE_MODE=file-demo` manually and keep `NODE_ENV=development`, supplying your own `JWT_SECRET` and `DEMO_PASSWORD`. Then run `npm run db:generate`, `npm run db:seed`, and `npm run dev`. Data persists in `.data/demo.json`. This is a single-process demonstration adapter, explicitly blocked in production, and **not PostgreSQL**. An initial PostgreSQL deployment uses a fresh seed; it does not automatically import this JSON file.

## Complete demo walkthrough

1. Open the staff portal `/staff`, sign in as reception, choose any ordered subset of destinations, and create a journey. Display alias is sufficient; no medical or identity information is required.
2. Open the generated access link in a separate patient tab or scan its QR. Links expire after 24 hours. Arabic and light theme are the initial defaults. Change language, contrast, font size, audio or accessible route preferences in onboarding/settings.
3. Open navigation to Triage 104. The map displays reception, the destination, a valid corridor path, distance and walking estimate. Pan, zoom, or select either floor.
4. Simulate a wrong turn: choose **I am lost → Scan QR → QR checkpoint test**, select Laboratory. The server changes location and A* recalculates the route. In a real hospital, scan the printed checkpoint QR instead. Manual map selection and reception assistance also work.
5. Update the location to Triage entrance by checkpoint QR. Navigation now shows arrival. Confirm arrival to join the queue. Repeated confirmation does not duplicate the ticket.
6. In the clinic staff workspace, set clinic status, manage priorities and call the next eligible patient. Three seeded demo patients initially precede a newly created patient; complete them or explicitly assign the new ticket a higher clinical priority for a test. Priorities are staff decisions, not automated emergency classification.
7. The patient receives a real-time visual call and a five-minute timer. Browser notifications and optional foreground audio/vibration are permission-dependent. Request extra time; staff see that request and can extend or recall. Expiry flags the ticket for staff; it does not automatically remove the patient.
8. Staff confirm arrival, start consultation, then complete the stage. The next assigned destination activates; accessible inter-floor navigation uses the elevator.
9. Administrators can manage QR checkpoints with dedicated add/edit/delete forms, preview their floor/map locations, download PNG/SVG and print one/all stations. The map editor also manages floors, rooms, departments, corridor rectangles, nodes and edges. The reference hospital has two corridors and connecting passages on each floor, with 37 checkpoints including stairs. See `docs/QR-NAVIGATION.md` and `docs/MAP.md`.

## Commands and project layout

```sh
npm test
npm run build
npm start
```

`npm start` runs the production API bundle only; serve `dist/` separately as documented in `DEPLOYMENT.md`.

| Directory | Purpose |
|---|---|
| `src/` | React Router screens, interactive SVG, preferences and six-language UI |
| `shared/` | Typed hospital map and A* graph engine |
| `server/` | REST API, JWT authorization, queue state machine, Socket.IO, persistence, future AI contract |
| `prisma/` | Relational PostgreSQL schema, migration, fictional seed |
| `tests/` | Algorithm and complete HTTP/socket workflow tests |
| `public/` | PWA shell, manifest and icon |
| `docs/` | Architecture, map contract, API and validation evidence |

## Practical limits

- The app is a functional reference implementation for a fictional hospital. Before real patient use, survey and validate the actual floor plan and accessible routes with hospital staff.
- There is no continuous positioning. Instructions advance only when a checkpoint or manual location changes.
- Wait times use the visible number of preceding tickets × four minutes, not an AI prediction. Walking estimates use constant speed and include a simple fixed inter-floor edge cost.
- Built-in notifications are foreground in-app/browser notifications. Optional background Web Push requires VAPID configuration; see `DEPLOYMENT.md` if configured.
- The PostgreSQL persistence adapter keeps a single application instance's state in memory and commits changes transactionally. Run one API replica; distributed concurrency, incremental queries and retention jobs are future hardening tasks.
- Staff sessions are short-lived bearer tokens (8 hours), stored in the browser session. Deactivation invalidates subsequent HTTP/socket authentication. Add organizational SSO, MFA and session revocation before operational rollout.
- Referenced rooms/nodes are edited or added rather than physically deleted, preserving historical references. Admin map edits are audited. Room geometry must match the map contract.
- The offline shell never caches API responses or access tokens. Live journeys require a connection. No external AI is integrated. No privacy/security certification is claimed.

See `docs/VALIDATION.md` for what was actually executed and what could not be verified in the delivery environment.

## 3D patient navigation (v1.2)

Start navigation opens current-location selection; selecting a valid node enters a first-person 3D corridor automatically. QR correction, lost recovery, and separate demo controls share the existing journey and A* route. See [NAVIGATION-3D.md](docs/NAVIGATION-3D.md) for the test flow, arrival rules, changed files and verification limits.

## Hybrid navigation (v1.3)

Explicit motion/orientation permission, experimental calibrated step detection, graph interval progress with junction/floor stops, three isolated navigation modes, automatic destination-QR arrival, and live clinic/queue status extend the existing application. See [HYBRID-NAVIGATION.md](docs/HYBRID-NAVIGATION.md) for service design, permissions, limitations, physical-device checklist and verification.

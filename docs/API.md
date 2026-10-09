# REST API

All protected endpoints accept `Authorization: Bearer <token>`. Errors return `{error: translationKey}`. Map validation errors include diagnostic codes after `mapInvalid:`; the patient-facing UI localizes the category. Requests are validated with Zod, and role checks run server-side.

| Method / path | Scope | Behavior |
|---|---|---|
| GET `/api/health` | Public | Startup/storage health |
| GET `/api/map` | Public | Published fictional map |
| POST `/api/login` | Public, rate-limited | Username/password → eight-hour staff token |
| GET `/api/staff` | Staff | Role-filtered journeys/tickets, clinic status, assistance, aggregate stats |
| POST `/api/journeys` | Reception/admin | `{alias, rooms: string[], accessible}` → journey/token/link |
| GET `/api/journeys/:id/link` | Reception/admin | Link for nonexpired journey |
| POST `/api/journeys/:id/destinations` | Reception/admin | Replace active/pending stages with `{rooms}`; retain history |
| GET `/api/journey` | Patient | Own journey, active ticket, clinic status, own notifications, wait estimate |
| POST `/api/location` | Patient | `{checkpoint}` (ID, structured payload or application URL) or `{nodeId}` → confirmed position, metadata, fresh A* route, steps, rerouted flag |
| POST `/api/accessibility` | Patient | `{accessible}` route preference |
| GET `/api/route` | Patient | Route from own location to active stage |
| POST `/api/arrival` | Patient | Require entrance location; idempotent queue join/arrival |
| POST `/api/assistance` | Patient | Send reception assistance request |
| POST `/api/assistance/:id/resolve` | Reception/admin | Resolve help request |
| POST `/api/extra-time` | Patient | Flag own called ticket for staff |
| PUT `/api/clinics/:id` | Assigned clinic/admin | `{status: available|busy|closed|waiting|ready}` |
| POST `/api/clinics/:id/call` | Assigned clinic/admin | Call highest staff-assigned priority waiting ticket |
| POST `/api/tickets/:id/action` | Assigned clinic/admin | `{action: arrived|start|complete|missed|recall|extend|priority|notify, priority?, nextRoom?}` |
| GET `/api/qr?value=...` | Reception/admin | QR PNG data URL; no sensitive patient details |
| PUT `/api/admin/map` | Admin | Validate graph/map and publish incremented version |
| POST `/api/admin/staff` | Admin | `{username,password,role,roomId?}`; hashes password |
| POST `/api/admin/staff/:id/toggle` | Admin | Activate/deactivate other staff account |
| GET `/api/checkpoints/:id` | Public | Public hospital location metadata only |
| GET `/api/admin/checkpoints` | Reception/admin | All checkpoint metadata |
| POST `/api/admin/checkpoints` | Admin | `{id,nodeId,names?}` → checkpoint derived from graph node |
| PUT `/api/admin/checkpoints/:id` | Admin | `{nodeId,names?}` → move/rename; printed ID remains stable |
| DELETE `/api/admin/checkpoints/:id` | Admin | Remove station without removing graph node or journey position |
| GET `/api/admin/checkpoints/:id/qr` | Reception/admin | Checkpoint, application URL, 600px PNG data URL and SVG |
| GET `/api/admin/checkpoints/print/all` | Reception/admin | Printable code bundle for all current stations |

Socket.IO handshake: `auth: {token}`. `update` contains no sensitive state. A patient can never request arbitrary journey rooms through a client-provided channel name. Credentials are rechecked every 30 seconds for connected sockets.

### Arrival evidence (v1.2)

POST /api/arrival additionally requires journey.confirmedCheckpointId to resolve to an existing checkpoint at the active destination node. A manual map selection clears checkpoint confirmation and cannot confirm arrival. The endpoint and response shape remain the same.

### Hybrid arrival and clinic pause (v1.3)

POST /api/arrival accepts optional `{ "stageId": "active-stage-id" }`. Unknown/non-active stages are rejected; a previously completed stage returns `{ "completed": true }` without advancing a later destination. Existing calls with `{}` remain supported. Destination QR evidence is required for active-stage arrival. Serialized mutation handling and existing active-ticket lookup prevent duplicate clinical tickets. PUT /api/clinics/:id also accepts `paused`; closed/paused clinics cannot call a new patient. GET /api/journey exposes the existing clinic, ticket, ahead and waitMinutes fields; Socket.IO update refreshes the arrival screen. Sensors never update server location.

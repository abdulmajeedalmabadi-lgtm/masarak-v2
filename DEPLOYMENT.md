# Deployment preparation (no deployment performed)

## Environment

Use Node.js 22.12+, PostgreSQL 16+, HTTPS and separate private database credentials. Supply:

- `NODE_ENV=production`
- `STORAGE_MODE=postgres`
- `DATABASE_URL` with your managed PostgreSQL endpoint and its provider-required TLS parameters (e.g. `sslmode=require`)
- `JWT_SECRET`: generated random 48-byte secret; do not reuse examples
- `PUBLIC_APP_URL=https://your-frontend.example`
- `CORS_ORIGINS=https://your-frontend.example` (comma-separated exact trusted origins)
- `PORT`: hosting-assigned API port
- `VITE_API_URL=https://your-backend.example` **at frontend build time**, or blank if reverse proxying both API and Socket.IO through the frontend origin
- `DEMO_PASSWORD`: used only for a deliberately requested fictional seed; remove after seeding

Never put a server secret in any `VITE_*` variable. QR codes carry only checkpoint IDs or expiring bearer access links, not patient personal information.

## Database setup

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
```

Migration SQL is provided under `prisma/migrations`. `migrate deploy` executes it against the configured PostgreSQL database. Take a database backup before applying later schema changes. Seed only a new demonstration database; create actual hospital data and staff accounts deliberately for operational use.

## Frontend (e.g. Vercel)

Build: `npm ci && npm run db:generate && npm run build`. Output directory: `dist`. Configure an SPA rewrite so unknown frontend routes serve `/index.html`; keep API proxy paths separate when using same-origin hosting. `vercel.json` supplies the frontend fallback only. Provide `VITE_API_URL` at build time for a separate Render backend. Do not deploy the Node API to a static frontend service.

## Backend (e.g. Render)

Run a persistent Node web service, **one instance**, rather than a request-scoped function. Build using the same commands; start `npm start`. Provide all server environment variables privately. Set health check to `/api/health`. Run `npm run db:migrate` in a controlled release job before serving traffic. Socket.IO needs WebSocket support; long polling is also enabled. Trust-proxy settings must be configured to the actual ingress topology before enabling IP-based production rate limits behind a proxy.

Do not set `STORAGE_MODE=file-demo` in production: startup refuses it. The API intentionally fails early when credentials are missing or the database is not seeded.

## Security and operations before real use

The code includes password hashing, scoped JWT access, role/clinic authorization, validated writes, rate limiting, helmet, audit records, expiring journey links and transactional saves. These do not by themselves establish compliance with Saudi privacy or health-sector security requirements. Perform an organizational assessment, define retention/deletion policies, add monitoring and backup restore drills, verify accessible surveyed maps, remove demonstration accounts, and provision individual staff credentials. Do not use aliases to store sensitive medical information.

Camera, notification permissions, speech and vibration should be tested on the actual target phones. Restrict allowed browser origins; configure the hosting platform's frontend CSP for the API, Socket.IO endpoint, fonts and camera needs. The Google Fonts request has a system-font fallback; self-host Cairo if network-independent fonts are needed.

## Optional background Web Push

Generate private VAPID keys locally with `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:your-operations-address@example.com` on the backend. Never include the private key in frontend variables or source. The `/api/push/key` endpoint exposes only the public key. Use a production frontend build served under HTTPS so its service worker is installed; the development build does not register a service worker. Patient Settings → Enable browser notifications asks permission and creates a journey-bound push subscription. The backend sends only a localized turn title and an app path, with no alias or medical details. Allowed push hosts are Google's FCM, Mozilla's push service and Apple's web push service; new providers require explicit reviewed allowlist changes. Push delivery failures leave the in-app notification available. Background push requires network and device support and is not guaranteed delivery. A newly opened tab may require the expiring journey access link again because bearer credentials are session-scoped. Delivery over external push services was not tested in the supplied environment.

## Verification gate

```sh
npm test
npm run build
```

For PostgreSQL validation after provisioning: run migrations and seed, create a journey through the reception UI, restart the API, confirm the journey and queue survive, call/complete a ticket, and verify the next stage arrives over a journey-scoped socket. Test wrong-QR rerouting, accessible cross-floor routing, expired tokens, role rejection and real camera scanning under HTTPS. The local automated integration suite validates the file demonstration adapter; it is not a substitute for the PostgreSQL gate.

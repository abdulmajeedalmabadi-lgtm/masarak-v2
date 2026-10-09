# Validation evidence — updated 9 October 2026

Executed in the delivery workspace on Windows with Node.js 22.19.0.

## Executed successfully

- Dependencies installed; npm's final audit reported **zero known vulnerabilities** at the time of validation. This is a point-in-time package-registry report, not a security certification.
- Prisma Client generated with **Prisma 6.12.0** after correcting a stale Windows engine file from the earlier install.
- PostgreSQL initial migration SQL generated from the complete schema with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.
- `npm test`: **48 tests passed across six files**. Coverage includes all-pair A* versus Dijkstra, both floors, accessible routing, corridor validation, authorization, journeys, queue/Socket.IO flows, deadline behavior, staff accounts, persistence, multilingual preferences and complete QR positioning/administration.
- The nine React DOM tests cover preferences/map interaction, QR rerouting, pending phone-camera checkpoint handoff, admin create/delete/preview/download controls and all-station printing. These use **jsdom**, not a real browser.
- QR API tests independently decoded all 38 codes in their test bundle (37 seeded stations plus one temporary custom station) with jsQR, including hospital-scoped URLs. The API returned authoritative routes and steps for off-route/cross-floor scans; checkpoint changes persisted and printed identities remained stable.
- The seven-page bilingual PDF was rendered with Poppler and visually inspected. All 37 exported PNGs and all 37 cropped QR codes from the rendered PDF decoded to the exact expected structured payload with jsQR. Evidence: `docs/qr-label-validation.json`. Physical printing/camera scanning were not performed.
- `npm run build`: TypeScript validation, Vite production frontend and bundled Node API completed.
- The camera library loads on demand. The updated Vite build reports a size warning for the application chunk (about 751kB before gzip); the separate deferred scanner chunk is about 375kB. This is a performance consideration, not a build failure. This corrects the earlier report's swapped chunk descriptions.
- `npm run demo:setup` created private local credentials; `npm run db:seed` populated the **file-demo** store with fictional hospital data, staff and sample queues.
- Both frontend and API development servers ran; frontend returned HTTP 200 and `/api/health` returned `{ok:true, storage:"file-demo", mapVersion:1}`.
- `npm start` launched the **compiled API bundle** on a separate local port with an isolated file-demo store. `scripts/smoke.ts` completed the real HTTP reception/patient/clinic flow, including QR PNG generation and an elevator route to the next stage. Its redacted evidence is in `docs/live-smoke.json`; no bearer tokens or passwords are recorded.
- `npm run demo:upgrade-qr` successfully expanded the existing fictional local map to 37 nodes/checkpoints while preserving journeys. `npm run smoke:qr` then exercised the running API over HTTP: checkpoint creation, independently decoded PNG, off-route scan with a 76m route and server steps, a move to the other floor with stable printed URL, elevator rerouting, reception write rejection, deletion and rejected rescanning without moving the patient. Redacted evidence is in `docs/qr-live-smoke.json`.

## Not verified / environment limits

- **PostgreSQL is unavailable**: no `psql` or Docker executable was found, and a direct TCP connection to `127.0.0.1:5432` returned `ECONNREFUSED`. `npm run db:migrate` was attempted and failed (`Schema engine error`). The generated migration has **not been applied to PostgreSQL**, and PostgreSQL seeding/persistence have **not been tested**. Follow the exact setup in README and the PostgreSQL verification gate in DEPLOYMENT before treating that adapter as verified.
- The in-app browser failed to attach its preview tab; opening through the app returned a queued preview. **No real-browser screenshot, physical mobile responsiveness check, or camera scan was verified.** DOM tests and responsive CSS are provided, and the dev frontend serves normally.
- Device speech, actual notification permissions, vibration and optional Web Push delivery need real HTTPS-capable target-device testing. Web Push source/subscription handling are implemented, but no external push service was configured or tested.
- No production deployment, actual hospital map survey, clinical integration, load test, multi-instance operation, or compliance assessment was performed.

Test login passwords are generated at runtime and apply only to temporary stores; fixed synthetic signing secrets are test-only. All usable seeded local passwords/secrets are generated into `.env` and omitted from the ZIP, together with `.data`, dependencies and caches.

## 2026-10-09 — 3D navigation upgrade (latest)

59 tests across 8 files pass, TypeScript and production build pass, production dependency audit: 0 vulnerabilities. Actual in-app browser verified WebGL, 393×852 layout without horizontal overflow, Arabic RTL, light/dark, simulation forward movement and pause, lost correction, and QR updates. Live API navigation smoke passed on isolated file-demo data; report: navigation-live-smoke.json. Camera scanning and real iPhone GPU performance remain untested; PostgreSQL remains unavailable. Existing earlier validation sections describe version 1.1.

## 2026-10-09 — hybrid navigation 1.3

75 tests across 9 files passed; TypeScript and production build passed. Coverage includes permissions/cleanup, synthetic steps and noise, calibrated distance, all-pairs interval cost preservation, approaching/confirmed turns, floor barriers, QR/manual reset and rerouting, sensor-to-UI progress, map refresh stability, demo isolation, automatic arrival, concurrent ticket deduplication, completed-stage replay, paused clinic, queues and Socket.IO. Actual in-app browser at 393x852 verified 2D selection to WebGL corridor, explicit sensor activation with no-reading fallback, no horizontal overflow, destination QR to automatic arrival/queue success, and live paused-clinic update without refresh using isolated file-demo data. Physical iPhone/Android sensors and camera were not tested. PostgreSQL runtime was not tested; schema/adapter were preserved. Vite reports the existing large lazily loaded QR/3D chunks; production build succeeds. The test runner uses two workers and a 15-second default to accommodate Windows DOM/QR cold starts without dropping assertions. See HYBRID-NAVIGATION.md for limitations and the physical-device checklist.

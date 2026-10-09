# QR corridor positioning — 9 October 2026

## Confirmed position, not GPS

The fictional hospital has two floors, a main corridor at y=300 and a south corridor at y=410 on each floor, with three connecting passages and T-intersections at department entrances. The seed has 37 navigable nodes and 37 unique checkpoints, including stairs, elevator areas, reception, corridor entrances/intersections, clinics, laboratory, radiology, waiting areas, pharmacy and exit.

A checkpoint contains `id`, `hospitalId`, `floorId`, numeric `floor`, `nodeId`, `x`, `y`, Arabic `locationName` and six localized `names`. Coordinates and floor references are derived from the node. PostgreSQL uses foreign keys to Hospital, Floor and MapNode; the demonstration adapter persists identical metadata.

Only a successful explicit scan, demo scan, or manually confirmed known location changes `PatientJourney.location`. `confirmedAt` and `confirmedCheckpointId` record the confirmation. Queue polling, timers and Socket.IO updates do not infer movement. No geolocation API is used.

`POST /api/location` resolves hospital/checkpoint, updates the authenticated patient's position, computes a new A* route and returns the checkpoint, node, confirmation time, route, `rerouted` flag and instruction keys/distances. Both on-route and off-route scans recalculate from the confirmed node. Invalid/deleted/foreign-hospital codes are rejected without moving the patient. Wheelchair routes reject stairs and inaccessible edges.

## Scanning on phones

1. Open the reception-issued journey link on the phone.
2. Select Scan QR or I am lost → Scan QR; allow the camera when prompted.
3. Scan the nearest printed station. The environment-facing camera is requested; text entry and manual confirmation are available if the camera is unavailable.
4. The confirmed checkpoint name/time, marker, remaining distance and route update. Subsequent scans advance the instructions.

Camera access needs HTTPS, except localhost on the same device. A phone cannot access a desktop using the phone's `localhost`. Configure `PUBLIC_APP_URL` to a reachable frontend HTTPS URL and the API/CORS configuration accordingly. Physical camera scanning was not tested in this environment.

Admin-generated QR codes contain an application URL with only `hospital` and `checkpoint` parameters. A native phone camera can open it when that deployment is reachable. If the new tab lacks a journey session, the app holds the checkpoint and asks for the reception link, then applies the held location. In-app scanning keeps the existing journey session. Patient credentials are never embedded in location QR codes.

## Admin workflow

- Add: select a map node, a unique `QR-...` ID and localized names. Hospital/floor/coordinates fill from the node.
- Edit: choose another valid node, including another floor. Printed identity stays stable; future scans resolve the latest saved location. Reprint when the visible label or physical placement changes.
- Delete: confirm removal. Future scans fail explicitly; graph nodes and existing journey positions remain usable.
- Preview: select a point to display its floor and highlight its marker; floor filtering is available.
- Download: generate a black-on-white 600px PNG or scalable SVG, with a four-module quiet zone and medium error correction.
- Print: open one or all stations in an A4 print document, six labels per page. Browser printing can save it as PDF. Popup permission may be required.

Reception can generate/download/print existing stations; only administrators can add/edit/delete. Writes persist before update events are emitted.

## Demo and printable files

The patient scanner has a checkpoint simulation selector calling the **same API** as a real scan. Choose a south-corridor station to test off-route recovery, then the destination entrance to confirm arrival.

`docs/checkpoint-labels/` includes the map, checkpoint data, 37 PNGs, 37 SVGs and a seven-page bilingual PDF. These standalone demo signs use `MASARAK:v1:<hospitalId>:<checkpointId>`, so Masarak's in-app scanner can read them without an invented deployment. They do not launch a website from a native camera. For native-camera links, regenerate signs from the admin panel after configuring the reachable app URL.

```sh
npm run qr:export
```

Set `PRINT_APP_URL=https://your-existing-deployment.example` to export application URLs. This script exports the reference seed; use the admin panel for current edited hospital data.

For an existing local demo, **stop the API**, run `npm run demo:upgrade-qr`, then restart. The script preserves journeys/rooms/checkpoint IDs and adds the expanded graph to the fictional file-demo, refusing incompatible custom geometry. PostgreSQL installations apply `npm run db:migrate`; existing geometry is preserved and stairs gain checkpoints. New seeds include the full expanded plan. Back up existing data first.

## Verification

API tests independently decode every generated PNG with jsQR and exercise hospital rejection, off-route/cross-floor recovery, confirmation persistence, admin CRUD, stable printed identities after moves, graph edit synchronization and deletion. DOM tests cover forms, map preview, downloads, deletion confirmation, printing and unauthenticated checkpoint handoff. Every standalone PDF QR also decoded correctly from its rendered page image. These tests do not replace real camera/print trials.

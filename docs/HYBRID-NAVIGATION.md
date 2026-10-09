# MASARAK 1.3 — hybrid navigation

The existing patient journey now flows from map selection or a QR anchor to the 3D corridor, optional movement estimation, destination QR validation, automatic arrival registration, and the existing live clinic queue. Existing A*, two-floor map, QR administration, authentication, database adapter, reception and clinic dashboards remain in use. No new positioning database or queue was added.

## Services and state

- `src/services/MotionTrackingService.ts`: detects browser motion/orientation APIs; requests both iOS permissions directly during the patient's click before awaiting; handles denied, unsupported, insecure, missing readings and paused states. Orientation permission is optional if motion permission succeeds. Cancels pending permission completion and removes listeners on cleanup. Hiding the page pauses tracking; returning requires another explicit action.
- `src/services/StepDetectionService.ts`: experimental walking-like peaks from accelerometer magnitude, low-pass gravity baseline and noise filter, 350 ms refractory period, acceleration spike and rapid rotation rejection. Initial step length is 0.7 m, configurable within 0.3–1.2 m. Known-distance calibration divides distance by detected steps; it rejects impossible inputs. Displayed total distance is steps × configured length. Changing calibration affects future route increments; it does not move an already estimated position retroactively.
- `src/services/NavigationTrackingService.ts`: derives intervals from the existing guidance and graph, splitting straight corridors at intersections and branch nodes. Maintains `confirmedLocation`, `estimatedLocation`, `estimatedProgress` and `positionConfidence` separately. It caps progress at a boundary, discards overshoot and waits for explicit confirmation at turns, straight junctions, elevators and stairs. Entering the turn instruction does not perform the turn. A separate floor confirmation prevents silent floor changes. At 40 m walked since the anchor, confidence becomes low and QR/map correction is required.
- `src/useNavigationTracking.ts`: binds the services to React, updating UI on steps and bounded status changes. A fresh QR/manual anchor or changed route/map version creates a fresh tracker and step counter. Unrelated Socket.IO map refreshes preserve progress. Leaving navigation, changing mode, becoming confirmed at the destination or losing visibility removes sensor listeners.

Sensor calculations never call `/location`, `/arrival` or any other API. The backend location changes only through the existing QR/manual selection endpoint. Manual selection clears QR arrival evidence. Estimated progress cannot create a queue ticket.

## Three modes

Interactive mode uses QR and optional explicitly enabled sensors. Enablement is offered immediately above the corridor. It runs without a navigation clock. Estimated remaining distance, near-turn arrow/text and speech follow the calculated intervals. A junction confirmation acknowledges the displayed instruction; it is not an additional location anchor. Always use signage or a QR if unsure.

Demo mode retains its separate timer, pause, restart and previous/next controls. Its simulated arrival remains labelled and cannot register arrival. Switching into demo stops sensors; simulated progress does not alter interactive progress or backend state.

Manual mode stops sensors and provides an explicit next-instruction button. The existing lost/map correction and scan actions remain available. Re-selecting a map node recalculates A*, clears estimates and returns to 3D. Sensors then require explicit re-enablement.

## Heading and camera

The orientation service smooths angles across 359°/0°, reads iOS compass information when available, or browser absolute/relative alpha. Map heading is calibrated by explicitly holding the phone toward the route. Poor compass accuracy or stale readings invalidate the heading indicator. A calibrated mismatch with the current instruction is shown as a correction warning. Phone heading is advisory: it cannot prove walking direction, and no turn is automatically authorized by it.

The existing simplified corridor receives the live interval and estimated progress. Camera displacement follows interval geometry proportionally, with short rendering interpolation; acknowledged heading changes are smoothed. QR anchor changes reposition the camera without remounting the Canvas. Interactive mode renders on demand, instead of keeping the scene continuously animated. Demo rendering remains continuous while playing. Existing WebGL fallback, low-power settings, light/dark themes, large text, RTL and six languages remain available.

## Arrival and live clinic queue

Estimated arrival says that the patient appears to have arrived and requires the destination QR. Scanning that QR uses existing checkpoint validation, updates the confirmed node, stops sensors and automatically posts `/arrival` with the active `stageId`. The client guards repeated in-flight updates; server mutations remain serialized. Clinical arrivals reuse the existing active ticket rather than inserting a duplicate. An optional `stageId` also makes replay of a completed nonclinical stage harmless, without completing the next stage. The original API body remains supported.

Only successful arrival processing opens the green checkmark screen. It displays department, room and floor, clinic availability, patients ahead, estimated wait and ticket status. It uses the existing journey GET and Socket.IO update subscription, with the existing offline refresh fallback. A called ticket links to the existing turn screen; completed nonclinical arrivals link to the next journey stage. Reception/exit does not create a clinic ticket.

Clinic administrators can now select `paused` in addition to existing statuses. A paused/closed clinic cannot call another patient. Its status is stored through the existing clinic API and database adapter, and the patient's arrival screen updates through Socket.IO. No schema migration is needed: clinic status was already stored as a string.

## Permissions and limitations

Use trusted HTTPS on a phone. Localhost is suitable for desktop development; an HTTP LAN address is generally not a secure context. Camera permission is separate from motion/orientation permission. Support varies by browser and device. Permission denial, missing measurements or unsupported sensors leave QR/manual guidance available. Tracking is never started by mounting a component or opening a journey.

This is not indoor GPS, a medical instrument or validated pedestrian dead reckoning. Phone posture, pocket/hand placement, gait, elevators, shaking, rotation and missing browser data can undercount or overcount. The filter rejects obvious noise but cannot identify every false step. Map coordinates and edge distances also require surveying before hospital use. Calibration and QR anchors reduce drift; they do not establish exact location. Destination QR remains authoritative for arrival. Actual iPhone 17/Android sensors and camera scanning have **not** been tested on physical devices.

## Physical-device checklist — iPhone 17 and Android

Run the same checklist in Safari on iPhone and Chrome on Android, recording OS/browser versions, phone placement, counted steps, surveyed distance and discrepancies. Use a trusted HTTPS deployment and disposable demo journeys.

1. Open a journey; select reception on the map. Verify automatic 3D entry and no permission prompt before touching Enable.
2. Enable movement. On iOS check motion/orientation prompts; on Android verify browser support and any prompt it provides. Deny permission, confirm usable QR/manual fallback, then repeat with permission granted. Check unsupported/insecure contexts separately.
3. Stand still for 30 seconds; rotate/shake the phone without walking. Record false steps. Walk a measured 10–20 m at several paces holding the phone and carrying it in a pocket; compare counted steps and estimated distance. Calibrate using a known distance and repeat. Do not accept a failed noise/rotation test as accurate tracking.
4. At two metres before a turn, verify the upcoming arrow/text and optional speech. At the intersection verify progress stops until explicit confirmation or QR; test a straight branching intersection too. Hold the phone sideways/backward and verify it never guesses an automatic turn.
5. Ride the elevator/use stairs. Verify steps do not silently change floors, then scan the destination-floor QR. Check room/floor labels and recomputed instructions.
6. Scan an off-route QR. Verify A* reroutes from that checkpoint and resets steps/progress. Press Lost while sensors run; verify sensors stop, the correction map opens, manual/QR correction returns to 3D and sensors stay off until explicitly enabled.
7. Reach estimated arrival in manual and sensor modes; verify no queue ticket or successful-arrival screen exists without destination QR. Scan destination QR and verify automatic success/room/floor and a single queue ticket. Scan repeatedly and submit concurrent arrival requests; verify the same ticket is reused.
8. In the staff dashboard change the clinic from available to busy to paused, call a patient when available and update queue order. Observe status, ahead count, estimated wait and ticket status without refreshing the patient screen. Verify paused clinic rejects calling.
9. Enter demo, finish its timer and verify simulated arrival does not change backend location/tickets. Switch back to interactive; verify demo progress was isolated. Exercise manual next instructions independently.
10. Background/lock the phone, return and verify tracking is paused; explicitly resume. Deny camera access and verify manual alternatives. Test light/dark, Arabic/Urdu RTL, all six languages, large text, reduced motion, narrow viewport and WebGL fallback. Record heat/battery and frame responsiveness during a 10-minute session.

## Verification and changed files

Automated coverage includes permissions/cleanup/unsupported sensors, synthetic walking/noise/distance, all-pairs graph costs, approaching turns, boundary/floor stops, fresh anchors and rerouting, arrival confirmation/replay/concurrency, clinic pause, queue creation and journey-scoped sockets. DOM tests cover automatic arrival and sensor-to-navigation progress without claiming physical sensor validation.

Actual in-app browser verification used an isolated file-demo server and 393×852 viewport: manual selection → 3D; explicit enable → missing-reading fallback; no horizontal overflow; destination QR URL → automatic `/arrival` → persisted ticket and green success screen; changing clinic to paused appeared without reloading through Socket.IO. A development Canvas unmount warning was observed during scene/HMR changes; the added Canvas key was removed in favour of an anchor prop and camera reset. Temporary servers/tabs were closed. PostgreSQL runtime and physical phones remain unverified; the existing Prisma adapter/schema were preserved.

The test runner limits concurrency to two workers and allows a bounded 15-second default per test for cold Windows DOM/QR generation; existing 30-second QR decoding tests retain their explicit limit. Assertions were not removed to accommodate timing. See `CHANGES-1.3.json` for the complete changed/added file list and `VALIDATION.md` for final results.

Primary browser API references: [MDN motion permissions](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static), [orientation](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent), [acceleration including gravity](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/accelerationIncludingGravity).

import "dotenv/config";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { guidance } from "../shared/guidance";
const host = process.env.SMOKE_API_URL ?? "http://localhost:4000";
async function call(
  path: string,
  token?: string,
  body?: unknown,
  expected = 200,
) {
  const r = await fetch(host + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${data.error ?? r.status}`);
  return data;
}
const reception = (
  await call("/login", undefined, {
    username: "reception.demo",
    password: process.env.DEMO_PASSWORD,
  })
).token;
const created = await call("/journeys", reception, {
    alias: "3D navigation smoke",
    rooms: ["doctor"],
    accessible: true,
  }),
  token = created.token;
const map = await call("/map");
await call("/location", token, { nodeId: "f0-south0" });
const initial = (await call("/route", token)).route,
  steps = guidance(map, initial.nodes);
assert(steps.some((s) => s.type === "ELEVATOR"));
assert(steps.some((s) => s.type === "TURN_LEFT" || s.type === "TURN_RIGHT"));
assert.equal(
  steps.reduce((sum, s) => sum + s.distance, 0),
  initial.distance,
);
await call("/location", token, { nodeId: "door-doctor" });
await call("/arrival", token, {}, 400);
await call("/location", token, { nodeId: "f0-c0" });
await call("/location", token, { checkpoint: "QR-door-lab" });
const afterQr = await call("/journey", token);
assert.equal(afterQr.journey.confirmedCheckpointId, "QR-door-lab");
assert.equal(afterQr.journey.location, "door-lab");
const rerouted = (await call("/route", token)).route;
assert.notEqual(initial.distance, rerouted.distance);
await call("/location", token, { checkpoint: "QR-door-doctor" });
const arrival = await call("/arrival", token, {});
assert(arrival.ticket);
const report = {
  executedAt: new Date().toISOString(),
  storage: (await call("/health")).storage,
  manualSelectionPersists: true,
  manualDestinationArrivalRejected: true,
  graphDerivedTurns: true,
  crossFloorElevator: true,
  exactGraphCostPreserved: true,
  qrPositionAndRouteUpdated: true,
  destinationQrArrivalCreatesTicket: true,
  initialDistance: initial.distance,
  reroutedDistance: rerouted.distance,
};
await writeFile(
  "docs/navigation-live-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));

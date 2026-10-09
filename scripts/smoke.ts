import "dotenv/config";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
const host = process.env.SMOKE_API_URL ?? "http://localhost:4000";
const password = process.env.DEMO_PASSWORD;
if (!password)
  throw Error("Set private DEMO_PASSWORD for the local demo smoke test.");
async function call(path: string, token?: string, body?: unknown) {
  const r = await fetch(host + "/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json()) as any;
  assert.equal(r.status, 200, `${path}: ${data.error ?? r.status}`);
  return data;
}
const health = await call("/health");
const reception = (
  await call("/login", undefined, { username: "reception.demo", password })
).token;
const clinic = (
  await call("/login", undefined, { username: "triage.demo", password })
).token;
const created = await call("/journeys", reception, {
  alias: "Live smoke visitor",
  rooms: ["triage", "doctor", "pharmacy"],
  accessible: true,
});
const token = created.token;
const initial = (await call("/route", token)).route.distance;
await call("/location", token, { checkpoint: "QR-door-lab" });
const rerouted = (await call("/route", token)).route.distance;
assert.notEqual(initial, rerouted);
await call("/assistance", token, {});
await call("/location", token, { checkpoint: "QR-door-triage" });
const arrival = await call("/arrival", token, {});
await call(`/tickets/${arrival.ticket.id}/action`, clinic, {
  action: "priority",
  priority: 5,
});
const called = await call("/clinics/triage/call", clinic, {});
assert.equal(called.ticket.id, arrival.ticket.id);
const waiting = await call("/journey", token);
assert.equal(waiting.ticket.status, "called");
assert(waiting.notifications.some((n: any) => n.key === "yourTurn"));
await call("/extra-time", token, {});
await call(`/tickets/${arrival.ticket.id}/action`, clinic, {
  action: "extend",
});
for (const action of ["arrived", "start", "complete"])
  await call(`/tickets/${arrival.ticket.id}/action`, clinic, { action });
const next = await call("/journey", token);
assert.equal(next.journey.stages[1].status, "active");
const crossFloor = (await call("/route", token)).route;
assert(crossFloor.nodes.some((n: any) => n.kind === "elevator"));
assert(!crossFloor.nodes.some((n: any) => n.kind === "stairs"));
const qr = await call("/qr?value=QR-door-triage", reception);
assert(qr.image.startsWith("data:image/png;base64,"));
const report = {
  executedAt: new Date().toISOString(),
  storage: health.storage,
  health: health.ok,
  initialDistanceMeters: initial,
  wrongTurnDistanceMeters: rerouted,
  queueCalled: true,
  extraTimeExtended: true,
  stageCompleted: true,
  nextStage: "doctor",
  accessibleCrossFloorUsesElevator: true,
  qrPNGGenerated: true,
  secretsIncluded: false,
};
await fs.mkdir("docs", { recursive: true });
await fs.writeFile(
  "docs/live-smoke.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));

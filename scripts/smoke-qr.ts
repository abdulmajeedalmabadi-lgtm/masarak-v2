import "dotenv/config";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import jsQR from "jsqr";
import { PNG } from "pngjs";
const host = process.env.SMOKE_API_URL ?? "http://localhost:4000";
const password = process.env.DEMO_PASSWORD;
if (!password) throw Error("Set the local private DEMO_PASSWORD.");
async function call(
  path: string,
  token?: string,
  body?: unknown,
  method?: string,
  expected = 200,
) {
  const response = await fetch(host + "/api" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as any;
  assert.equal(
    response.status,
    expected,
    `${path}: ${data.error ?? response.status}`,
  );
  return data;
}
const health = await call("/health"),
  map = await call("/map");
assert(
  map.nodes.some((n: any) => n.id === "f0-south0"),
  "Upgrade the previous local demo with npm run demo:upgrade-qr first.",
);
const admin = (
    await call("/login", undefined, { username: "admin.demo", password })
  ).token,
  reception = (
    await call("/login", undefined, { username: "reception.demo", password })
  ).token;
const journey = await call("/journeys", reception, {
    alias: "Live QR validation",
    rooms: ["triage", "doctor"],
    accessible: true,
  }),
  token = journey.token,
  id = "QR-live-" + crypto.randomUUID();
let created = false;
try {
  const q = await call("/admin/checkpoints", admin, {
    id,
    nodeId: "f0-south0",
  });
  created = true;
  assert.deepEqual([q.x, q.y, q.floorId], [180, 410, "floor-0"]);
  const label = await call(`/admin/checkpoints/${id}/qr`, admin),
    png = PNG.sync.read(Buffer.from(label.image.split(",")[1], "base64"));
  assert.equal(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    label.payload,
  );
  const offRoute = await call("/location", token, {
    checkpoint: label.payload,
  });
  assert(offRoute.rerouted);
  assert.equal(offRoute.route.distance, 76);
  assert.equal(offRoute.location.id, "f0-south0");
  assert(offRoute.steps.length > 0);
  await call(`/admin/checkpoints/${id}`, admin, { nodeId: "f1-c6" }, "PUT");
  const updated = await call(`/admin/checkpoints/${id}/qr`, admin);
  assert.equal(updated.payload, label.payload);
  const moved = await call("/location", token, { checkpoint: label.payload });
  assert.equal(moved.checkpoint.floorId, "floor-1");
  assert(moved.route.nodes.some((n: any) => n.kind === "elevator"));
  assert(
    !moved.route.nodes.some(
      (n: any) => n.kind === "stairs" && n.id !== "f1-c6",
    ),
  );
  await call(
    `/admin/checkpoints/${id}`,
    reception,
    { nodeId: "f0-c0" },
    "PUT",
    403,
  );
  await call(`/admin/checkpoints/${id}`, admin, undefined, "DELETE");
  created = false;
  await call("/location", token, { checkpoint: label.payload }, undefined, 400);
  const after = await call("/journey", token);
  assert.equal(after.journey.location, "f1-c6");
  assert.equal(after.journey.confirmedCheckpointId, id);
  const report = {
    executedAt: new Date().toISOString(),
    storage: health.storage,
    seededCheckpoints: map.checkpoints.length,
    adminCRUD: true,
    PNGIndependentlyDecoded: true,
    offRouteDistanceMeters: 76,
    serverInstructionsReturned: true,
    crossFloorUsesElevator: true,
    printedIdentityStableAfterMove: true,
    receptionWriteRejected: true,
    deletedQRRejectedWithoutMovingPatient: true,
    confirmedLocationPersisted: true,
    continuousGPSTracking: false,
    physicalCameraTested: false,
  };
  await fs.writeFile(
    "docs/qr-live-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (created)
    await call(`/admin/checkpoints/${id}`, admin, undefined, "DELETE");
}

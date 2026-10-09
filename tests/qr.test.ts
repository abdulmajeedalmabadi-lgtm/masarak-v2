import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { createHospital } from "../shared/hospital";
import {
  checkpointForNode,
  checkpointPayload,
  parseCheckpointPayload,
} from "../shared/checkpoints";
import { validateMap } from "../shared/navigation";
import { printableQrDocument } from "../src/printQr";
let store: Store,
  service: ReturnType<typeof createApp>,
  dir: string,
  admin: string,
  reception: string,
  patient: string;
const credential = crypto.randomUUID() + crypto.randomUUID();
beforeAll(async () => {
  await fs.mkdir(".data", { recursive: true });
  dir = await fs.mkdtemp(path.resolve(".data/qr-test-"));
  store = new Store("file-demo", path.join(dir, "state.json"));
  await store.load();
  const hash = await bcrypt.hash(credential, 4);
  store.state.staff = [
    {
      id: "admin-qr",
      username: "admin",
      passwordHash: hash,
      role: "ADMIN",
      active: true,
    },
    {
      id: "reception-qr",
      username: "reception",
      passwordHash: hash,
      role: "RECEPTION",
      active: true,
    },
  ];
  await store.save();
  service = createApp(store, "qr-test-secret-of-at-least-32-characters", [
    "http://localhost:5173",
  ]);
  for (const name of ["admin", "reception"]) {
    const r = await request(service.app)
      .post("/api/login")
      .send({ username: name, password: credential });
    expect(r.status).toBe(200);
    if (name === "admin") admin = r.body.token;
    else reception = r.body.token;
  }
  const j = await request(service.app)
    .post("/api/journeys")
    .auth(reception, { type: "bearer" })
    .send({
      alias: "QR test visitor",
      rooms: ["triage", "doctor"],
      accessible: true,
    });
  patient = j.body.token;
});
afterAll(async () => {
  if (service)
    await new Promise<void>((resolve) => service.io.close(() => resolve()));
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});
describe("QR positioning, administration and printable codes", () => {
  it("seeds 37 uniquely identified checkpoints including stairs, junctions, lifts and all departments", () => {
    const map = createHospital();
    expect(validateMap(map)).toEqual([]);
    expect(map.checkpoints).toHaveLength(37);
    expect(new Set(map.checkpoints.map((q) => q.id)).size).toBe(37);
    for (const q of map.checkpoints) {
      const n = map.nodes.find((n) => n.id === q.nodeId)!;
      expect(q.hospitalId).toBe(map.id);
      expect(q.floorId).toBe(`floor-${n.floor}`);
      expect([q.x, q.y, q.floor]).toEqual([n.x, n.y, n.floor]);
      expect(q.locationName).toBe(q.names.ar);
      expect(Object.keys(q.names)).toHaveLength(6);
    }
    for (const kind of ["stairs", "elevator", "intersection"])
      for (const floor of [0, 1])
        expect(
          map.checkpoints.some(
            (q) =>
              q.floor === floor &&
              map.nodes.find((n) => n.id === q.nodeId)!.kind === kind,
          ),
        ).toBe(true);
    for (const id of ["reception", "triage", "lab", "radiology"])
      expect(map.checkpoints.some((q) => q.nodeId === `door-${id}`)).toBe(true);
  });
  it("rejects unknown, malformed and foreign-hospital codes without moving the patient", async () => {
    for (const checkpoint of [
      "QR-unknown",
      "MASARAK:v2:masarak-hospital:QR-door-lab",
      "MASARAK:v1:other-hospital:QR-door-lab",
      "https://hospital.example/?hospital=foreign&checkpoint=QR-door-lab",
    ])
      expect(
        (
          await request(service.app)
            .post("/api/location")
            .auth(patient, { type: "bearer" })
            .send({ checkpoint })
        ).status,
      ).toBe(400);
    expect(store.state.journeys[0].location).toBe("door-reception");
  });
  it("confirms an off-route corridor scan and returns a fresh A* route plus steps from the server", async () => {
    const q = store.state.map.checkpoints.find(
      (q) => q.nodeId === "f0-south0",
    )!;
    const r = await request(service.app)
      .post("/api/location")
      .auth(patient, { type: "bearer" })
      .send({ checkpoint: checkpointPayload(q) });
    expect(r.status).toBe(200);
    expect(r.body.rerouted).toBe(true);
    expect(r.body.checkpoint.id).toBe(q.id);
    expect(r.body.location.id).toBe(q.nodeId);
    expect(r.body.route.distance).toBe(76);
    expect(r.body.route.nodes[0].id).toBe(q.nodeId);
    expect(r.body.steps.length).toBe(r.body.route.nodes.length - 1);
    expect(Date.parse(r.body.confirmedAt)).toBeGreaterThan(0);
    const reloaded = new Store("file-demo", store.file);
    await reloaded.load();
    expect(reloaded.state.journeys[0].confirmedCheckpointId).toBe(q.id);
    expect(reloaded.state.journeys[0].location).toBe(q.nodeId);
  });
  it("accepts phone-camera application URLs and takes the elevator from another floor", async () => {
    const r = await request(service.app)
      .post("/api/location")
      .auth(patient, { type: "bearer" })
      .send({
        checkpoint:
          "http://localhost:5173/?hospital=masarak-hospital&checkpoint=QR-door-radiology",
      });
    expect(r.status).toBe(200);
    expect(r.body.checkpoint.floorId).toBe("floor-1");
    expect(r.body.route.nodes.some((n: any) => n.kind === "elevator")).toBe(
      true,
    );
    expect(r.body.route.nodes.some((n: any) => n.kind === "stairs")).toBe(
      false,
    );
  });
  it("protects checkpoint CRUD with admin authorization and rejects invalid nodes", async () => {
    expect(
      (
        await request(service.app)
          .post("/api/admin/checkpoints")
          .auth(reception, { type: "bearer" })
          .send({ id: "QR-custom", nodeId: "f0-south0" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(service.app)
          .post("/api/admin/checkpoints")
          .auth(patient, { type: "bearer" })
          .send({ id: "QR-custom", nodeId: "f0-south0" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(service.app)
          .post("/api/admin/checkpoints")
          .auth(admin, { type: "bearer" })
          .send({ id: "QR-custom", nodeId: "missing" })
      ).status,
    ).toBe(400);
  });
  it("creates a checkpoint with derived coordinates, edits its floor and retains its printed identity", async () => {
    const created = await request(service.app)
      .post("/api/admin/checkpoints")
      .auth(admin, { type: "bearer" })
      .send({
        id: "QR-custom",
        nodeId: "f0-south0",
        x: 999,
        hospitalId: "foreign",
      });
    expect(created.status).toBe(200);
    expect(created.body.x).toBe(180);
    expect(created.body.hospitalId).toBe("masarak-hospital");
    expect(
      (
        await request(service.app)
          .post("/api/admin/checkpoints")
          .auth(admin, { type: "bearer" })
          .send({ id: "QR-custom", nodeId: "f0-c0" })
      ).status,
    ).toBe(409);
    const original = await request(service.app)
      .get("/api/admin/checkpoints/QR-custom/qr")
      .auth(admin, { type: "bearer" });
    const moved = await request(service.app)
      .put("/api/admin/checkpoints/QR-custom")
      .auth(admin, { type: "bearer" })
      .send({ nodeId: "f1-c6" });
    expect(moved.status).toBe(200);
    expect([moved.body.x, moved.body.y, moved.body.floorId]).toEqual([
      680,
      300,
      "floor-1",
    ]);
    expect(moved.body.locationName).toContain("الدرج");
    const latest = await request(service.app)
      .get("/api/admin/checkpoints/QR-custom/qr")
      .auth(admin, { type: "bearer" });
    expect(latest.body.payload).toBe(original.body.payload);
    expect(
      (
        await request(service.app)
          .post("/api/location")
          .auth(patient, { type: "bearer" })
          .send({ checkpoint: latest.body.payload })
      ).body.location.id,
    ).toBe("f1-c6");
    const reloaded = new Store("file-demo", store.file);
    await reloaded.load();
    expect(
      reloaded.state.map.checkpoints.find((q) => q.id === "QR-custom")!.floorId,
    ).toBe("floor-1");
  });
  it("independently decodes every printable PNG to its exact hospital/checkpoint URL", async () => {
    const r = await request(service.app)
      .get("/api/admin/checkpoints/print/all")
      .auth(admin, { type: "bearer" });
    expect(r.status).toBe(200);
    expect(r.body.labels).toHaveLength(38);
    const unique = new Set<string>();
    for (const label of r.body.labels) {
      const png = PNG.sync.read(
        Buffer.from(label.image.split(",")[1], "base64"),
      );
      const decoded = jsQR(
        new Uint8ClampedArray(png.data),
        png.width,
        png.height,
      );
      expect(decoded?.data, label.checkpoint.id).toBe(label.payload);
      const payload = parseCheckpointPayload(decoded!.data)!;
      expect(payload.hospitalId).toBe(label.checkpoint.hospitalId);
      expect(payload.checkpointId).toBe(label.checkpoint.id);
      expect(label.svg).toContain("<svg");
      unique.add(decoded!.data);
    }
    expect(unique.size).toBe(38);
  }, 30000);
  it("escapes custom names in print documents and produces bounded six-label pages", async () => {
    const all = (
      await request(service.app)
        .get("/api/admin/checkpoints/print/all")
        .auth(reception, { type: "bearer" })
    ).body.labels;
    all[0].checkpoint.names.en = "<script>alert(1)</script>";
    const html = printableQrDocument(
      all,
      "en",
      "Print labels",
      "Scan to confirm location",
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect((html.match(/<article>/g) ?? []).length).toBe(38);
    expect((html.match(/class="page"/g) ?? []).length).toBe(7);
  });
  it("keeps checkpoint coordinates synchronized when an admin edits map nodes", async () => {
    const map = structuredClone(store.state.map);
    map.nodes.find((n) => n.id === "f0-south0")!.x = 170;
    expect(
      (
        await request(service.app)
          .put("/api/admin/map")
          .auth(admin, { type: "bearer" })
          .send(map)
      ).status,
    ).toBe(200);
    expect(
      store.state.map.checkpoints.find((q) => q.nodeId === "f0-south0")!.x,
    ).toBe(170);
  });
  it("deletes a checkpoint permanently from persistence without deleting its navigable node", async () => {
    expect(
      (
        await request(service.app)
          .delete("/api/admin/checkpoints/QR-custom")
          .auth(admin, { type: "bearer" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(service.app)
          .post("/api/location")
          .auth(patient, { type: "bearer" })
          .send({ checkpoint: "QR-custom" })
      ).status,
    ).toBe(400);
    expect(store.state.map.nodes.some((n) => n.id === "f1-c6")).toBe(true);
    const reloaded = new Store("file-demo", store.file);
    await reloaded.load();
    expect(
      reloaded.state.map.checkpoints.some((q) => q.id === "QR-custom"),
    ).toBe(false);
    expect(store.state.journeys[0].location).toBe("f1-c6");
  });
});

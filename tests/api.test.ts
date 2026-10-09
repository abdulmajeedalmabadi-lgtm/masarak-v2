import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { io as clientIO } from "socket.io-client";
import { promises as fs } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { Store } from "../server/store";
import { createApp } from "../server/app";
import { checkpointForNode } from "../shared/checkpoints";
const testPassword = crypto.randomUUID() + crypto.randomUUID();
let store: Store,
  service: ReturnType<typeof createApp>,
  dir: string,
  reception: string,
  clinic: string,
  admin: string,
  patient: string,
  journeyId: string,
  ticketId: string;
const login = async (username: string) => {
  const r = await request(service.app)
    .post("/api/login")
    .send({ username, password: testPassword });
  expect(r.status).toBe(200);
  return r.body.token;
};
beforeAll(async () => {
  await fs.mkdir(".data", { recursive: true });
  dir = await fs.mkdtemp(path.resolve(".data/test-"));
  store = new Store("file-demo", path.join(dir, "state.json"));
  await store.load();
  const passwordHash = await bcrypt.hash(testPassword, 4);
  store.state.staff = [
    {
      id: "r",
      username: "reception",
      passwordHash,
      role: "RECEPTION",
      active: true,
    },
    {
      id: "c",
      username: "clinic",
      passwordHash,
      role: "CLINIC",
      roomId: "triage",
      active: true,
    },
    { id: "a", username: "admin", passwordHash, role: "ADMIN", active: true },
  ];
  await store.save();
  service = createApp(store, "test-only-secret-at-least-32-characters", [
    "http://localhost:5173",
  ]);
  await new Promise<void>((resolve) => service.http.listen(0, resolve));
  reception = await login("reception");
  clinic = await login("clinic");
  admin = await login("admin");
});
afterAll(async () => {
  if (service)
    await new Promise<void>((resolve) => service.io.close(() => resolve()));
  await store?.close();
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});
describe("Complete authorized reception → patient → clinic workflow", () => {
  it("protects staff APIs and rejects invalid login", async () => {
    expect((await request(service.app).get("/api/staff")).status).toBe(401);
    expect(
      (
        await request(service.app)
          .post("/api/login")
          .send({ username: "reception", password: "wrong" })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(service.app)
          .put("/api/admin/map")
          .auth(reception, { type: "bearer" })
          .send(store.state.map)
      ).status,
    ).toBe(403);
  });
  it("creates a scoped journey without patient account", async () => {
    const r = await request(service.app)
      .post("/api/journeys")
      .auth(reception, { type: "bearer" })
      .send({
        alias: "Fictional visitor",
        rooms: ["triage", "doctor", "pharmacy"],
        accessible: true,
      });
    expect(r.status).toBe(200);
    patient = r.body.token;
    journeyId = r.body.journey.id;
    expect(r.body.url).toContain("?journey=");
    const j = await request(service.app)
      .get("/api/journey")
      .auth(patient, { type: "bearer" });
    expect(j.body.journey.stages[0].status).toBe("active");
    expect(
      (
        await request(service.app)
          .get("/api/staff")
          .auth(patient, { type: "bearer" })
      ).status,
    ).toBe(403);
  });
  it("updates QR position and recalculates route", async () => {
    let r = await request(service.app)
      .get("/api/route")
      .auth(patient, { type: "bearer" });
    expect(r.body.route.distance).toBe(20);
    expect(
      (
        await request(service.app)
          .post("/api/location")
          .auth(patient, { type: "bearer" })
          .send({ checkpoint: "QR-door-lab" })
      ).status,
    ).toBe(200);
    r = await request(service.app)
      .get("/api/route")
      .auth(patient, { type: "bearer" });
    expect(r.body.route.distance).toBe(30);
    expect(
      (
        await request(service.app)
          .post("/api/location")
          .auth(patient, { type: "bearer" })
          .send({ checkpoint: "bad" })
      ).status,
    ).toBe(400);
  });
  it("requests assistance and staff resolves it", async () => {
    expect(
      (
        await request(service.app)
          .post("/api/assistance")
          .auth(patient, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(200);
    const a = store.state.assistance[0];
    expect(
      (
        await request(service.app)
          .post(`/api/assistance/${a.id}/resolve`)
          .auth(reception, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(200);
    expect(a.resolved).toBe(true);
  });
  it("rejects arrival after a manual destination selection", async () => {
    const created = await request(service.app)
      .post("/api/journeys")
      .auth(reception, { type: "bearer" })
      .send({ alias: "Manual selection test", rooms: ["triage"] });
    await request(service.app)
      .post("/api/location")
      .auth(created.body.token, { type: "bearer" })
      .send({ nodeId: "door-triage" });
    const response = await request(service.app)
      .post("/api/arrival")
      .auth(created.body.token, { type: "bearer" })
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("arrivalLocation");
  });
  it("requires destination checkpoint for arrival, creates ticket idempotently", async () => {
    expect(
      (
        await request(service.app)
          .post("/api/arrival")
          .auth(patient, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(400);
    await request(service.app)
      .post("/api/location")
      .auth(patient, { type: "bearer" })
      .send({ checkpoint: "QR-door-triage" });
    const r = await request(service.app)
      .post("/api/arrival")
      .auth(patient, { type: "bearer" })
      .send({});
    expect(r.status).toBe(200);
    ticketId = r.body.ticket.id;
    expect(
      (
        await request(service.app)
          .post("/api/arrival")
          .auth(patient, { type: "bearer" })
          .send({})
      ).body.ticket.id,
    ).toBe(ticketId);
  });
  it("serializes concurrent arrivals without duplicate tickets", async () => {
    const stageId = store.state.journeys
      .find((j) => j.id === journeyId)!
      .stages.find((s) => s.status === "active")!.id;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(service.app)
          .post("/api/arrival")
          .auth(patient, { type: "bearer" })
          .send({ stageId }),
      ),
    );
    expect(
      results.every((r) => r.status === 200 && r.body.ticket.id === ticketId),
    ).toBe(true);
    expect(
      store.state.tickets.filter(
        (t) => t.journeyId === journeyId && t.roomId === "triage",
      ),
    ).toHaveLength(1);
  });
  it("limits clinic staff to their assigned clinic", async () =>
    expect(
      (
        await request(service.app)
          .put("/api/clinics/doctor")
          .auth(clinic, { type: "bearer" })
          .send({ status: "busy" })
      ).status,
    ).toBe(403));
  it("supports a paused clinic and prevents calling while paused", async () => {
    expect(
      (
        await request(service.app)
          .put("/api/clinics/triage")
          .auth(clinic, { type: "bearer" })
          .send({ status: "paused" })
      ).status,
    ).toBe(200);
    const state = (
      await request(service.app)
        .get("/api/journey")
        .auth(patient, { type: "bearer" })
    ).body;
    expect(state.clinic.status).toBe("paused");
    expect(state.ticket.id).toBe(ticketId);
    expect(
      (
        await request(service.app)
          .post("/api/clinics/triage/call")
          .auth(clinic, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(400);
  });
  it("updates status, calls patient and delivers a journey-scoped socket event", async () => {
    const port = (service.http.address() as { port: number }).port;
    const socket = clientIO(`http://localhost:${port}`, {
      auth: { token: patient },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    const update = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("No socket update")), 3000);
      socket.once("update", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(
      (
        await request(service.app)
          .put("/api/clinics/triage")
          .auth(clinic, { type: "bearer" })
          .send({ status: "busy" })
      ).status,
    ).toBe(200);
    await update;
    expect(
      (
        await request(service.app)
          .post("/api/clinics/triage/call")
          .auth(clinic, { type: "bearer" })
          .send({})
      ).status,
    ).toBe(200);
    const j = (
      await request(service.app)
        .get("/api/journey")
        .auth(patient, { type: "bearer" })
    ).body;
    expect(j.ticket.status).toBe("called");
    expect(j.notifications.some((n: any) => n.key === "yourTurn")).toBe(true);
    expect(j.ticket.deadline).toBeTruthy();
    socket.disconnect();
  });
  it("requests and extends time; expiry alerts staff without removing patient", async () => {
    await request(service.app)
      .post("/api/extra-time")
      .auth(patient, { type: "bearer" })
      .send({});
    expect(store.state.tickets[0].extraTime).toBe(true);
    store.state.tickets[0].deadline = new Date(Date.now() - 1000).toISOString();
    await service.expire();
    expect(store.state.tickets[0].status).toBe("called");
    expect(store.state.tickets[0].expiredReported).toBe(true);
    await request(service.app)
      .post(`/api/tickets/${ticketId}/action`)
      .auth(clinic, { type: "bearer" })
      .send({ action: "extend" });
    expect(store.state.tickets[0].expiredReported).toBe(false);
  });
  it("confirms arrival, starts consultation and activates next destination", async () => {
    for (const action of ["arrived", "start", "complete"])
      expect(
        (
          await request(service.app)
            .post(`/api/tickets/${ticketId}/action`)
            .auth(clinic, { type: "bearer" })
            .send({ action })
        ).status,
      ).toBe(200);
    const r = await request(service.app)
      .get("/api/journey")
      .auth(patient, { type: "bearer" });
    expect(r.body.journey.stages[0].status).toBe("complete");
    expect(r.body.journey.stages[1].status).toBe("active");
    const route = await request(service.app)
      .get("/api/route")
      .auth(patient, { type: "bearer" });
    expect(route.body.route.nodes.some((n: any) => n.kind === "elevator")).toBe(
      true,
    );
  });
  it("rejects disconnected admin map and persists committed state", async () => {
    const map = { ...store.state.map, edges: [] };
    expect(
      (
        await request(service.app)
          .put("/api/admin/map")
          .auth(admin, { type: "bearer" })
          .send(map)
      ).status,
    ).toBe(400);
    const reloaded = new Store("file-demo", store.file);
    await reloaded.load();
    expect(
      reloaded.state.journeys.find((j) => j.id === journeyId)!.stages[1].status,
    ).toBe("active");
    expect(reloaded.state.audit.length).toBeGreaterThan(5);
  });
  it("rejects another journey socket token and scopes HTTP data", async () => {
    const r = await request(service.app)
      .post("/api/journeys")
      .auth(reception, { type: "bearer" })
      .send({ alias: "Second fictional visitor", rooms: ["lab"] });
    const j = (
      await request(service.app)
        .get("/api/journey")
        .auth(r.body.token, { type: "bearer" })
    ).body;
    expect(j.journey.id).not.toBe(journeyId);
    expect(
      j.notifications.every((n: any) => n.journeyId === j.journey.id),
    ).toBe(true);
    const port = (service.http.address() as { port: number }).port;
    const bad = clientIO(`http://localhost:${port}`, {
      auth: { token: "invalid" },
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      bad.once("connect_error", () => resolve());
      bad.once("connect", () => reject(Error("Unauthorized connection")));
    });
    bad.disconnect();
  });
  it("supports clinical priority instead of arrival time alone", async () => {
    const ids: string[] = [];
    for (const alias of ["Low priority", "High priority"]) {
      const r = await request(service.app)
        .post("/api/journeys")
        .auth(reception, { type: "bearer" })
        .send({ alias, rooms: ["triage"] });
      await request(service.app)
        .post("/api/location")
        .auth(r.body.token, { type: "bearer" })
        .send({ checkpoint: "QR-door-triage" });
      const ticket = await request(service.app)
        .post("/api/arrival")
        .auth(r.body.token, { type: "bearer" })
        .send({});
      ids.push(ticket.body.ticket.id);
    }
    await request(service.app)
      .post(`/api/tickets/${ids[1]}/action`)
      .auth(clinic, { type: "bearer" })
      .send({ action: "priority", priority: 5 });
    const call = await request(service.app)
      .post("/api/clinics/triage/call")
      .auth(clinic, { type: "bearer" })
      .send({});
    expect(call.body.ticket.id).toBe(ids[1]);
  });
  it("completes nonclinical exit without a clinic queue", async () => {
    const r = await request(service.app)
      .post("/api/journeys")
      .auth(reception, { type: "bearer" })
      .send({ alias: "Exit visitor", rooms: ["exit"] });
    await request(service.app)
      .post("/api/location")
      .auth(r.body.token, { type: "bearer" })
      .send({ checkpoint: "QR-door-exit" });
    expect(
      (
        await request(service.app)
          .post("/api/arrival")
          .auth(r.body.token, { type: "bearer" })
          .send({})
      ).body.completed,
    ).toBe(true);
  });
  it("inserts a clinically assigned next destination before previously pending stages", async () => {
    const created = await request(service.app)
      .post("/api/journeys")
      .auth(reception, { type: "bearer" })
      .send({ alias: "Assigned next", rooms: ["lab", "doctor"] });
    const token = created.body.token;
    await request(service.app)
      .post("/api/location")
      .auth(token, { type: "bearer" })
      .send({ checkpoint: "QR-door-lab" });
    const arrival = await request(service.app)
      .post("/api/arrival")
      .auth(token, { type: "bearer" })
      .send({});
    await request(service.app)
      .post("/api/clinics/lab/call")
      .auth(admin, { type: "bearer" })
      .send({});
    for (const action of ["arrived", "start"])
      await request(service.app)
        .post(`/api/tickets/${arrival.body.ticket.id}/action`)
        .auth(admin, { type: "bearer" })
        .send({ action });
    expect(
      (
        await request(service.app)
          .post(`/api/tickets/${arrival.body.ticket.id}/action`)
          .auth(admin, { type: "bearer" })
          .send({ action: "complete", nextRoom: "pharmacy" })
      ).status,
    ).toBe(200);
    const state = (
      await request(service.app)
        .get("/api/journey")
        .auth(token, { type: "bearer" })
    ).body;
    expect(
      state.journey.stages.find((s: any) => s.status === "active").roomId,
    ).toBe("pharmacy");
    expect(
      state.journey.stages.find((s: any) => s.roomId === "doctor").status,
    ).toBe("pending");
  });
  it("publishes validated map changes and persists the incremented version", async () => {
    const map = structuredClone(store.state.map);
    map.checkpoints.push(
      checkpointForNode(
        map,
        map.nodes.find((n) => n.id === "f0-c2")!,
        "QR-TEST-NEW",
      ),
    );
    expect(
      (
        await request(service.app)
          .put("/api/admin/map")
          .auth(admin, { type: "bearer" })
          .send(map)
      ).status,
    ).toBe(200);
    expect(store.state.map.version).toBe(2);
    const reloaded = new Store("file-demo", store.file);
    await reloaded.load();
    expect(
      reloaded.state.map.checkpoints.some((q) => q.id === "QR-TEST-NEW"),
    ).toBe(true);
  });
  it("creates a hashed staff account and revokes access on deactivation", async () => {
    const password = crypto.randomUUID() + crypto.randomUUID();
    const created = await request(service.app)
      .post("/api/admin/staff")
      .auth(admin, { type: "bearer" })
      .send({
        username: "new.clinic",
        password,
        role: "CLINIC",
        roomId: "lab",
      });
    expect(created.status).toBe(200);
    const record = store.state.staff.find((s) => s.id === created.body.id)!;
    expect(record.passwordHash).not.toBe(password);
    const login = await request(service.app)
      .post("/api/login")
      .send({ username: "new.clinic", password });
    expect(login.status).toBe(200);
    await request(service.app)
      .post(`/api/admin/staff/${record.id}/toggle`)
      .auth(admin, { type: "bearer" })
      .send({});
    expect(
      (
        await request(service.app)
          .get("/api/staff")
          .auth(login.body.token, { type: "bearer" })
      ).status,
    ).toBe(401);
  });
  it("rejects expired journeys and deactivated staff", async () => {
    const j = store.state.journeys.find((j) => j.id === journeyId)!;
    j.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(
      (
        await request(service.app)
          .get("/api/journey")
          .auth(patient, { type: "bearer" })
      ).status,
    ).toBe(401);
    store.state.staff.find((u) => u.id === "r")!.active = false;
    expect(
      (
        await request(service.app)
          .get("/api/staff")
          .auth(reception, { type: "bearer" })
      ).status,
    ).toBe(401);
  });
});

it("replays a completed reception stage without completing the next destination", async () => {
  const created = await request(service.app)
    .post("/api/journeys")
    .auth(admin, { type: "bearer" })
    .send({
      alias: "Replay test",
      rooms: ["reception", "triage"],
      accessible: false,
    });
  expect(created.status).toBe(200);
  const token = new URL(created.body.url).searchParams.get("journey")!;
  const j = (
    await request(service.app)
      .get("/api/journey")
      .auth(token, { type: "bearer" })
  ).body.journey;
  const stageId = j.stages[0].id;
  await request(service.app)
    .post("/api/location")
    .auth(token, { type: "bearer" })
    .send({ checkpoint: "QR-door-reception" });
  for (let i = 0; i < 2; i++)
    expect(
      (
        await request(service.app)
          .post("/api/arrival")
          .auth(token, { type: "bearer" })
          .send({ stageId })
      ).body.completed,
    ).toBe(true);
  const next = (
    await request(service.app)
      .get("/api/journey")
      .auth(token, { type: "bearer" })
  ).body.journey;
  expect(next.stages[1].status).toBe("active");
});

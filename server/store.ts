import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHospital } from "../shared/hospital";
import type { State } from "../shared/types";
import { upgradeCheckpointMetadata } from "../shared/checkpoints";
export const emptyState = (): State => ({
  map: createHospital(),
  staff: [],
  journeys: [],
  tickets: [],
  clinics: createHospital()
    .rooms.filter((r) =>
      ["clinic", "lab", "radiology", "pharmacy"].includes(r.type),
    )
    .map((r) => ({ roomId: r.id, status: "available" })),
  notifications: [],
  subscriptions: [],
  assistance: [],
  audit: [],
});
export class Store {
  state = emptyState();
  prisma?: PrismaClient;
  constructor(
    public mode = process.env.STORAGE_MODE ?? "postgres",
    public file = process.env.DEMO_DATA_FILE ?? ".data/demo.json",
  ) {}
  async load() {
    if (this.mode === "file-demo") {
      if (process.env.NODE_ENV === "production")
        throw Error("file-demo is prohibited in production");
      try {
        this.state = JSON.parse(await fs.readFile(this.file, "utf8"));
        this.state.map = upgradeCheckpointMetadata(this.state.map);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      return;
    }
    if (this.mode !== "postgres") throw Error("Invalid STORAGE_MODE");
    this.prisma = new PrismaClient();
    await this.prisma.$connect();
    const p = this.prisma,
      h = await p.hospital.findFirst();
    if (!h) throw Error("Database is empty. Run npm run db:seed.");
    const [
      floors,
      rooms,
      nodes,
      edges,
      checkpoints,
      users,
      journeys,
      tickets,
      clinics,
      notifications,
      assistance,
      audit,
      subscriptions,
    ] = await Promise.all([
      p.floor.findMany(),
      p.room.findMany({ include: { department: true } }),
      p.mapNode.findMany(),
      p.mapEdge.findMany(),
      p.qRCheckpoint.findMany(),
      p.user.findMany({ include: { profile: true } }),
      p.patientJourney.findMany({
        include: { stages: { orderBy: { position: "asc" } } },
      }),
      p.queueTicket.findMany(),
      p.clinicStatus.findMany(),
      p.notification.findMany(),
      p.assistanceRequest.findMany(),
      p.auditLog.findMany(),
      p.pushSubscription.findMany(),
    ]);
    const number = (id: string) => floors.find((f) => f.id === id)!.number;
    this.state = JSON.parse(
      JSON.stringify({
        map: {
          id: h.id,
          name: h.name,
          version: h.version,
          floors: floors.map((f) => ({
            id: f.number,
            name: f.name,
            corridors: f.corridors,
          })),
          rooms: rooms.map((r) => ({
            ...r,
            names: r.names,
            type: r.department.type,
            floor: number(r.floorId),
          })),
          nodes: nodes.map((n) => ({ ...n, floor: number(n.floorId) })),
          edges: edges.map((e) => ({ ...e, from: e.fromId, to: e.toId })),
          checkpoints: checkpoints.map((q) => ({
            ...q,
            floor: number(q.floorId),
          })),
        },
        staff: users.map((u) => ({
          ...u,
          roomId: u.profile?.roomId ?? undefined,
        })),
        journeys,
        tickets,
        clinics,
        notifications,
        assistance,
        audit,
        subscriptions,
      }),
    );
  }
  async save() {
    if (this.mode === "file-demo") {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file + ".tmp", JSON.stringify(this.state));
      await fs.rename(this.file + ".tmp", this.file);
      return;
    }
    const s = this.state;
    s.map = upgradeCheckpointMetadata(s.map);
    await this.prisma!.$transaction(
      async (p) => {
        await p.hospital.upsert({
          where: { id: s.map.id },
          create: { id: s.map.id, name: s.map.name, version: s.map.version },
          update: { name: s.map.name, version: s.map.version },
        });
        for (const f of s.map.floors)
          await p.floor.upsert({
            where: { id: `floor-${f.id}` },
            create: {
              id: `floor-${f.id}`,
              number: f.id,
              name: f.name,
              corridors: f.corridors,
              hospitalId: s.map.id,
            },
            update: { name: f.name, corridors: f.corridors },
          });
        for (const n of s.map.nodes) {
          const d = {
            x: n.x,
            y: n.y,
            kind: n.kind,
            accessible: n.accessible,
            floorId: `floor-${n.floor}`,
          };
          await p.mapNode.upsert({
            where: { id: n.id },
            create: { id: n.id, ...d },
            update: d,
          });
        }
        for (const r of s.map.rooms) {
          await p.department.upsert({
            where: { id: `dep-${r.id}` },
            create: {
              id: `dep-${r.id}`,
              names: r.names,
              type: r.type,
              hospitalId: s.map.id,
            },
            update: { names: r.names, type: r.type },
          });
          const d = {
            names: r.names,
            number: r.number,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            accessible: r.accessible,
            floorId: `floor-${r.floor}`,
            departmentId: `dep-${r.id}`,
            nodeId: r.nodeId,
          };
          await p.room.upsert({
            where: { id: r.id },
            create: { id: r.id, ...d },
            update: d,
          });
        }
        await p.mapEdge.deleteMany({
          where: { id: { notIn: s.map.edges.map((e) => e.id) } },
        });
        for (const e of s.map.edges) {
          const d = {
            fromId: e.from,
            toId: e.to,
            distance: e.distance,
            accessible: e.accessible,
            kind: e.kind,
          };
          await p.mapEdge.upsert({
            where: { id: e.id },
            create: { id: e.id, ...d },
            update: d,
          });
        }
        await p.qRCheckpoint.deleteMany({
          where: { id: { notIn: s.map.checkpoints.map((q) => q.id) } },
        });
        for (const q of s.map.checkpoints) {
          const { floor, ...data } = q;
          await p.qRCheckpoint.upsert({
            where: { id: q.id },
            create: data,
            update: data,
          });
        }
        // Deleting referenced rooms/nodes is intentionally refused by the API until historical references are migrated.
        for (const u of s.staff) {
          const d = {
            username: u.username,
            passwordHash: u.passwordHash,
            role: u.role,
            active: u.active,
          };
          await p.user.upsert({
            where: { id: u.id },
            create: { id: u.id, ...d },
            update: d,
          });
          await p.staffProfile.upsert({
            where: { userId: u.id },
            create: {
              id: `profile-${u.id}`,
              userId: u.id,
              roomId: u.roomId ?? null,
            },
            update: { roomId: u.roomId ?? null },
          });
        }
        for (const j of s.journeys) {
          const d = {
            alias: j.alias,
            tokenVersion: j.tokenVersion,
            expiresAt: new Date(j.expiresAt),
            location: j.location,
            confirmedAt: j.confirmedAt ? new Date(j.confirmedAt) : null,
            confirmedCheckpointId: j.confirmedCheckpointId ?? null,
            accessible: j.accessible,
            createdAt: new Date(j.createdAt),
          };
          await p.patientJourney.upsert({
            where: { id: j.id },
            create: { id: j.id, ...d },
            update: d,
          });
          for (const [position, stage] of j.stages.entries()) {
            const d = {
              journeyId: j.id,
              roomId: stage.roomId,
              position,
              status: stage.status,
              startedAt: stage.startedAt ? new Date(stage.startedAt) : null,
              completedAt: stage.completedAt
                ? new Date(stage.completedAt)
                : null,
            };
            await p.journeyStage.upsert({
              where: { id: stage.id },
              create: { id: stage.id, ...d },
              update: d,
            });
          }
        }
        for (const t of s.tickets) {
          const d = {
            journeyId: t.journeyId,
            roomId: t.roomId,
            status: t.status,
            priority: t.priority,
            createdAt: new Date(t.createdAt),
            calledAt: t.calledAt ? new Date(t.calledAt) : null,
            deadline: t.deadline ? new Date(t.deadline) : null,
            extraTime: t.extraTime,
            expiredReported: t.expiredReported ?? false,
          };
          await p.queueTicket.upsert({
            where: { id: t.id },
            create: { id: t.id, ...d },
            update: d,
          });
        }
        for (const c of s.clinics)
          await p.clinicStatus.upsert({
            where: { roomId: c.roomId },
            create: c,
            update: { status: c.status },
          });
        for (const n of s.notifications)
          await p.notification.upsert({
            where: { id: n.id },
            create: { ...n, createdAt: new Date(n.createdAt) },
            update: {},
          });
        for (const a of s.assistance)
          await p.assistanceRequest.upsert({
            where: { id: a.id },
            create: { ...a, createdAt: new Date(a.createdAt) },
            update: { resolved: a.resolved },
          });
        for (const a of s.audit)
          await p.auditLog.upsert({
            where: { id: a.id },
            create: { ...a, createdAt: new Date(a.createdAt) },
            update: {},
          });
        for (const sub of s.subscriptions)
          await p.pushSubscription.upsert({
            where: { id: sub.id },
            create: sub,
            update: { keys: sub.keys, language: sub.language },
          });
      },
      { timeout: 30000 },
    );
  }
  async close() {
    await this.prisma?.$disconnect();
  }
}

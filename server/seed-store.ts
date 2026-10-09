import type { Prisma } from "@prisma/client";
import type { State } from "../shared/types";

// Prepare data before acquiring a database transaction or holding locks.
export function prepareSeed(s: State) {
  if (
    s.notifications.length ||
    s.assistance.length ||
    s.audit.length ||
    s.subscriptions.length
  )
    throw Error(
      "Initial seed cannot contain existing notifications, assistance, audit or subscriptions.",
    );
  return {
    hospital: { id: s.map.id, name: s.map.name, version: s.map.version },
    floors: s.map.floors.map((f) => ({
      id: `floor-${f.id}`,
      number: f.id,
      name: f.name,
      corridors: f.corridors,
      hospitalId: s.map.id,
    })),
    nodes: s.map.nodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      kind: n.kind,
      accessible: n.accessible,
      floorId: `floor-${n.floor}`,
    })),
    departments: s.map.rooms.map((r) => ({
      id: `dep-${r.id}`,
      names: r.names,
      type: r.type,
      hospitalId: s.map.id,
    })),
    rooms: s.map.rooms.map((r) => ({
      id: r.id,
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
    })),
    edges: s.map.edges.map((e) => ({
      id: e.id,
      fromId: e.from,
      toId: e.to,
      distance: e.distance,
      accessible: e.accessible,
      kind: e.kind,
    })),
    checkpoints: s.map.checkpoints.map(({ floor: _floor, ...data }) => data),
    users: s.staff.map((u) => ({
      id: u.id,
      username: u.username,
      passwordHash: u.passwordHash,
      role: u.role,
      active: u.active,
    })),
    profiles: s.staff.map((u) => ({
      id: `profile-${u.id}`,
      userId: u.id,
      roomId: u.roomId ?? null,
    })),
    journeys: s.journeys.map((j) => ({
      id: j.id,
      alias: j.alias,
      tokenVersion: j.tokenVersion,
      expiresAt: new Date(j.expiresAt),
      location: j.location,
      confirmedAt: j.confirmedAt ? new Date(j.confirmedAt) : null,
      confirmedCheckpointId: j.confirmedCheckpointId ?? null,
      accessible: j.accessible,
      createdAt: new Date(j.createdAt),
    })),
    stages: s.journeys.flatMap((j) =>
      j.stages.map((stage, position) => ({
        id: stage.id,
        journeyId: j.id,
        roomId: stage.roomId,
        position,
        status: stage.status,
        startedAt: stage.startedAt ? new Date(stage.startedAt) : null,
        completedAt: stage.completedAt ? new Date(stage.completedAt) : null,
      })),
    ),
    tickets: s.tickets.map((t) => ({
      ...t,
      createdAt: new Date(t.createdAt),
      calledAt: t.calledAt ? new Date(t.calledAt) : null,
      deadline: t.deadline ? new Date(t.deadline) : null,
      expiredReported: t.expiredReported ?? false,
    })),
    clinics: s.clinics.map((c) => ({ ...c })),
  };
}

export async function saveSeed(
  p: Prisma.TransactionClient,
  data: ReturnType<typeof prepareSeed>,
) {
  // Transaction-scoped lock serializes concurrent seed processes. Rollback releases it.
  await p.$executeRaw`SELECT pg_advisory_xact_lock(1296126785)`;
  if (await p.user.count())
    throw Error("Seed refused: database already contains staff.");
  if (await p.hospital.count())
    throw Error(
      "Seed refused: database already contains hospital data; existing data was preserved.",
    );
  // Dependency order matters for foreign keys; each createMany is one bulk operation.
  // Do not skip duplicates: any unexpected conflict must roll back the entire seed.
  await p.hospital.create({ data: data.hospital });
  await p.floor.createMany({ data: data.floors });
  await p.mapNode.createMany({ data: data.nodes });
  await p.department.createMany({ data: data.departments });
  await p.room.createMany({ data: data.rooms });
  await p.mapEdge.createMany({ data: data.edges });
  await p.qRCheckpoint.createMany({ data: data.checkpoints });
  await p.user.createMany({ data: data.users });
  await p.staffProfile.createMany({ data: data.profiles });
  await p.patientJourney.createMany({ data: data.journeys });
  await p.journeyStage.createMany({ data: data.stages });
  await p.queueTicket.createMany({ data: data.tickets });
  await p.clinicStatus.createMany({ data: data.clinics });
}

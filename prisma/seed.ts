import "dotenv/config";
import bcrypt from "bcryptjs";
import { Store } from "../server/store";
import { randomUUID } from "node:crypto";
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 12)
  throw Error(
    "Set DEMO_PASSWORD (12+ characters); demo passwords are never shipped in source.",
  );
const store = new Store();
if (store.mode === "postgres") {
  const { PrismaClient } = await import("@prisma/client");
  store.prisma = new PrismaClient();
  await store.prisma.$connect();
  if (await store.prisma.user.count())
    throw Error("Seed refused: database already contains staff.");
} else await store.load();
if (store.state.staff.length)
  throw Error("Seed refused: demo store already contains staff.");
const hash = await bcrypt.hash(password, 12);
store.state.staff = [
  {
    id: randomUUID(),
    username: "admin.demo",
    role: "ADMIN",
    passwordHash: hash,
    active: true,
  },
  {
    id: randomUUID(),
    username: "reception.demo",
    role: "RECEPTION",
    passwordHash: hash,
    active: true,
  },
  {
    id: randomUUID(),
    username: "triage.demo",
    role: "CLINIC",
    roomId: "triage",
    passwordHash: hash,
    active: true,
  },
];
for (let i = 0; i < 3; i++) {
  const journeyId = randomUUID(),
    createdAt = new Date(Date.now() - (3 - i) * 60000).toISOString();
  store.state.journeys.push({
    id: journeyId,
    alias: `Demo ${i + 1}`,
    tokenVersion: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    location: "door-triage",
    accessible: false,
    createdAt,
    stages: [
      {
        id: randomUUID(),
        roomId: "triage",
        status: "active",
        startedAt: createdAt,
      },
      { id: randomUUID(), roomId: "doctor", status: "pending" },
      { id: randomUUID(), roomId: "pharmacy", status: "pending" },
    ],
  });
  store.state.tickets.push({
    id: randomUUID(),
    journeyId,
    roomId: "triage",
    status: "waiting",
    priority: 0,
    createdAt,
    extraTime: false,
  });
}
await store.save();
await store.close();
console.log(
  "Seed complete. Demo usernames: admin.demo, reception.demo, triage.demo. Password supplied through DEMO_PASSWORD.",
);

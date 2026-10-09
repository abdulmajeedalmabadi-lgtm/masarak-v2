import { expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { Store, emptyState } from "../server/store";
import { prepareSeed } from "../server/seed-store";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
const models = [
  "hospital",
  "floor",
  "mapNode",
  "department",
  "room",
  "mapEdge",
  "qRCheckpoint",
  "user",
  "staffProfile",
  "patientJourney",
  "journeyStage",
  "queueTicket",
  "clinicStatus",
];
function harness() {
  let committed: Record<string, any[]> = Object.fromEntries(
    models.map((m) => [m, []]),
  );
  let fail = false;
  const calls: string[] = [];
  const transaction = vi.fn(
    async (
      callback: (p: any) => Promise<unknown>,
      _options: { timeout: number; maxWait: number },
    ) => {
      const pending = structuredClone(committed);
      const tx: any = {
        $executeRaw: vi.fn(async () => {
          calls.push("seedLock");
        }),
      };
      for (const model of models)
        tx[model] = {
          count: vi.fn(async () => pending[model].length),
          create: vi.fn(async ({ data }: any) => {
            calls.push(model);
            pending[model].push(data);
          }),
          createMany: vi.fn(async ({ data, skipDuplicates }: any) => {
            expect(skipDuplicates).toBeUndefined();
            calls.push(model);
            if (model === "qRCheckpoint" && fail)
              throw Object.assign(Error("Expired transaction"), {
                code: "P2028",
              });
            pending[model].push(...data);
          }),
        };
      const result = await callback(tx);
      committed = pending;
      return result;
    },
  );
  const store = new Store("postgres");
  store.prisma = { $transaction: transaction } as unknown as PrismaClient;
  store.state.staff = [
    {
      id: "demo-user",
      username: "demo",
      passwordHash: "test-hash-only",
      role: "ADMIN",
      active: true,
    },
  ];
  store.state.journeys = [
    {
      id: "j",
      alias: "Test",
      tokenVersion: 1,
      expiresAt: "2099-01-01",
      createdAt: "2026-10-09",
      location: "door-triage",
      accessible: false,
      stages: [{ id: "stage", roomId: "triage", status: "active" }],
    },
  ];
  store.state.tickets = [
    {
      id: "ticket",
      journeyId: "j",
      roomId: "triage",
      status: "waiting",
      priority: 0,
      createdAt: "2026-10-09",
      extraTime: false,
    },
  ];
  return {
    store,
    transaction,
    calls,
    rows: () => committed,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
it("batches the whole seed in dependency order with a bounded Neon timeout", async () => {
  const h = harness();
  await h.store.save({ seed: true });
  expect(h.transaction).toHaveBeenCalledOnce();
  expect(h.transaction.mock.calls[0][1]).toEqual({
    timeout: 120000,
    maxWait: 15000,
  });
  expect(h.calls).toEqual(["seedLock", ...models]);
  expect(h.rows().qRCheckpoint).toHaveLength(37);
  expect(h.rows().floor).toHaveLength(2);
  expect(h.rows().room.length).toBe(h.store.state.map.rooms.length);
  expect(h.rows().journeyStage[0].journeyId).toBe("j");
  expect(h.rows().staffProfile[0].userId).toBe("demo-user");
});
it("rolls back a failed checkpoint batch and can retry without duplicate data", async () => {
  const h = harness();
  h.fail(true);
  await expect(h.store.save({ seed: true })).rejects.toMatchObject({
    code: "P2028",
  });
  expect(Object.values(h.rows()).every((rows) => rows.length === 0)).toBe(true);
  h.fail(false);
  await h.store.save({ seed: true });
  expect(h.rows().user).toHaveLength(1);
  expect(h.rows().qRCheckpoint).toHaveLength(37);
  const before = structuredClone(h.rows());
  await expect(h.store.save({ seed: true })).rejects.toThrow(
    "already contains staff",
  );
  expect(h.rows()).toEqual(before);
});
it("refuses an existing hospital even if it has no staff and preserves its map", async () => {
  const h = harness();
  h.store.state.staff = [];
  await h.store.save({ seed: true });
  const before = structuredClone(h.rows());
  await expect(h.store.save({ seed: true })).rejects.toThrow(
    "already contains hospital data",
  );
  expect(h.rows()).toEqual(before);
});
it("supports explicit timeout tuning and rejects invalid values before opening a transaction", async () => {
  const h = harness();
  for (const timeout of [NaN, Infinity, 0, -1, 600001, 1.5])
    await expect(h.store.save({ seed: true, timeout })).rejects.toThrow(
      "Transaction timeout",
    );
  expect(h.transaction).not.toHaveBeenCalled();
  await h.store.save({ seed: true, timeout: 180000, maxWait: 20000 });
  expect(h.transaction.mock.calls[0][1]).toEqual({
    timeout: 180000,
    maxWait: 20000,
  });
});
it("prepares scalar rows and dates without losing QR metadata", () => {
  const state = emptyState(),
    data = prepareSeed(state);
  expect(data.checkpoints[0]).not.toHaveProperty("floor");
  expect(data.checkpoints[0]).toMatchObject({
    hospitalId: state.map.id,
    floorId: expect.any(String),
    nodeId: expect.any(String),
    x: expect.any(Number),
    y: expect.any(Number),
  });
  expect(
    data.rooms.every((r) => data.nodes.some((n) => n.id === r.nodeId)),
  ).toBe(true);
  expect(
    data.edges.every(
      (e) =>
        data.nodes.some((n) => n.id === e.fromId) &&
        data.nodes.some((n) => n.id === e.toId),
    ),
  ).toBe(true);
});
it("runs the seed CLI with isolated file-demo data and refuses a successful rerun without exposing the password", async () => {
  const root = path.resolve(".data");
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, "seed-cli-test-"));
  const file = path.join(dir, "seed.json"),
    password = randomBytes(24).toString("hex");
  const run = () =>
    spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        STORAGE_MODE: "file-demo",
        DEMO_DATA_FILE: file,
        DEMO_PASSWORD: password,
      },
      timeout: 10000,
    });
  try {
    const first = run();
    expect(first.status).toBe(0);
    const before = await fs.readFile(file, "utf8"),
      state = JSON.parse(before);
    expect(state.staff).toHaveLength(3);
    expect(state.journeys).toHaveLength(3);
    expect(state.tickets).toHaveLength(3);
    expect(state.map.checkpoints).toHaveLength(37);
    expect(first.stdout + first.stderr).not.toContain(password);
    const second = run();
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("already contains staff");
    expect(second.stdout + second.stderr).not.toContain(password);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  } finally {
    if (!dir.startsWith(root + path.sep))
      throw Error("Unexpected test directory");
    await fs.rm(dir, { recursive: true, force: true });
  }
});

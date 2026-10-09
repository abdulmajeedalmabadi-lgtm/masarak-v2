import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createServer } from "node:http";
import { Server } from "socket.io";
import QRCode from "qrcode";
import webpush from "web-push";
import { Store } from "./store";
import { findRoute, validateMap, routeSteps } from "../shared/navigation";
import {
  checkpointForNode,
  parseCheckpointPayload,
} from "../shared/checkpoints";
import { checkpointInput, checkpointQR } from "./qr";
import type { HospitalMap, Journey, Role } from "../shared/types";
const id = () => randomUUID(),
  now = () => new Date().toISOString();
type Auth = { kind: "staff" | "journey"; id: string; version?: number };
export function createApp(store: Store, secret: string, origins: string[]) {
  const app = express(),
    http = createServer(app),
    io = new Server(http, { cors: { origin: origins, credentials: false } });
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", rateLimit({ windowMs: 60000, limit: 180 }));
  const authenticate = (token: string): Auth => {
    const a = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "masarak",
      audience: "masarak",
    }) as Auth;
    if (a.kind === "staff") {
      if (!store.state.staff.some((u) => u.id === a.id && u.active))
        throw Error("unauthorized");
    } else if (a.kind === "journey") {
      const j = store.state.journeys.find((j) => j.id === a.id);
      if (
        !j ||
        j.tokenVersion !== a.version ||
        Date.parse(j.expiresAt) < Date.now()
      )
        throw Error("unauthorized");
    } else throw Error("unauthorized");
    return a;
  };
  const sign = (a: Auth, seconds: number) =>
    jwt.sign(a, secret, {
      expiresIn: seconds,
      issuer: "masarak",
      audience: "masarak",
    });
  const journeyToken = (j: Journey) =>
    sign(
      { kind: "journey", id: j.id, version: j.tokenVersion },
      Math.max(1, Math.floor((Date.parse(j.expiresAt) - Date.now()) / 1000)),
    );
  io.use((socket, next) => {
    try {
      socket.data.auth = authenticate(socket.handshake.auth.token);
      next();
    } catch {
      next(Error("unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    const a = socket.data.auth as Auth;
    socket.join(a.kind === "journey" ? `journey:${a.id}` : "staff");
    const expiry = setInterval(() => {
      try {
        authenticate(socket.handshake.auth.token);
      } catch {
        socket.disconnect(true);
      }
    }, 30000);
    socket.on("disconnect", () => clearInterval(expiry));
  });
  const notice = (journeyId: string, key: string, roomId?: string) =>
    store.state.notifications.push({
      id: id(),
      journeyId,
      key,
      roomId,
      createdAt: now(),
    });
  const pushEnabled = !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
  if (pushEnabled)
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
  const pushed = new Set(store.state.notifications.map((n) => n.id));
  const pushTitles: Record<string, string> = {
    ar: "حان دورك الآن",
    en: "It is your turn",
    ur: "اب آپ کی باری ہے",
    fr: "C’est votre tour",
    tr: "Sıra sizde",
    id: "Sekarang giliran Anda",
  };
  const emit = () => {
    io.to("staff").emit("update");
    for (const j of store.state.journeys)
      io.to(`journey:${j.id}`).emit("update");
    for (const n of store.state.notifications) {
      if (pushed.has(n.id)) continue;
      pushed.add(n.id);
      if (pushEnabled && n.key === "yourTurn")
        for (const sub of store.state.subscriptions.filter(
          (s) => s.journeyId === n.journeyId,
        ))
          void webpush
            .sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys },
              JSON.stringify({
                title: pushTitles[sub.language] ?? pushTitles.ar,
                tag: n.id,
                url: "/turn",
              }),
              { TTL: 300 },
            )
            .catch(() =>
              console.warn(
                "Web Push delivery failed; in-app notification remains available.",
              ),
            );
    }
  };
  let lock: Promise<unknown> = Promise.resolve();
  const route = (
    method: "get" | "post" | "put" | "delete",
    url: string,
    roles: Role[] | "journey" | "any" | null,
    fn: (req: express.Request, a: Auth | null) => unknown,
    mutates = false,
  ) => {
    app[method](url, async (req, res, next) => {
      let a: Auth | null = null;
      try {
        if (roles) {
          try {
            a = authenticate(
              (req.headers.authorization ?? "").replace(/^Bearer /, ""),
            );
          } catch {
            return void res.status(401).json({ error: "unauthorized" });
          }
          if (Array.isArray(roles)) {
            const user = store.state.staff.find((u) => u.id === a!.id);
            if (a.kind !== "staff" || !user || !roles.includes(user.role))
              return void res.status(403).json({ error: "forbidden" });
          }
          if (roles === "journey" && a.kind !== "journey")
            return void res.status(403).json({ error: "forbidden" });
        }
        const execute = async () => {
          const backup = mutates ? structuredClone(store.state) : null;
          try {
            const result = await fn(req, a);
            if (mutates) {
              store.state.audit.push({
                id: id(),
                actor: a?.id ?? "system",
                action: `${method.toUpperCase()} ${url}`,
                createdAt: now(),
              });
              await store.save();
              emit();
            }
            return result;
          } catch (e) {
            if (backup) store.state = backup;
            throw e;
          }
        };
        const operation = mutates ? lock.then(execute) : execute();
        if (mutates) lock = operation.catch(() => {});
        res.json(await operation);
      } catch (e) {
        next(e);
      }
    });
  };
  const fail = (error: string, status = 400) => {
    throw Object.assign(Error(error), { status });
  };
  const own = (a: Auth | null) =>
    store.state.journeys.find((j) => j.id === a!.id)!;
  const staffRoom = (a: Auth | null, roomId: string) => {
    const u = store.state.staff.find((u) => u.id === a!.id)!;
    if (u.role === "CLINIC" && u.roomId !== roomId) fail("forbidden", 403);
  };
  const ticket = (a: Auth | null, ticketId: string) => {
    const t = store.state.tickets.find((t) => t.id === ticketId);
    if (!t) fail("notFound", 404);
    staffRoom(a, t!.roomId);
    return t!;
  };
  const activate = (j: Journey) => {
    const s = j.stages.find((s) => s.status === "pending");
    if (s) {
      s.status = "active";
      s.startedAt = now();
      notice(j.id, "nextDestination", s.roomId);
    }
  };
  route("get", "/api/health", null, () => ({
    ok: true,
    storage: store.mode,
    mapVersion: store.state.map.version,
  }));
  route("get", "/api/map", null, () => store.state.map);
  route("get", "/api/push/key", null, () => ({
    publicKey: pushEnabled ? process.env.VAPID_PUBLIC_KEY : null,
  }));
  route(
    "post",
    "/api/push/subscribe",
    "journey",
    (req, a) => {
      if (!pushEnabled) fail("notificationDenied");
      const b = z
        .object({
          endpoint: z.string().url().max(2048),
          keys: z.object({
            p256dh: z.string().min(20).max(300),
            auth: z.string().min(10).max(100),
          }),
          language: z.enum(["ar", "en", "ur", "fr", "tr", "id"]),
        })
        .parse(req.body);
      const url = new URL(b.endpoint),
        hosts = [
          "fcm.googleapis.com",
          "updates.push.services.mozilla.com",
          "web.push.apple.com",
        ];
      if (
        url.protocol !== "https:" ||
        !hosts.includes(url.hostname) ||
        url.port ||
        url.username ||
        url.password
      )
        fail("invalidInput");
      const existing = store.state.subscriptions.find(
        (s) => s.journeyId === a!.id && s.endpoint === b.endpoint,
      );
      if (existing) {
        existing.keys = b.keys;
        existing.language = b.language;
      } else {
        if (
          store.state.subscriptions.filter((s) => s.journeyId === a!.id)
            .length >= 5
        )
          fail("invalidInput");
        store.state.subscriptions.push({ id: id(), journeyId: a!.id, ...b });
      }
      return { ok: true };
    },
    true,
  );
  app.use("/api/login", rateLimit({ windowMs: 15 * 60000, limit: 30 }));
  route("post", "/api/login", null, async (req) => {
    const input = z
      .object({
        username: z.string().min(1).max(80),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const u = store.state.staff.find(
      (u) => u.username === input.username && u.active,
    );
    if (!u || !(await bcrypt.compare(input.password, u.passwordHash)))
      fail("invalidLogin", 401);
    return {
      token: sign({ kind: "staff", id: u!.id }, 8 * 3600),
      user: {
        id: u!.id,
        username: u!.username,
        role: u!.role,
        roomId: u!.roomId,
      },
    };
  });
  route("get", "/api/staff", ["ADMIN", "RECEPTION", "CLINIC"], (_, a) => {
    const u = store.state.staff.find((u) => u.id === a!.id)!;
    const { passwordHash, ...user } = u;
    return {
      user,
      journeys:
        u.role === "CLINIC"
          ? store.state.journeys.filter((j) =>
              j.stages.some((s) => s.roomId === u.roomId),
            )
          : store.state.journeys,
      tickets: store.state.tickets.filter(
        (t) => u.role !== "CLINIC" || t.roomId === u.roomId,
      ),
      clinics: store.state.clinics,
      assistance: u.role === "CLINIC" ? [] : store.state.assistance,
      staff:
        u.role === "ADMIN"
          ? store.state.staff.map(({ passwordHash, ...u }) => u)
          : [],
      stats: {
        journeys: store.state.journeys.length,
        requests: store.state.assistance.length,
        mapVersion: store.state.map.version,
        navigationUpdates: store.state.audit.filter(
          (a) => a.action === "POST /api/location",
        ).length,
        completedStages: store.state.journeys.reduce(
          (count, j) =>
            count + j.stages.filter((s) => s.status === "complete").length,
          0,
        ),
      },
    };
  });
  route(
    "post",
    "/api/journeys",
    ["RECEPTION", "ADMIN"],
    (req) => {
      const b = z
        .object({
          alias: z.string().min(1).max(40),
          rooms: z.array(z.string()).min(1).max(12),
          accessible: z.boolean().default(false),
        })
        .parse(req.body);
      if (
        b.rooms.some((r) => !store.state.map.rooms.some((x) => x.id === r)) ||
        new Set(b.rooms).size !== b.rooms.length
      )
        fail("invalidInput");
      const j: Journey = {
        id: id(),
        alias: b.alias,
        expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
        tokenVersion: 1,
        location: "door-reception",
        accessible: b.accessible,
        createdAt: now(),
        stages: b.rooms.map((roomId) => ({
          id: id(),
          roomId,
          status: "pending",
        })),
      };
      activate(j);
      store.state.journeys.push(j);
      const token = journeyToken(j);
      return {
        journey: j,
        token,
        url: `${process.env.PUBLIC_APP_URL ?? origins[0]}/?journey=${encodeURIComponent(token)}`,
      };
    },
    true,
  );
  route("get", "/api/journeys/:id/link", ["RECEPTION", "ADMIN"], (req) => {
    const j = store.state.journeys.find((j) => j.id === req.params.id);
    if (!j || Date.parse(j.expiresAt) < Date.now()) fail("notFound", 404);
    const token = journeyToken(j!);
    return {
      token,
      url: `${process.env.PUBLIC_APP_URL ?? origins[0]}/?journey=${encodeURIComponent(token)}`,
    };
  });
  route(
    "post",
    "/api/journeys/:id/destinations",
    ["RECEPTION", "ADMIN"],
    (req) => {
      const j = store.state.journeys.find((j) => j.id === req.params.id);
      if (!j) fail("notFound", 404);
      const b = z
        .object({ rooms: z.array(z.string()).min(1).max(12) })
        .parse(req.body);
      if (b.rooms.some((r) => !store.state.map.rooms.some((x) => x.id === r)))
        fail("invalidInput");
      for (const s of j!.stages.filter((s) =>
        ["active", "pending"].includes(s.status),
      )) {
        s.status = "skipped";
        s.completedAt = now();
      }
      for (const t of store.state.tickets.filter(
        (t) =>
          t.journeyId === j!.id && !["complete", "missed"].includes(t.status),
      ))
        t.status = "missed";
      j!.stages.push(
        ...b.rooms.map((roomId) => ({
          id: id(),
          roomId,
          status: "pending" as const,
        })),
      );
      activate(j!);
      return { ok: true };
    },
    true,
  );
  route("get", "/api/journey", "journey", (_, a) => {
    const j = own(a),
      active = j.stages.find((s) => s.status === "active"),
      t = store.state.tickets.find(
        (t) =>
          t.journeyId === j.id &&
          t.roomId === active?.roomId &&
          !["complete", "missed"].includes(t.status),
      );
    const ahead = t
      ? store.state.tickets.filter(
          (x) =>
            x.roomId === t.roomId &&
            x.id !== t.id &&
            (["called", "arrived", "consulting"].includes(x.status) ||
              (x.status === "waiting" &&
                (x.priority > t.priority ||
                  (x.priority === t.priority && x.createdAt < t.createdAt)))),
        ).length
      : 0;
    return {
      journey: j,
      ticket: t ?? null,
      ahead,
      waitMinutes: ahead * 4,
      clinic: store.state.clinics.find((c) => c.roomId === active?.roomId),
      notifications: store.state.notifications.filter(
        (n) => n.journeyId === j.id,
      ),
    };
  });
  route(
    "post",
    "/api/location",
    "journey",
    (req, a) => {
      const b = z
        .object({
          checkpoint: z.string().min(1).max(4096).optional(),
          hospitalId: z.string().max(100).optional(),
          nodeId: z.string().min(1).max(100).optional(),
        })
        .refine((b) => !!b.checkpoint !== !!b.nodeId)
        .parse(req.body);
      let nodeId = b.nodeId;
      let confirmed = null;
      if (b.checkpoint) {
        const decoded = parseCheckpointPayload(b.checkpoint);
        if (
          !decoded ||
          (decoded.hospitalId && decoded.hospitalId !== store.state.map.id) ||
          (b.hospitalId && b.hospitalId !== store.state.map.id)
        )
          fail("invalidCheckpoint");
        confirmed =
          store.state.map.checkpoints.find(
            (q) => q.id === decoded!.checkpointId,
          ) ?? null;
        nodeId = confirmed?.nodeId;
      }
      if (!nodeId || !store.state.map.nodes.some((n) => n.id === nodeId))
        fail("invalidCheckpoint");
      const j = own(a),
        stage = j.stages.find((s) => s.status === "active"),
        destination = store.state.map.rooms.find((r) => r.id === stage?.roomId);
      const previous = destination
        ? findRoute(
            store.state.map,
            j.location,
            destination.nodeId,
            j.accessible,
          )
        : null;
      j.location = nodeId!;
      j.confirmedAt = now();
      j.confirmedCheckpointId = confirmed?.id;
      const calculated = destination
        ? findRoute(
            store.state.map,
            j.location,
            destination.nodeId,
            j.accessible,
          )
        : null;
      return {
        ok: true,
        checkpoint: confirmed,
        location: store.state.map.nodes.find((n) => n.id === nodeId),
        confirmedAt: j.confirmedAt,
        rerouted: !!previous && !previous.nodes.some((n) => n.id === nodeId),
        route: calculated,
        steps: calculated ? routeSteps(store.state.map, calculated.nodes) : [],
      };
    },
    true,
  );
  route(
    "post",
    "/api/accessibility",
    "journey",
    (req, a) => {
      own(a).accessible = z
        .object({ accessible: z.boolean() })
        .parse(req.body).accessible;
      return { ok: true };
    },
    true,
  );
  route("get", "/api/route", "journey", (req, a) => {
    const j = own(a),
      s = j.stages.find((s) => s.status === "active");
    if (!s) return { route: null };
    const room = store.state.map.rooms.find((r) => r.id === s.roomId)!;
    return {
      route: findRoute(store.state.map, j.location, room.nodeId, j.accessible),
    };
  });
  route(
    "post",
    "/api/arrival",
    "journey",
    (req, a) => {
      const j = own(a);
      const requested = z
        .object({ stageId: z.string().optional() })
        .parse(req.body ?? {}).stageId;
      if (requested) {
        const previous = j.stages.find((stage) => stage.id === requested);
        if (!previous) fail("invalidState");
        if (previous!.status === "complete") return { completed: true };
        if (previous!.status !== "active") fail("invalidState");
      }
      const s = j.stages.find((s) => s.status === "active");
      if (!s) fail("invalidState");
      const r = store.state.map.rooms.find((r) => r.id === s!.roomId)!;
      if (
        j.location !== r.nodeId ||
        !store.state.map.checkpoints.some(
          (q) => q.id === j.confirmedCheckpointId && q.nodeId === r.nodeId,
        )
      )
        fail("arrivalLocation");
      if (["reception", "exit"].includes(r.type)) {
        s!.status = "complete";
        s!.completedAt = now();
        activate(j);
        notice(j.id, "stageComplete", r.id);
        return { completed: true };
      }
      if (!store.state.clinics.some((c) => c.roomId === r.id))
        fail("invalidState");
      const existing = store.state.tickets.find(
        (t) =>
          t.journeyId === j.id &&
          t.roomId === r.id &&
          !["complete", "missed"].includes(t.status),
      );
      if (existing) {
        if (existing.status === "called") existing.status = "arrived";
        return { ticket: existing };
      }
      const t = {
        id: id(),
        journeyId: j.id,
        roomId: r.id,
        status: "waiting" as const,
        priority: 0,
        createdAt: now(),
        extraTime: false,
      };
      store.state.tickets.push(t);
      notice(j.id, "queueJoined", r.id);
      return { ticket: t };
    },
    true,
  );
  route(
    "post",
    "/api/assistance",
    "journey",
    (_, a) => {
      const j = own(a);
      if (
        !store.state.assistance.some((x) => x.journeyId === j.id && !x.resolved)
      )
        store.state.assistance.push({
          id: id(),
          journeyId: j.id,
          location: j.location,
          resolved: false,
          createdAt: now(),
        });
      notice(j.id, "assistanceSent");
      return { ok: true };
    },
    true,
  );
  route(
    "post",
    "/api/assistance/:id/resolve",
    ["RECEPTION", "ADMIN"],
    (req) => {
      const x = store.state.assistance.find((x) => x.id === req.params.id);
      if (!x) fail("notFound", 404);
      x!.resolved = true;
      return { ok: true };
    },
    true,
  );
  route(
    "post",
    "/api/extra-time",
    "journey",
    (_, a) => {
      const t = store.state.tickets.find(
        (t) => t.journeyId === a!.id && t.status === "called",
      );
      if (!t) fail("invalidState");
      t!.extraTime = true;
      return { ok: true };
    },
    true,
  );
  route(
    "put",
    "/api/clinics/:id",
    ["ADMIN", "CLINIC"],
    (req, a) => {
      staffRoom(a, req.params.id);
      const status = z
        .enum(["available", "busy", "closed", "paused", "waiting", "ready"])
        .parse(req.body.status);
      const c = store.state.clinics.find((c) => c.roomId === req.params.id);
      if (!c) fail("notFound", 404);
      c!.status = status;
      return { ok: true };
    },
    true,
  );
  route(
    "post",
    "/api/clinics/:id/call",
    ["ADMIN", "CLINIC"],
    (req, a) => {
      staffRoom(a, req.params.id);
      if (
        ["closed", "paused"].includes(
          store.state.clinics.find((c) => c.roomId === req.params.id)?.status ??
            "",
        )
      )
        fail("invalidState");
      if (
        store.state.tickets.some(
          (t) =>
            t.roomId === req.params.id &&
            ["called", "arrived", "consulting"].includes(t.status),
        )
      )
        fail("activeConsultation");
      const t = store.state.tickets
        .filter((t) => t.roomId === req.params.id && t.status === "waiting")
        .sort(
          (a, b) =>
            b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
        )[0];
      if (!t) fail("emptyQueue");
      t.status = "called";
      t.calledAt = now();
      t.deadline = new Date(Date.now() + 300000).toISOString();
      notice(t.journeyId, "yourTurn", t.roomId);
      return { ticket: t };
    },
    true,
  );
  route(
    "post",
    "/api/tickets/:id/action",
    ["ADMIN", "CLINIC"],
    (req, a) => {
      const t = ticket(a, req.params.id),
        b = z
          .object({
            action: z.enum([
              "arrived",
              "start",
              "complete",
              "missed",
              "recall",
              "extend",
              "priority",
              "notify",
            ]),
            priority: z.number().int().min(0).max(5).optional(),
            nextRoom: z.string().optional(),
          })
          .parse(req.body),
        j = store.state.journeys.find((j) => j.id === t.journeyId)!;
      if (b.action === "priority") {
        if (t.status !== "waiting" || b.priority === undefined)
          fail("invalidState");
        t.priority = b.priority!;
      } else if (b.action === "notify") notice(j.id, "staffMessage", t.roomId);
      else if (b.action === "extend") {
        if (t.status !== "called") fail("invalidState");
        t.deadline = new Date(Date.now() + 300000).toISOString();
        t.extraTime = false;
        t.expiredReported = false;
        notice(j.id, "timeExtended", t.roomId);
      } else if (b.action === "recall") {
        if (!["called", "missed"].includes(t.status)) fail("invalidState");
        if (
          store.state.tickets.some(
            (x) =>
              x.id !== t.id &&
              x.roomId === t.roomId &&
              ["called", "arrived", "consulting"].includes(x.status),
          )
        )
          fail("activeConsultation");
        t.status = "called";
        t.calledAt = now();
        t.deadline = new Date(Date.now() + 300000).toISOString();
        t.expiredReported = false;
        notice(j.id, "yourTurn", t.roomId);
      } else if (b.action === "arrived") {
        if (t.status !== "called") fail("invalidState");
        t.status = "arrived";
      } else if (b.action === "start") {
        if (t.status !== "arrived") fail("invalidState");
        t.status = "consulting";
      } else if (b.action === "missed") {
        if (t.status !== "called") fail("invalidState");
        t.status = "missed";
        notice(j.id, "missedTurn", t.roomId);
      } else {
        if (t.status !== "consulting") fail("invalidState");
        const s = j.stages.find(
          (s) => s.status === "active" && s.roomId === t.roomId,
        );
        if (!s) fail("invalidState");
        if (
          b.nextRoom &&
          !store.state.map.rooms.some((r) => r.id === b.nextRoom)
        )
          fail("invalidInput");
        t.status = "complete";
        s!.status = "complete";
        s!.completedAt = now();
        if (b.nextRoom) {
          const firstPending = j.stages.findIndex(
            (stage) => stage.status === "pending",
          );
          j.stages.splice(
            firstPending < 0 ? j.stages.length : firstPending,
            0,
            {
              id: id(),
              roomId: b.nextRoom,
              status: "pending",
            },
          );
        }
        activate(j);
        notice(j.id, "stageComplete", t.roomId);
      }
      return { ok: true };
    },
    true,
  );
  route("get", "/api/qr", ["ADMIN", "RECEPTION"], async (req) => {
    const value = z.string().min(1).max(4000).parse(req.query.value);
    return { image: await QRCode.toDataURL(value, { width: 300, margin: 2 }) };
  });
  const qrAppUrl = process.env.PUBLIC_APP_URL ?? origins[0];
  route("get", "/api/checkpoints/:id", null, (req) => {
    const q = store.state.map.checkpoints.find((q) => q.id === req.params.id);
    if (!q) fail("invalidCheckpoint", 404);
    return q;
  });
  route(
    "get",
    "/api/admin/checkpoints",
    ["ADMIN", "RECEPTION"],
    () => store.state.map.checkpoints,
  );
  route(
    "post",
    "/api/admin/checkpoints",
    ["ADMIN"],
    (req) => {
      const b = checkpointInput.parse(req.body),
        n = store.state.map.nodes.find((n) => n.id === b.nodeId);
      if (!n) fail("invalidCheckpoint");
      if (store.state.map.checkpoints.some((q) => q.id === b.id))
        fail("checkpointExists", 409);
      const q = checkpointForNode(store.state.map, n!, b.id, b.names);
      store.state.map.checkpoints.push(q);
      store.state.map.version++;
      return q;
    },
    true,
  );
  route(
    "put",
    "/api/admin/checkpoints/:id",
    ["ADMIN"],
    (req) => {
      const b = checkpointInput.omit({ id: true }).parse(req.body),
        n = store.state.map.nodes.find((n) => n.id === b.nodeId),
        index = store.state.map.checkpoints.findIndex(
          (q) => q.id === req.params.id,
        );
      if (index < 0) fail("notFound", 404);
      if (!n) fail("invalidCheckpoint");
      const q = checkpointForNode(store.state.map, n!, req.params.id, b.names);
      store.state.map.checkpoints[index] = q;
      store.state.map.version++;
      return q;
    },
    true,
  );
  route(
    "delete",
    "/api/admin/checkpoints/:id",
    ["ADMIN"],
    (req) => {
      const index = store.state.map.checkpoints.findIndex(
        (q) => q.id === req.params.id,
      );
      if (index < 0) fail("notFound", 404);
      store.state.map.checkpoints.splice(index, 1);
      store.state.map.version++;
      return { ok: true };
    },
    true,
  );
  route(
    "get",
    "/api/admin/checkpoints/:id/qr",
    ["ADMIN", "RECEPTION"],
    (req) => {
      const q = store.state.map.checkpoints.find((q) => q.id === req.params.id);
      if (!q) fail("notFound", 404);
      return checkpointQR(q!, qrAppUrl);
    },
  );
  route(
    "get",
    "/api/admin/checkpoints/print/all",
    ["ADMIN", "RECEPTION"],
    async () => ({
      version: store.state.map.version,
      labels: await Promise.all(
        store.state.map.checkpoints.map((q) => checkpointQR(q, qrAppUrl)),
      ),
    }),
  );
  route(
    "put",
    "/api/admin/map",
    ["ADMIN"],
    (req) => {
      const node = z.object({
        id: z.string().min(1),
        x: z.number().finite(),
        y: z.number().finite(),
        floor: z.number().int(),
        kind: z.enum([
          "corridor",
          "intersection",
          "door",
          "elevator",
          "stairs",
        ]),
        accessible: z.boolean(),
      });
      const edge = z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        distance: z.number().positive(),
        accessible: z.boolean(),
        kind: z.enum(["corridor", "elevator", "stairs"]),
      });
      const room = z.object({
        id: z.string(),
        names: z.record(z.string()),
        number: z.string(),
        floor: z.number().int(),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        nodeId: z.string(),
        type: z.string(),
        accessible: z.boolean(),
      });
      const input = z
        .object({
          id: z.string(),
          name: z.string(),
          version: z.number().int(),
          floors: z
            .array(
              z.object({
                id: z.number().int(),
                name: z.string(),
                corridors: z
                  .array(
                    z.object({
                      id: z.string(),
                      x: z.number(),
                      y: z.number(),
                      width: z.number().positive(),
                      height: z.number().positive(),
                    }),
                  )
                  .min(1)
                  .max(50),
              }),
            )
            .min(1),
          nodes: z.array(node).min(1).max(300),
          edges: z.array(edge).max(800),
          rooms: z.array(room).max(100),
          checkpoints: z.array(checkpointInput).max(300),
        })
        .parse(req.body);
      const map: HospitalMap = { ...input, checkpoints: [] };
      map.checkpoints = input.checkpoints.map((q) => {
        const n = map.nodes.find((n) => n.id === q.nodeId);
        if (!n) fail("invalidCheckpoint");
        return checkpointForNode(map, n!, q.id, q.names);
      });
      if (
        map.id !== store.state.map.id ||
        store.state.map.rooms.some(
          (r) => !map.rooms.some((x) => x.id === r.id),
        ) ||
        store.state.map.nodes.some((n) => !map.nodes.some((x) => x.id === n.id))
      )
        fail("referencedMapData");
      const errors = validateMap(map);
      if (errors.length) fail("mapInvalid:" + errors.join(","));
      map.version = store.state.map.version + 1;
      store.state.map = map;
      for (const r of map.rooms.filter((r) =>
        ["clinic", "lab", "radiology", "pharmacy"].includes(r.type),
      ))
        if (!store.state.clinics.some((c) => c.roomId === r.id))
          store.state.clinics.push({ roomId: r.id, status: "available" });
      return { ok: true };
    },
    true,
  );
  route(
    "post",
    "/api/admin/staff",
    ["ADMIN"],
    async (req) => {
      const b = z
        .object({
          username: z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),
          password: z.string().min(12).max(200),
          role: z.enum(["ADMIN", "RECEPTION", "CLINIC"]),
          roomId: z.string().optional(),
        })
        .parse(req.body);
      if (store.state.staff.some((u) => u.username === b.username))
        fail("invalidInput");
      if (
        b.role === "CLINIC" &&
        !store.state.clinics.some((c) => c.roomId === b.roomId)
      )
        fail("invalidInput");
      const u = {
        id: id(),
        username: b.username,
        passwordHash: await bcrypt.hash(b.password, 12),
        role: b.role,
        roomId: b.role === "CLINIC" ? b.roomId : undefined,
        active: true,
      };
      store.state.staff.push(u);
      return { id: u.id };
    },
    true,
  );
  route(
    "post",
    "/api/admin/staff/:id/toggle",
    ["ADMIN"],
    (req, a) => {
      if (req.params.id === a!.id) fail("invalidInput");
      const u = store.state.staff.find((u) => u.id === req.params.id);
      if (!u) fail("notFound", 404);
      u!.active = !u!.active;
      return { ok: true };
    },
    true,
  );
  app.use("/api", (_, res) => res.status(404).json({ error: "notFound" }));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const e = err as Error & { status?: number };
      const validation = e instanceof z.ZodError;
      const status = validation ? 400 : (e.status ?? 500);
      if (status === 500) console.error("Request failed:", e.message);
      res.status(status).json({
        error: validation
          ? "invalidInput"
          : status === 500
            ? "serverError"
            : e.message,
      });
    },
  );
  const expire = async () => {
    const op = lock.then(async () => {
      const due = store.state.tickets.filter(
        (t) =>
          t.status === "called" &&
          t.deadline &&
          Date.parse(t.deadline) < Date.now() &&
          !t.expiredReported,
      );
      if (!due.length) return;
      const backup = structuredClone(store.state);
      try {
        for (const t of due) {
          t.expiredReported = true;
          notice(t.journeyId, "timeExpired", t.roomId);
        }
        await store.save();
        emit();
      } catch (e) {
        store.state = backup;
        throw e;
      }
    });
    lock = op.catch(() => {});
    await op;
  };
  return { app, http, io, expire };
}

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { MotionTrackingService } from "../src/services/MotionTrackingService";
import { StepDetectionService } from "../src/services/StepDetectionService";
import { NavigationTrackingService } from "../src/services/NavigationTrackingService";
import { createHospital } from "../shared/hospital";
import { findRoute } from "../shared/navigation";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function host(motion?: unknown, orientation?: unknown, secure = true) {
  const w = new EventTarget() as unknown as Window;
  Object.assign(w, { document: new EventTarget(), isSecureContext: secure });
  if (motion) Object.assign(w, { DeviceMotionEvent: motion });
  if (orientation) Object.assign(w, { DeviceOrientationEvent: orientation });
  return w;
}
it("does not activate listeners before explicit start and handles unsupported/insecure devices", async () => {
  const w = host(),
    add = vi.spyOn(w, "addEventListener");
  const s = new MotionTrackingService(vi.fn(), vi.fn(), w);
  expect(add).not.toHaveBeenCalled();
  await s.start();
  expect(s.status).toBe("unsupported");
  const insecure = new MotionTrackingService(
    vi.fn(),
    vi.fn(),
    host({}, {}, false),
  );
  await insecure.start();
  expect(insecure.status).toBe("insecure");
});
it("requests both iOS permissions during the action and preserves motion when orientation is denied", async () => {
  const m = vi.fn(async () => "granted"),
    o = vi.fn(async () => "denied");
  const w = host({ requestPermission: m }, { requestPermission: o });
  const add = vi.spyOn(w, "addEventListener"),
    sample = vi.fn();
  const s = new MotionTrackingService(sample, vi.fn(), w);
  const pending = s.start();
  expect(m).toHaveBeenCalledOnce();
  expect(o).toHaveBeenCalledOnce();
  await pending;
  expect(s.orientationAvailable).toBe(false);
  expect(add.mock.calls.map((c) => c[0])).toEqual(["devicemotion"]);
  const e = new Event("devicemotion");
  Object.assign(e, { acceleration: { x: 0, y: 0, z: 2 } });
  w.dispatchEvent(e);
  expect(sample).toHaveBeenCalledOnce();
  expect(s.status).toBe("tracking");
  s.stop();
  w.dispatchEvent(e);
  expect(sample).toHaveBeenCalledOnce();
});
it("reports denied permission and cancels permission completion after cleanup", async () => {
  const denied = new MotionTrackingService(
    vi.fn(),
    vi.fn(),
    host({
      requestPermission: async () => {
        throw Error("NotAllowedError");
      },
    }),
  );
  await denied.start();
  expect(denied.status).toBe("denied");
  let resolve!: (value: string) => void;
  const w = host({
    requestPermission: () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  });
  const add = vi.spyOn(w, "addEventListener"),
    s = new MotionTrackingService(vi.fn(), vi.fn(), w);
  const pending = s.start();
  s.stop();
  resolve("granted");
  await pending;
  expect(add).not.toHaveBeenCalled();
  expect(s.status).toBe("paused");
});
it("smooths compass wraparound, requires calibration, and pauses on missing readings", async () => {
  vi.useFakeTimers();
  const w = host({}, {}),
    s = new MotionTrackingService(vi.fn(), vi.fn(), w);
  await s.start();
  for (const heading of [359, 1]) {
    const e = new Event("deviceorientation");
    Object.assign(e, {
      webkitCompassHeading: heading,
      webkitCompassAccuracy: 5,
    });
    w.dispatchEvent(e);
  }
  expect(s.headingReliable).toBe(false);
  expect(s.calibrate(0)).toBe(true);
  expect(s.routeHeading).toBeCloseTo(0);
  const e = new Event("devicemotion");
  Object.assign(e, { accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } });
  w.dispatchEvent(e);
  vi.advanceTimersByTime(4000);
  expect(s.status).toBe("stale");
  s.stop();
});
function walk(d: StepDetectionService, gravity: boolean, cycles = 12) {
  for (let t = 0; t < cycles * 600; t += 20) {
    const wave = Math.sin((t / 600) * Math.PI * 2) * 2.8;
    d.ingest({
      time: t,
      x: 0,
      y: 0,
      z: gravity ? 9.81 + wave : Math.max(0, wave),
      gravity,
      rotation: 0,
    });
  }
}
it("detects synthetic walking with and without gravity and computes/calibrates distance", () => {
  for (const gravity of [true, false]) {
    const d = new StepDetectionService();
    walk(d, gravity);
    expect(d.steps).toBeGreaterThanOrEqual(11);
    expect(d.steps).toBeLessThanOrEqual(13);
    expect(d.estimatedDistance).toBeCloseTo(d.steps * 0.7);
    d.calibrate(d.steps * 0.8);
    expect(d.stepLength).toBeCloseTo(0.8);
    expect(() => d.configure(8)).toThrow();
    d.reset();
    expect(d.steps).toBe(0);
  }
});
it("rejects stationary noise, violent rotation and acceleration spikes", () => {
  const d = new StepDetectionService();
  for (let t = 0; t < 10000; t += 20)
    d.ingest({
      time: t,
      x: 0.05 * Math.sin(t),
      y: 0.04,
      z: 9.81 + 0.1 * Math.cos(t),
      gravity: true,
      rotation: 0,
    });
  expect(d.steps).toBe(0);
  for (let t = 10000; t < 20000; t += 20)
    d.ingest({
      time: t,
      x: 0,
      y: 0,
      z: t % 1000 < 200 ? 50 : 12,
      gravity: true,
      rotation: 100,
    });
  expect(d.steps).toBe(0);
});
const map = createHospital();
it("preserves graph distances for every route while adding junction stops", () => {
  for (const a of map.nodes)
    for (const b of map.nodes) {
      const route = findRoute(map, a.id, b.id, false);
      if (!route) continue;
      const s = new NavigationTrackingService(a, map, route.nodes);
      expect(s.steps.reduce((n, step) => n + step.distance, 0)).toBeCloseTo(
        route.distance,
      );
    }
});
it("changes the instruction at a turn but cannot cross it from extra steps", () => {
  const route = findRoute(map, "door-reception", "door-triage", false)!;
  const s = new NavigationTrackingService(route.nodes[0], map, route.nodes);
  s.advance(s.step.distance - 1);
  expect(s.approaching?.type).toContain("TURN");
  s.advance(1);
  expect(s.step.type).toContain("TURN");
  const index = s.index;
  s.advance(10);
  expect(s.index).toBe(index);
  s.confirm();
  expect(s.step.type).toBe("FORWARD");
});
function tracker(start = "f0-c4", destination = "door-triage") {
  const route = findRoute(map, start, destination, false)!;
  return new NavigationTrackingService(route.nodes[0], map, route.nodes);
}
it("reduces distance, approaches turns, and waits at every uncertain boundary", () => {
  const s = tracker(),
    anchor = { ...s.confirmedLocation },
    initial = s.remainingDistance;
  s.advance(s.step.distance - 1);
  expect(s.remainingDistance).toBeLessThan(initial);
  expect(s.approaching).toBeDefined();
  s.advance(1);
  const index = s.index;
  s.advance(100);
  expect(s.index).toBe(index);
  expect(s.confirmedLocation).toEqual(anchor);
  s.confirm();
  expect(s.index).toBe(index + 1);
});
it("never walks through floor changes and QR/off-route correction starts a fresh estimate", () => {
  const s = tracker("door-reception", "door-doctor");
  while (
    s.step.type === "FORWARD" ||
    s.step.type.includes("LEFT") ||
    s.step.type.includes("RIGHT")
  )
    s.confirm();
  expect(["ELEVATOR", "STAIRS"]).toContain(s.step.type);
  const floor = s.estimatedLocation.floor;
  s.advance(100);
  expect(s.estimatedLocation.floor).toBe(floor);
  s.confirm();
  expect(s.step.type).toBe("FLOOR_CHANGE");
  const corrected = tracker("door-lab", "door-triage");
  expect(corrected.confirmedLocation.id).toBe("door-lab");
  expect(corrected.estimatedProgress).toBe(0);
  expect(corrected.positionConfidence).toBe("anchor");
});
it("reaches only estimated arrival and confidence loss requires a new anchor", () => {
  const s = tracker();
  while (s.step.type !== "ARRIVAL") s.confirm();
  expect(s.confirmedLocation.id).toBe("f0-c4");
  expect(s.remainingDistance).toBe(0);
  const long = tracker();
  long.advance(40);
  expect(long.positionConfidence).toBe("low");
  const index = long.index;
  long.confirm();
  expect(long.index).toBe(index);
});

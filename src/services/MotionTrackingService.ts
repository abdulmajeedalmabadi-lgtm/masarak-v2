import type { MotionSample } from "./StepDetectionService";
export type SensorStatus =
  | "idle"
  | "requesting"
  | "tracking"
  | "denied"
  | "unsupported"
  | "insecure"
  | "stale"
  | "paused";
type PermissionConstructor = { requestPermission?: () => Promise<string> };
type CompassEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
};
function permission(ctor?: PermissionConstructor) {
  try {
    return (
      ctor?.requestPermission?.() ??
      Promise.resolve(ctor ? "granted" : "denied")
    );
  } catch (error) {
    return Promise.reject(error);
  }
}
export class MotionTrackingService {
  status: SensorStatus = "idle";
  heading: number | null = null;
  headingReliable = false;
  orientationAvailable = false;
  private offset = 0;
  private calibrated = false;
  private headingQuality = false;
  private lastHeading = 0;
  private lastHeadingReport = 0;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private lastEvent = 0;
  constructor(
    private sample: (s: MotionSample) => void,
    private change: () => void,
    private host: Window = window,
  ) {}
  private set(status: SensorStatus) {
    this.status = status;
    this.change();
  }
  private motion = (e: DeviceMotionEvent) => {
    const a =
      e.acceleration?.x != null
        ? e.acceleration
        : e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    this.lastEvent = Date.now();
    if (this.status !== "tracking") this.set("tracking");
    this.sample({
      time: e.timeStamp,
      x: a.x,
      y: a.y,
      z: a.z,
      gravity: a === e.accelerationIncludingGravity,
      rotation: Math.max(
        ...[
          e.rotationRate?.alpha,
          e.rotationRate?.beta,
          e.rotationRate?.gamma,
        ].map((n) => Math.abs(n ?? 0)),
      ),
    });
  };
  private orientation = (event: DeviceOrientationEvent) => {
    const e = event as CompassEvent;
    const raw =
      e.webkitCompassHeading ??
      (e.absolute && e.alpha != null ? 360 - e.alpha : e.alpha);
    if (raw == null || !Number.isFinite(raw)) {
      this.headingReliable = false;
      return;
    }
    const radians = (raw * Math.PI) / 180;
    this.heading =
      this.heading == null
        ? radians
        : this.heading +
          0.15 *
            Math.atan2(
              Math.sin(radians - this.heading),
              Math.cos(radians - this.heading),
            );
    this.lastHeading = Date.now();
    this.headingQuality =
      e.webkitCompassAccuracy == null ||
      (e.webkitCompassAccuracy >= 0 && e.webkitCompassAccuracy <= 20);
    this.headingReliable = this.calibrated && this.headingQuality;
    if (Date.now() - this.lastHeadingReport >= 1000) {
      this.lastHeadingReport = Date.now();
      this.change();
    }
  };
  get routeHeading() {
    return this.heading == null ? null : this.heading + this.offset;
  }
  calibrate(routeHeading: number) {
    if (this.heading == null) return false;
    this.offset = routeHeading - this.heading;
    this.calibrated = true;
    this.headingReliable = this.headingQuality;
    this.change();
    return true;
  }
  private visibility = () => {
    if (this.host.document.hidden) this.stop();
  };
  /** Invoke directly from a click: both iOS prompts are requested before awaiting. */
  async start() {
    this.stop(false);
    const generation = this.generation;
    if (!this.host.isSecureContext) {
      this.set("insecure");
      return;
    }
    if (!("DeviceMotionEvent" in this.host)) {
      this.set("unsupported");
      return;
    }
    this.set("requesting");
    const motion = (
      this.host as unknown as { DeviceMotionEvent: PermissionConstructor }
    ).DeviceMotionEvent;
    const orientation = (
      this.host as unknown as { DeviceOrientationEvent?: PermissionConstructor }
    ).DeviceOrientationEvent;
    try {
      const mp = permission(motion);
      const op = permission(orientation);
      const [m, o] = await Promise.allSettled([mp, op]);
      if (generation !== this.generation) return;
      if (m.status !== "fulfilled" || m.value !== "granted") {
        this.set("denied");
        return;
      }
      this.orientationAvailable =
        o.status === "fulfilled" && o.value === "granted";
      this.host.addEventListener("devicemotion", this.motion);
      if (this.orientationAvailable)
        this.host.addEventListener("deviceorientation", this.orientation);
      this.host.document.addEventListener("visibilitychange", this.visibility);
      this.lastEvent = Date.now();
      this.set("stale");
      this.timer = setInterval(() => {
        if (Date.now() - this.lastHeading > 3000) this.headingReliable = false;
        if (Date.now() - this.lastEvent > 3000 && this.status === "tracking") {
          this.headingReliable = false;
          this.set("stale");
        } else if (this.status === "tracking") this.change();
      }, 1000);
    } catch {
      if (generation === this.generation) this.set("denied");
    }
  }
  stop(report = true) {
    this.generation++;
    this.host.removeEventListener("devicemotion", this.motion);
    this.host.removeEventListener("deviceorientation", this.orientation);
    this.host.document.removeEventListener("visibilitychange", this.visibility);
    clearInterval(this.timer);
    this.timer = undefined;
    this.heading = null;
    this.headingReliable = this.calibrated = false;
    if (report) this.set("paused");
  }
}

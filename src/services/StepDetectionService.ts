export type MotionSample = {
  time: number;
  x: number;
  y: number;
  z: number;
  gravity: boolean;
  rotation: number;
};
/** Experimental walking-like peak detector, not a positioning sensor. */
export class StepDetectionService {
  steps = 0;
  stepLength = 0.7;
  private baseline = 9.81;
  private filtered = 0;
  private armed = true;
  private lastStep = -Infinity;
  private lastTime = -Infinity;
  get estimatedDistance() {
    return this.steps * this.stepLength;
  }
  configure(length: number) {
    if (!Number.isFinite(length) || length < 0.3 || length > 1.2)
      throw Error("invalidInput");
    this.stepLength = length;
  }
  calibrate(distance: number) {
    if (!this.steps || !Number.isFinite(distance)) throw Error("invalidInput");
    this.configure(distance / this.steps);
  }
  reset() {
    this.steps = 0;
    this.baseline = 9.81;
    this.filtered = 0;
    this.armed = true;
    this.lastStep = this.lastTime = -Infinity;
  }
  ingest(s: MotionSample): boolean {
    const magnitude = Math.hypot(s.x, s.y, s.z);
    if (
      !Number.isFinite(magnitude) ||
      !Number.isFinite(s.time) ||
      s.time <= this.lastTime
    )
      return false;
    if (s.time - this.lastTime > 1000) {
      this.filtered = 0;
      this.armed = true;
    }
    this.lastTime = s.time;
    if (s.rotation > 70 || magnitude > (s.gravity ? 25 : 15)) {
      this.filtered = 0;
      this.armed = false;
      return false;
    }
    if (s.gravity) this.baseline += 0.025 * (magnitude - this.baseline);
    const signal = s.gravity ? magnitude - this.baseline : magnitude;
    this.filtered += 0.35 * (signal - this.filtered);
    if (this.filtered < (s.gravity ? 0.15 : 0.45)) this.armed = true;
    if (this.armed && this.filtered > 1.1 && s.time - this.lastStep >= 350) {
      this.armed = false;
      this.lastStep = s.time;
      this.steps++;
      return true;
    }
    return false;
  }
}

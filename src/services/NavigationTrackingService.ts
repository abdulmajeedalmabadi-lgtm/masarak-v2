import { guidance, type Guidance } from "../../shared/guidance";
import type { HospitalMap, Node } from "../../shared/types";
/** State stays on the client. QR/manual anchors are the only backend locations. */
export class NavigationTrackingService {
  readonly steps: Guidance[];
  index = 0;
  estimatedProgress = 0;
  distanceSinceAnchor = 0;
  positionConfidence: "anchor" | "estimated" | "low" = "anchor";
  constructor(
    readonly confirmedLocation: Node,
    map: HospitalMap,
    path: Node[],
  ) {
    // Split merged guidance at graph junctions, including straight intersections.
    const chunks: Node[][] = [];
    let chunk: Node[] = [];
    path.forEach((node, i) => {
      chunk.push(node);
      if (
        i > 0 &&
        i < path.length - 1 &&
        (node.kind === "intersection" ||
          map.edges.filter((e) => e.from === node.id || e.to === node.id)
            .length > 2)
      ) {
        chunks.push(chunk);
        chunk = [node];
      }
    });
    chunks.push(chunk);
    this.steps = chunks.flatMap((nodes, i) => {
      const part = guidance(map, nodes);
      if (i < chunks.length - 1) part.pop();
      // Preserve the turn at the chunk boundary from the full preceding edge.
      if (i > 0) {
        const previous = chunks[i - 1];
        const bridge = guidance(map, [
          previous[previous.length - 2],
          ...nodes.slice(0, 2),
        ]);
        const turn = bridge.find(
          (s) => s.type.includes("LEFT") || s.type.includes("RIGHT"),
        );
        if (turn) part.unshift(turn);
      }
      return part;
    });
  }
  get step() {
    return this.steps[this.index];
  }
  get blocked() {
    const s = this.step;
    return (
      this.positionConfidence === "low" ||
      !s ||
      s.type !== "FORWARD" ||
      this.estimatedProgress >= 1
    );
  }
  get estimatedLocation() {
    const s = this.step;
    if (!s) return this.confirmedLocation;
    return {
      ...s.from,
      x: s.from.x + (s.to.x - s.from.x) * this.estimatedProgress,
      y: s.from.y + (s.to.y - s.from.y) * this.estimatedProgress,
    };
  }
  get remainingDistance() {
    return Math.max(
      0,
      this.steps.slice(this.index).reduce((n, s) => n + s.distance, 0) -
        (this.step?.distance ?? 0) * this.estimatedProgress,
    );
  }
  get approaching() {
    return this.step?.type === "FORWARD" &&
      this.step.distance * (1 - this.estimatedProgress) <= 2
      ? this.steps[this.index + 1]
      : undefined;
  }
  advance(distance: number) {
    if (!Number.isFinite(distance) || distance <= 0 || this.blocked) return;
    this.positionConfidence = "estimated";
    this.distanceSinceAnchor += distance;
    this.estimatedProgress = Math.min(
      1,
      this.estimatedProgress + distance / this.step.distance,
    );
    if (
      this.estimatedProgress >= 1 &&
      this.steps[this.index + 1] &&
      this.steps[this.index + 1].type !== "FORWARD"
    ) {
      this.index++;
      this.estimatedProgress = 0;
    }
    if (this.distanceSinceAnchor >= 40) this.positionConfidence = "low";
  }
  /** Explicit patient confirmation, never a clock or phone heading guess. */
  confirm() {
    if (this.positionConfidence === "low" || this.step?.type === "ARRIVAL")
      return;
    this.index = Math.min(this.index + 1, this.steps.length - 1);
    this.estimatedProgress = 0;
    this.positionConfidence = "estimated";
  }
}

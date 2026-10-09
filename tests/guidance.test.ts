import { describe, it, expect } from "vitest";
import { createHospital } from "../shared/hospital";
import { findRoute } from "../shared/navigation";
import { guidance } from "../shared/guidance";
const map = createHospital();
describe("Graph-derived 3D guidance", () => {
  it("preserves exact graph costs and merges straight edges for all node pairs", () => {
    for (const a of map.nodes)
      for (const b of map.nodes) {
        const r = findRoute(map, a.id, b.id, false)!;
        const steps = guidance(map, r.nodes);
        expect(steps.reduce((sum, s) => sum + s.distance, 0)).toBe(r.distance);
        expect(steps.at(-1)?.type).toBe("ARRIVAL");
        expect(steps.at(-1)?.to.id).toBe(b.id);
        for (let i = 1; i < steps.length; i++)
          expect(
            steps[i].type === "FORWARD" && steps[i - 1].type === "FORWARD",
          ).toBe(false);
      }
  });
  it("derives right and left turns from actual outgoing edges", () => {
    const east = findRoute(map, "f0-c0", "door-triage", false)!;
    expect(
      guidance(map, east.nodes).some(
        (s) => s.type === "TURN_LEFT" && s.angle < 0,
      ),
    ).toBe(true);
    const west = findRoute(map, "f0-c4", "door-triage", false)!;
    expect(
      guidance(map, west.nodes).some(
        (s) => s.type === "TURN_RIGHT" && s.angle > 0,
      ),
    ).toBe(true);
  });
  it("retains accessible elevators and emits a floor change", () => {
    const r = findRoute(map, "door-reception", "door-doctor", true)!;
    const s = guidance(map, r.nodes);
    expect(s.some((s) => s.type === "ELEVATOR")).toBe(true);
    expect(s.some((s) => s.type === "FLOOR_CHANGE" && s.floor === 1)).toBe(
      true,
    );
    expect(s.some((s) => s.type === "STAIRS")).toBe(false);
  });
  it("handles a stairs-only route and a zero-distance destination", () => {
    const a = map.nodes.find((n) => n.id === "f0-c6")!,
      b = map.nodes.find((n) => n.id === "f1-c6")!;
    expect(guidance(map, [a, b]).map((s) => s.type)).toEqual([
      "STAIRS",
      "FLOOR_CHANGE",
      "ARRIVAL",
    ]);
    expect(guidance(map, [a])).toHaveLength(1);
  });
});

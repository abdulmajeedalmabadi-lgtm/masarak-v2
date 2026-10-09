import { describe, it, expect } from "vitest";
import { createHospital } from "../shared/hospital";
import { findRoute, validateMap, routeSteps } from "../shared/navigation";
const map = createHospital();
describe("Hospital A* navigation", () => {
  it("validates both floor plans and every accessible room", () =>
    expect(validateMap(map)).toEqual([]));
  it("follows corridor edges instead of crossing walls", () => {
    for (const a of map.rooms)
      for (const b of map.rooms) {
        const r = findRoute(map, a.nodeId, b.nodeId, false)!;
        expect(r).not.toBeNull();
        for (let i = 0; i < r.nodes.length - 1; i++) {
          const x = r.nodes[i],
            y = r.nodes[i + 1];
          expect(
            map.edges.some(
              (e) =>
                (e.from === x.id && e.to === y.id) ||
                (e.to === x.id && e.from === y.id),
            ),
          ).toBe(true);
        }
      }
  });
  it("returns the shortest same-floor route", () => {
    const r = findRoute(map, "door-reception", "door-triage", false)!;
    expect(r.distance).toBe(20);
    expect(r.nodes.map((n) => n.id)).toEqual([
      "door-reception",
      "f0-c0",
      "f0-c1",
      "door-triage",
    ]);
  });
  it("uses elevators across floors when accessible", () => {
    const r = findRoute(map, "door-reception", "door-doctor", true)!;
    expect(r.nodes.some((n) => n.kind === "elevator")).toBe(true);
    expect(r.nodes.some((n) => n.kind === "stairs")).toBe(false);
    expect(routeSteps(map, r.nodes).some((s) => s.key === "takeLift")).toBe(
      true,
    );
  });
  it("uses the shorter stairs route when permitted", () => {
    const r = findRoute(map, "f0-c6", "f1-c6", false)!;
    expect(r.distance).toBe(9);
    expect(findRoute(map, "f0-c6", "f1-c6", true)!.distance).toBe(34);
  });
  it("recalculates from a wrong-turn checkpoint", () => {
    expect(
      findRoute(map, "door-reception", "door-triage", true)!.distance,
    ).toBe(20);
    expect(findRoute(map, "door-lab", "door-triage", true)!.distance).toBe(30);
  });
  it("rejects wall-crossing and disconnected graph edits", () => {
    const bad = structuredClone(map);
    bad.edges.push({
      id: "bad",
      from: "door-triage",
      to: "door-lab",
      distance: 1,
      kind: "corridor",
      accessible: true,
    });
    expect(validateMap(bad)).toContain("invalidCorridor");
    bad.nodes.push({
      id: "inside",
      x: 180,
      y: 160,
      floor: 0,
      kind: "corridor",
      accessible: true,
    });
    bad.edges.push({
      id: "wall",
      from: "f0-c1",
      to: "inside",
      distance: 1,
      kind: "corridor",
      accessible: true,
    });
    expect(validateMap(bad)).toContain("wallCrossing");
    bad.edges = [];
    expect(validateMap(bad)).toContain("disconnected");
  });
  it("handles invalid, same, and unreachable nodes", () => {
    expect(findRoute(map, "unknown", "door-lab", false)).toBeNull();
    expect(findRoute(map, "door-lab", "door-lab", false)?.distance).toBe(0);
    expect(
      findRoute({ ...map, edges: [] }, "door-lab", "door-triage", true),
    ).toBeNull();
  });
  it("matches Dijkstra distances for all node pairs", () => {
    for (const accessible of [false, true])
      for (const a of map.nodes)
        for (const b of map.nodes) {
          const costs = new Map([[a.id, 0]]),
            todo = new Set(map.nodes.map((n) => n.id));
          while (todo.size) {
            const cur = [...todo].sort(
              (x, y) => (costs.get(x) ?? Infinity) - (costs.get(y) ?? Infinity),
            )[0];
            todo.delete(cur);
            for (const e of map.edges.filter(
              (e) => e.from === cur || e.to === cur,
            )) {
              const next = e.from === cur ? e.to : e.from;
              if (
                accessible &&
                (!e.accessible ||
                  e.kind === "stairs" ||
                  !map.nodes.find((n) => n.id === next)!.accessible)
              )
                continue;
              const d = (costs.get(cur) ?? Infinity) + e.distance;
              if (d < (costs.get(next) ?? Infinity)) costs.set(next, d);
            }
          }
          expect(
            findRoute(map, a.id, b.id, accessible)?.distance ?? Infinity,
          ).toBe(costs.get(b.id) ?? Infinity);
        }
  });
});

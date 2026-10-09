import type { HospitalMap, Node, Corridor } from "./types";
function coveredSegment(a: Node, b: Node, rectangles: Corridor[]) {
  const horizontal = a.y === b.y,
    low = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
    high = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
  const intervals = rectangles
    .filter((r) =>
      horizontal
        ? a.y >= r.y && a.y <= r.y + r.height
        : a.x >= r.x && a.x <= r.x + r.width,
    )
    .map((r) => (horizontal ? [r.x, r.x + r.width] : [r.y, r.y + r.height]))
    .sort((x, y) => x[0] - y[0]);
  let end = low;
  for (const [start, finish] of intervals) {
    if (finish < end) continue;
    if (start > end + 0.00001) break;
    end = Math.max(end, finish);
    if (end >= high) return true;
  }
  return false;
}
export function validateMap(map: HospitalMap) {
  const errors: string[] = [],
    ids = new Set(map.nodes.map((n) => n.id));
  if (ids.size !== map.nodes.length) errors.push("duplicateNodes");
  if (new Set(map.edges.map((e) => e.id)).size !== map.edges.length)
    errors.push("duplicateEdges");
  if (new Set(map.floors.map((f) => f.id)).size !== map.floors.length)
    errors.push("duplicateFloors");
  if (new Set(map.rooms.map((r) => r.id)).size !== map.rooms.length)
    errors.push("duplicateRooms");
  const inside = (n: Node, r: HospitalMap["rooms"][number]) =>
    n.floor === r.floor &&
    n.x > r.x &&
    n.x < r.x + r.width &&
    n.y > r.y &&
    n.y < r.y + r.height;
  for (const f of map.floors) {
    if (!f.corridors?.length) errors.push("missingCorridors");
    for (const c of f.corridors ?? []) {
      if (
        ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
        c.width <= 0 ||
        c.height <= 0
      )
        errors.push("invalidCorridor");
      if (
        map.rooms.some(
          (r) =>
            r.floor === f.id &&
            c.x < r.x + r.width &&
            c.x + c.width > r.x &&
            c.y < r.y + r.height &&
            c.y + c.height > r.y,
        )
      )
        errors.push("corridorCrossesRoom");
    }
  }
  for (const n of map.nodes)
    if (
      !Number.isFinite(n.x) ||
      !Number.isFinite(n.y) ||
      !map.floors.some((f) => f.id === n.floor)
    )
      errors.push("invalidNode");
  for (const e of map.edges) {
    const a = map.nodes.find((n) => n.id === e.from),
      b = map.nodes.find((n) => n.id === e.to);
    if (!a || !b || e.distance <= 0 || !Number.isFinite(e.distance)) {
      errors.push("invalidEdge");
      continue;
    }
    if (a.floor !== b.floor) {
      if (
        e.kind === "corridor" ||
        a.kind !== e.kind ||
        b.kind !== e.kind ||
        a.x !== b.x ||
        a.y !== b.y
      )
        errors.push("invalidFloorConnection");
      if (e.kind === "stairs" && e.accessible) errors.push("accessibleStairs");
      continue;
    }
    if (a.x !== b.x && a.y !== b.y) errors.push("diagonalCorridor");
    const corridors = [
      ...(map.floors.find((f) => f.id === a.floor)?.corridors ?? []),
    ];
    // Entrance spurs are drawn as public passages, while door-to-door shortcuts are rejected.
    if (a.x === b.x && (a.kind === "door") !== (b.kind === "door"))
      corridors.push({
        id: e.id,
        x: a.x - 15,
        y: Math.min(a.y, b.y),
        width: 30,
        height: Math.abs(a.y - b.y),
      });
    if (!coveredSegment(a, b, corridors)) errors.push("invalidCorridor");
    if (
      map.rooms.some(
        (r) =>
          r.floor === a.floor &&
          (a.y === b.y
            ? a.y > r.y &&
              a.y < r.y + r.height &&
              Math.max(a.x, b.x) > r.x &&
              Math.min(a.x, b.x) < r.x + r.width
            : a.x > r.x &&
              a.x < r.x + r.width &&
              Math.max(a.y, b.y) > r.y &&
              Math.min(a.y, b.y) < r.y + r.height),
      )
    )
      errors.push("wallCrossing");
    for (let i = 1; i < 100; i++) {
      const n = {
        ...a,
        x: a.x + ((b.x - a.x) * i) / 100,
        y: a.y + ((b.y - a.y) * i) / 100,
      };
      if (map.rooms.some((r) => inside(n, r))) {
        errors.push("wallCrossing");
        break;
      }
    }
  }
  for (const r of map.rooms) {
    const door = map.nodes.find((n) => n.id === r.nodeId);
    if (
      !door ||
      door.kind !== "door" ||
      door.floor !== r.floor ||
      door.x !== r.x + r.width / 2 ||
      ![r.y, r.y + r.height].includes(door.y) ||
      (r.accessible && !door.accessible)
    )
      errors.push("invalidEntrance");
    if (["ar", "en", "ur", "fr", "tr", "id"].some((lang) => !r.names[lang]))
      errors.push("missingRoomTranslation");
  }
  for (const q of map.checkpoints) {
    const n = map.nodes.find((n) => n.id === q.nodeId);
    if (
      !n ||
      q.hospitalId !== map.id ||
      q.floorId !== `floor-${n.floor}` ||
      q.floor !== n.floor ||
      q.x !== n.x ||
      q.y !== n.y ||
      !q.locationName ||
      ["ar", "en", "ur", "fr", "tr", "id"].some((lang) => !q.names?.[lang])
    )
      errors.push("invalidCheckpoint");
  }
  if (new Set(map.checkpoints.map((q) => q.id)).size !== map.checkpoints.length)
    errors.push("duplicateCheckpoints");
  if (map.nodes.length) {
    for (const n of map.nodes)
      if (!findRoute(map, map.nodes[0].id, n.id, false))
        errors.push("disconnected");
    for (const r of map.rooms.filter((r) => r.accessible))
      if (!findRoute(map, map.nodes[0].id, r.nodeId, true))
        errors.push("inaccessibleRoom");
  }
  return [...new Set(errors)];
}
export function findRoute(
  map: HospitalMap,
  start: string,
  end: string,
  accessible: boolean,
) {
  const lookup = new Map(map.nodes.map((n) => [n.id, n]));
  if (!lookup.has(start) || !lookup.has(end)) return null;
  // An admissible Manhattan heuristic scaled by the smallest cost per map unit.
  // Floor transitions have a non-negative cost; omitting floor cost preserves admissibility.
  const ratio = Math.min(
    ...map.edges
      .filter((e) => lookup.get(e.from)?.floor === lookup.get(e.to)?.floor)
      .map((e) => {
        const a = lookup.get(e.from)!,
          b = lookup.get(e.to)!;
        return e.distance / (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) || 1);
      }),
    0.1,
  );
  const h = (id: string) => {
    const n = lookup.get(id)!,
      goal = lookup.get(end)!;
    return ratio * (Math.abs(n.x - goal.x) + Math.abs(n.y - goal.y));
  };
  const open = new Set([start]),
    g = new Map([[start, 0]]),
    prev = new Map<string, string>();
  while (open.size) {
    const cur = [...open].sort(
      (a, b) => g.get(a)! + h(a) - (g.get(b)! + h(b)),
    )[0];
    if (cur === end) {
      const path = [cur];
      while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
      const distance = g.get(cur)!;
      return {
        nodes: path.map((id) => lookup.get(id)!),
        distance,
        seconds: Math.ceil(distance / (accessible ? 0.7 : 1.1)),
      };
    }
    open.delete(cur);
    for (const e of map.edges.filter((e) => e.from === cur || e.to === cur)) {
      const next = e.from === cur ? e.to : e.from;
      if (
        accessible &&
        (!e.accessible || e.kind === "stairs" || !lookup.get(next)?.accessible)
      )
        continue;
      const score = g.get(cur)! + e.distance;
      if (score < (g.get(next) ?? Infinity)) {
        g.set(next, score);
        prev.set(next, cur);
        open.add(next);
      }
    }
  }
  return null;
}
export function routeSteps(map: HospitalMap, path: Node[]) {
  return path.slice(0, -1).map((a, i) => {
    const b = path[i + 1],
      e = map.edges.find(
        (e) =>
          (e.from === a.id && e.to === b.id) ||
          (e.to === a.id && e.from === b.id),
      )!;
    const previous = path[i - 1];
    let key = "straight";
    if (a.floor !== b.floor)
      key = e.kind === "elevator" ? "takeLift" : "takeStairs";
    else if (previous && previous.floor === a.floor) {
      const cross =
        (a.x - previous.x) * (b.y - a.y) - (a.y - previous.y) * (b.x - a.x);
      if (cross > 0) key = "turnRight";
      else if (cross < 0) key = "turnLeft";
    }
    return { key, distance: e.distance, floor: b.floor, nodeId: b.id };
  });
}

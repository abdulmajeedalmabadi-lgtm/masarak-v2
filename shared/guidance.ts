import type { HospitalMap, Node } from "./types";
export type GuidanceType =
  | "FORWARD"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "SLIGHT_LEFT"
  | "SLIGHT_RIGHT"
  | "ELEVATOR"
  | "STAIRS"
  | "FLOOR_CHANGE"
  | "ARRIVAL";
export type Guidance = {
  type: GuidanceType;
  distance: number;
  floor: number;
  from: Node;
  to: Node;
  heading: number;
  angle: number;
  key: string;
};
export function guidance(map: HospitalMap, path: Node[]): Guidance[] {
  const result: Guidance[] = [];
  let heading: number | undefined;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i],
      b = path[i + 1],
      edge = map.edges.find(
        (e) =>
          (e.from === a.id && e.to === b.id) ||
          (e.to === a.id && e.from === b.id),
      );
    if (!edge) throw Error("noRoute");
    const next = Math.atan2(b.y - a.y, b.x - a.x);
    if (a.floor !== b.floor) {
      result.push({
        type: edge.kind === "stairs" ? "STAIRS" : "ELEVATOR",
        distance: edge.distance,
        floor: b.floor,
        from: a,
        to: b,
        heading: heading ?? 0,
        angle: 0,
        key: edge.kind === "stairs" ? "takeStairs" : "takeLift",
      });
      result.push({
        type: "FLOOR_CHANGE",
        distance: 0,
        floor: b.floor,
        from: b,
        to: b,
        heading: heading ?? 0,
        angle: 0,
        key: "navFloor",
      });
      heading = undefined;
      continue;
    }
    let angle =
      heading === undefined
        ? 0
        : Math.atan2(Math.sin(next - heading), Math.cos(next - heading));
    if (Math.abs(angle) > 0.15) {
      const slight = Math.abs(angle) < Math.PI / 3,
        right = angle > 0;
      result.push({
        type: slight
          ? right
            ? "SLIGHT_RIGHT"
            : "SLIGHT_LEFT"
          : right
            ? "TURN_RIGHT"
            : "TURN_LEFT",
        distance: 0,
        floor: a.floor,
        from: a,
        to: a,
        heading: heading!,
        angle,
        key: slight
          ? right
            ? "navSlightRight"
            : "navSlightLeft"
          : right
            ? "navTurnRight"
            : "navTurnLeft",
      });
    }
    const last = result.at(-1);
    if (
      last?.type === "FORWARD" &&
      last.floor === a.floor &&
      Math.abs(angle) < 0.15
    ) {
      last.to = b;
      last.distance += edge.distance;
    } else
      result.push({
        type: "FORWARD",
        distance: edge.distance,
        floor: b.floor,
        from: a,
        to: b,
        heading: next,
        angle: 0,
        key: "navForward",
      });
    heading = next;
  }
  const end = path.at(-1);
  const room = map.rooms.find((r) => r.nodeId === end?.id);
  const arrivalHeading =
    heading ??
    (end && room
      ? Math.atan2(
          room.y + room.height / 2 - end.y,
          room.x + room.width / 2 - end.x,
        )
      : 0);
  if (end)
    result.push({
      type: "ARRIVAL",
      distance: 0,
      floor: end.floor,
      from: end,
      to: end,
      heading: arrivalHeading,
      angle: 0,
      key: "navArrival",
    });
  return result;
}
export function instructionDuration(s: Guidance) {
  return s.type === "FORWARD"
    ? Math.max(2, s.distance / 2)
    : s.type === "ARRIVAL"
      ? 0
      : 2;
}

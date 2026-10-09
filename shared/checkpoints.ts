import type { Checkpoint, HospitalMap, Node } from "./types";
const labels: Record<string, string[]> = {
  corridor: ["الممر", "Corridor", "راہداری", "Couloir", "Koridor", "Koridor"],
  intersection: [
    "تقاطع الممرات",
    "Corridor intersection",
    "راہداری کا چوراہا",
    "Intersection des couloirs",
    "Koridor kavşağı",
    "Persimpangan koridor",
  ],
  elevator: ["المصعد", "Elevator", "لفٹ", "Ascenseur", "Asansör", "Lift"],
  stairs: ["الدرج", "Stairs", "سیڑھیاں", "Escalier", "Merdiven", "Tangga"],
};
const languages = ["ar", "en", "ur", "fr", "tr", "id"];
export function checkpointForNode(
  map: HospitalMap,
  node: Node,
  id: string,
  names?: Record<string, string>,
): Checkpoint {
  const room = map.rooms.find((r) => r.nodeId === node.id);
  const nearby = map.rooms.find(
    (r) =>
      r.floor === node.floor &&
      r.x + r.width / 2 === node.x &&
      r.type !== "exit",
  );
  const near = ["عند", "near", "قریب", "près de", "yakınında", "dekat"];
  const floorWords = ["الطابق", "floor", "منزل", "étage", "kat", "lantai"];
  const southern = [
    "الممر الجنوبي",
    "South corridor",
    "جنوبی راہداری",
    "Couloir sud",
    "Güney koridoru",
    "Koridor selatan",
  ];
  const generated = Object.fromEntries(
    languages.map((lang, i) => [
      lang,
      `${node.y === 410 ? `${southern[i]} ${Math.round((node.x - 180) / 100) + 1}` : (labels[node.kind] ?? labels.corridor)[i]}${nearby && node.kind !== "elevator" && node.kind !== "stairs" ? ` ${near[i]} ${nearby.names[lang]}` : ""} · ${floorWords[i]} ${node.floor}`,
    ]),
  );
  const localized = names ?? room?.names ?? generated;
  return {
    id,
    hospitalId: map.id,
    floorId: `floor-${node.floor}`,
    floor: node.floor,
    nodeId: node.id,
    x: node.x,
    y: node.y,
    locationName: localized.ar,
    names: localized,
  };
}
/** Upgrade only legacy shape; new checkpoint edits/deletions are never reseeded on restart. */
export function upgradeCheckpointMetadata(map: HospitalMap): HospitalMap {
  const legacy = map.checkpoints.some((q) => !q.hospitalId);
  for (const f of map.floors)
    f.corridors ??= [
      { id: `f${f.id}-main`, x: 50, y: 270, width: 660, height: 60 },
    ];
  map.checkpoints = map.checkpoints.map((q) => {
    const n = map.nodes.find((n) => n.id === q.nodeId);
    if (!n) throw Error("invalidCheckpoint");
    return checkpointForNode(map, n, q.id, q.names);
  });
  if (legacy)
    for (const n of map.nodes.filter((n) => n.kind === "stairs"))
      if (!map.checkpoints.some((q) => q.nodeId === n.id))
        map.checkpoints.push(checkpointForNode(map, n, `QR-${n.id}`));
  return map;
}
export function checkpointPayload(checkpoint: Checkpoint): string {
  return `MASARAK:v1:${encodeURIComponent(checkpoint.hospitalId)}:${encodeURIComponent(checkpoint.id)}`;
}
export function parseCheckpointPayload(
  value: string,
): { hospitalId?: string; checkpointId: string } | null {
  const raw = value.trim();
  if (raw.startsWith("MASARAK:v1:")) {
    const fields = raw.split(":");
    if (fields.length !== 4) return null;
    try {
      return {
        hospitalId: decodeURIComponent(fields[2]),
        checkpointId: decodeURIComponent(fields[3]),
      };
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol)) return null;
    const checkpointId = url.searchParams.get("checkpoint");
    return checkpointId
      ? {
          hospitalId: url.searchParams.get("hospital") ?? undefined,
          checkpointId,
        }
      : null;
  } catch {}
  return /^QR-[A-Za-z0-9_.-]{1,100}$/.test(raw) ? { checkpointId: raw } : null;
}

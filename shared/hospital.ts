import type { HospitalMap, Node, Edge, Room } from "./types";
import { checkpointForNode } from "./checkpoints";
const names = (
  ar: string,
  en: string,
  ur: string,
  fr: string,
  tr: string,
  id: string,
) => ({ ar, en, ur, fr, tr, id });
export function createHospital(): HospitalMap {
  const nodes: Node[] = [],
    edges: Edge[] = [],
    rooms: Room[] = [];
  for (const floor of [0, 1]) {
    // All public paths are on the central horizontal corridor, y=300.
    for (let i = 0; i < 7; i++)
      nodes.push({
        id: `f${floor}-c${i}`,
        x: 80 + i * 100,
        y: 300,
        floor,
        kind: i === 5 ? "elevator" : i === 6 ? "stairs" : "corridor",
        accessible: true,
      });
    for (let i = 0; i < 6; i++)
      edges.push({
        id: `f${floor}-e${i}`,
        from: `f${floor}-c${i}`,
        to: `f${floor}-c${i + 1}`,
        distance: 10,
        accessible: true,
        kind: "corridor",
      });
    // A second public corridor and three connecting passages provide actual intersections
    // and useful off-route checkpoints without passing through patient rooms.
    for (let i = 0; i < 6; i++)
      nodes.push({
        id: `f${floor}-south${i}`,
        x: 180 + i * 100,
        y: 410,
        floor,
        kind: i >= 3 ? "intersection" : "corridor",
        accessible: true,
      });
    for (let i = 0; i < 5; i++)
      edges.push({
        id: `f${floor}-south-edge${i}`,
        from: `f${floor}-south${i}`,
        to: `f${floor}-south${i + 1}`,
        distance: 10,
        accessible: true,
        kind: "corridor",
      });
    for (const i of [4, 5, 6])
      edges.push({
        id: `f${floor}-south-link${i}`,
        from: `f${floor}-c${i}`,
        to: `f${floor}-south${i - 1}`,
        distance: 11,
        accessible: true,
        kind: "corridor",
      });
  }
  edges.push(
    {
      id: "lift",
      from: "f0-c5",
      to: "f1-c5",
      distance: 14,
      accessible: true,
      kind: "elevator",
    },
    {
      id: "stairs",
      from: "f0-c6",
      to: "f1-c6",
      distance: 9,
      accessible: false,
      kind: "stairs",
    },
  );
  const defs = [
    [
      "reception",
      0,
      0,
      "001",
      "reception",
      names(
        "الاستقبال",
        "Reception",
        "استقبالیہ",
        "Accueil",
        "Resepsiyon",
        "Resepsionis",
      ),
    ],
    [
      "triage",
      0,
      1,
      "104",
      "clinic",
      names(
        "قسم الفرز",
        "Triage",
        "ابتدائی معائنہ",
        "Triage",
        "Triyaj",
        "Triase",
      ),
    ],
    [
      "emergency",
      0,
      2,
      "106",
      "clinic",
      names(
        "عيادة الطوارئ",
        "Emergency clinic",
        "ایمرجنسی",
        "Urgences",
        "Acil klinik",
        "Klinik darurat",
      ),
    ],
    [
      "lab",
      0,
      3,
      "110",
      "lab",
      names(
        "المختبر",
        "Laboratory",
        "لیبارٹری",
        "Laboratoire",
        "Laboratuvar",
        "Laboratorium",
      ),
    ],
    [
      "waiting0",
      0,
      4,
      "012",
      "waiting",
      names(
        "منطقة الانتظار",
        "Waiting area",
        "انتظار گاہ",
        "Salle d’attente",
        "Bekleme alanı",
        "Ruang tunggu",
      ),
    ],
    [
      "doctor",
      1,
      1,
      "210",
      "clinic",
      names(
        "عيادة الباطنية",
        "Internal medicine",
        "طب داخلی",
        "Médecine interne",
        "Dahiliye",
        "Penyakit dalam",
      ),
    ],
    [
      "outpatient",
      1,
      0,
      "208",
      "clinic",
      names(
        "العيادات الخارجية",
        "Outpatient clinic",
        "بیرونی مریض",
        "Consultations",
        "Poliklinik",
        "Rawat jalan",
      ),
    ],
    [
      "radiology",
      1,
      2,
      "214",
      "radiology",
      names(
        "الأشعة",
        "Radiology",
        "ریڈیالوجی",
        "Radiologie",
        "Radyoloji",
        "Radiologi",
      ),
    ],
    [
      "pharmacy",
      1,
      3,
      "220",
      "pharmacy",
      names("الصيدلية", "Pharmacy", "فارمیسی", "Pharmacie", "Eczane", "Apotek"),
    ],
    [
      "waiting1",
      1,
      4,
      "202",
      "waiting",
      names(
        "منطقة الانتظار",
        "Waiting area",
        "انتظار گاہ",
        "Salle d’attente",
        "Bekleme alanı",
        "Ruang tunggu",
      ),
    ],
    [
      "exit",
      0,
      0,
      "000",
      "exit",
      names("الخروج", "Exit", "باہر نکلیں", "Sortie", "Çıkış", "Keluar"),
    ],
  ] as const;
  for (const [id, floor, i, number, type, n] of defs) {
    const bottom = id === "exit";
    const x = 80 + i * 100,
      y = bottom ? 350 : 250;
    const nodeId = `door-${id}`;
    nodes.push({ id: nodeId, x, y, floor, kind: "door", accessible: true });
    edges.push({
      id: `entrance-${id}`,
      from: `f${floor}-c${i}`,
      to: nodeId,
      distance: 5,
      accessible: true,
      kind: "corridor",
    });
    rooms.push({
      id,
      names: n,
      number,
      floor,
      x: x - 42,
      y: bottom ? 350 : 105,
      width: 84,
      height: 145,
      nodeId,
      type,
      accessible: true,
    });
  }
  for (const n of nodes)
    if (
      n.kind === "corridor" &&
      edges.filter((e) => e.from === n.id || e.to === n.id).length > 2
    )
      n.kind = "intersection";
  const corridors = (floor: number) => [
    { id: `f${floor}-main`, x: 50, y: 270, width: 660, height: 60 },
    { id: `f${floor}-south`, x: 150, y: 385, width: 560, height: 50 },
    ...[480, 580, 680].map((x) => ({
      id: `f${floor}-connector-${x}`,
      x: x - 15,
      y: 300,
      width: 30,
      height: 110,
    })),
  ];
  const map: HospitalMap = {
    id: "masarak-hospital",
    name: "MASARAK",
    version: 1,
    floors: [
      { id: 0, name: "ground", corridors: corridors(0) },
      { id: 1, name: "first", corridors: corridors(1) },
    ],
    nodes,
    edges,
    rooms,
    checkpoints: [],
  };
  map.checkpoints = nodes.map((n) => checkpointForNode(map, n, `QR-${n.id}`));
  return map;
}

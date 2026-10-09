import "dotenv/config";
import { Store } from "../server/store";
import { createHospital } from "../shared/hospital";
import { checkpointForNode } from "../shared/checkpoints";
import { validateMap } from "../shared/navigation";
if (process.env.STORAGE_MODE !== "file-demo")
  throw Error("This upgrade is for the fictional local file-demo only.");
const store = new Store();
await store.load();
const map = store.state.map,
  reference = createHospital();
if (map.id !== reference.id) throw Error("Not the fictional MASARAK hospital.");
const added = new Set<string>();
for (const n of reference.nodes) {
  const existing = map.nodes.find((x) => x.id === n.id);
  if (
    existing &&
    (existing.x !== n.x || existing.y !== n.y || existing.floor !== n.floor)
  )
    throw Error(
      "Map has custom geometry. Use the admin map editor to add surveyed corridors.",
    );
  if (!existing) {
    map.nodes.push(n);
    added.add(n.id);
  }
}
for (const e of reference.edges)
  if (!map.edges.some((x) => x.id === e.id)) map.edges.push(e);
for (const f of reference.floors) {
  const floor = map.floors.find((x) => x.id === f.id);
  if (!floor) throw Error("Missing floor");
  for (const c of f.corridors)
    if (!floor.corridors.some((x) => x.id === c.id)) floor.corridors.push(c);
}
for (const n of map.nodes)
  if (
    added.has(n.id) ||
    (n.kind === "stairs" && !map.checkpoints.some((q) => q.nodeId === n.id))
  )
    map.checkpoints.push(checkpointForNode(map, n, `QR-${n.id}`));
const errors = validateMap(map);
if (errors.length) throw Error(errors.join(","));
map.version++;
await store.save();
console.log(
  `Demo QR map updated: ${map.nodes.length} nodes, ${map.checkpoints.length} checkpoints. Restart the API to reload it.`,
);

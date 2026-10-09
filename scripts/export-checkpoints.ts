import { promises as fs } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { createHospital } from "../shared/hospital";
import { checkpointPayload } from "../shared/checkpoints";
import { checkpointUrl } from "../server/qr";
const map = createHospital(),
  directory = path.resolve(process.argv[2] ?? ".data/qr-labels");
await fs.mkdir(directory, { recursive: true });
const labels = [];
for (const q of map.checkpoints) {
  const payload = process.env.PRINT_APP_URL
    ? checkpointUrl(q, process.env.PRINT_APP_URL)
    : checkpointPayload(q);
  const options = { errorCorrectionLevel: "M" as const, margin: 4, width: 600 };
  const image = await QRCode.toDataURL(payload, options);
  const svg = await QRCode.toString(payload, { ...options, type: "svg" });
  await fs.writeFile(
    path.join(directory, q.id + ".png"),
    Buffer.from(image.split(",")[1], "base64"),
  );
  await fs.writeFile(path.join(directory, q.id + ".svg"), svg);
  labels.push({ checkpoint: q, payload, image, svg });
}
await fs.writeFile(
  path.join(directory, "checkpoints.json"),
  JSON.stringify(labels, null, 2),
);
await fs.writeFile(
  path.join(directory, "hospital-map.json"),
  JSON.stringify(map, null, 2),
);
console.log(
  `Exported ${labels.length} printable QR checkpoints to ${directory}. ${process.env.PRINT_APP_URL ? "Application URLs" : "Structured in-app scan payloads"} used.`,
);

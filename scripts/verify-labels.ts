import { promises as fs } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import jsQR from "jsqr";
import { PNG } from "pngjs";
const input = process.argv[2];
if (!input) throw Error("Supply PDF crop decode-manifest.json");
const entries = JSON.parse(await fs.readFile(input, "utf8")) as {
  file: string;
  id: string;
  payload: string;
}[];
for (const item of entries) {
  const png = PNG.sync.read(await fs.readFile(item.file));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(decoded?.data, item.payload, item.id);
}
const labels = JSON.parse(
  await fs.readFile("docs/checkpoint-labels/checkpoints.json", "utf8"),
) as { checkpoint: { id: string }; payload: string }[];
for (const label of labels) {
  const png = PNG.sync.read(
    await fs.readFile(
      path.join("docs/checkpoint-labels", label.checkpoint.id + ".png"),
    ),
  );
  assert.equal(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
    label.payload,
    label.checkpoint.id,
  );
}
const report = {
  executedAt: new Date().toISOString(),
  decoder: "jsQR (independent of qrcode generator)",
  exportedPNGCodesDecoded: labels.length,
  renderedPDFCodesDecoded: entries.length,
  allPayloadsMatched: true,
  physicalCameraTested: false,
};
await fs.writeFile(
  "docs/qr-label-validation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));

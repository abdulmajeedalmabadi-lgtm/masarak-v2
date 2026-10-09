import type { Checkpoint } from "../shared/types";
export type QRLabel = {
  checkpoint: Checkpoint;
  payload: string;
  image: string;
  svg: string;
};
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function printableQrDocument(
  labels: QRLabel[],
  language: string,
  title: string,
  hint: string,
) {
  const esc = escapeHtml;
  let pages = "";
  for (let i = 0; i < labels.length; i += 6) {
    pages += `<section class="page"><header>MASARAK | ${esc(title)}</header><div class="labels">${labels
      .slice(i, i + 6)
      .map(
        (l) =>
          `<article><h2>${esc(l.checkpoint.names[language] ?? l.checkpoint.locationName)}</h2><div class="meta">${esc(l.checkpoint.hospitalId)} · ${esc(l.checkpoint.floorId)}</div><img src="${l.image}" alt="QR"/><strong dir="ltr">${esc(l.checkpoint.id)}</strong><p>${esc(hint)}</p><small dir="ltr">X ${l.checkpoint.x} · Y ${l.checkpoint.y}</small></article>`,
      )
      .join("")}</div></section>`;
  }
  return `<!doctype html><html lang="${esc(language)}" dir="${["ar", "ur"].includes(language) ? "rtl" : "ltr"}"><head><meta charset="UTF-8"/><title>MASARAK QR</title><style>@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{margin:0;font:12px system-ui;color:#102b3c}header{font-weight:800;font-size:16px;padding:0 0 5mm}.labels{display:grid;grid-template-columns:1fr 1fr;gap:4mm}article{height:80mm;border:1px dashed #aac3cb;border-radius:3mm;text-align:center;padding:4mm;break-inside:avoid;overflow:hidden}h2{font-size:14px;margin:0 0 2mm;max-height:12mm}.meta,small{font-size:9px;color:#526776}img{display:block;width:38mm;height:38mm;margin:1mm auto}strong{display:block;font-size:10px;overflow-wrap:anywhere}p{font-size:11px;margin:2mm 0}.page{break-after:page}.page:last-child{break-after:auto}.toolbar{padding:20px;background:#eef7f6}@media print{.toolbar{display:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">${esc(title)}</button></div>${pages}</body></html>`;
}
export function downloadQr(label: QRLabel, format: "png" | "svg") {
  const blob =
    format === "svg" ? new Blob([label.svg], { type: "image/svg+xml" }) : null;
  const url = blob ? URL.createObjectURL(blob) : label.image;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = label.checkpoint.id + "." + format;
  anchor.click();
  if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

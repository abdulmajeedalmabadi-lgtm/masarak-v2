import QRCode from "qrcode";
import { z } from "zod";
import type { Checkpoint } from "../shared/types";
export const checkpointInput = z.object({
  id: z.string().regex(/^QR-[A-Za-z0-9_.-]{1,100}$/),
  nodeId: z.string().min(1).max(100),
  names: z
    .object({
      ar: z.string().min(1).max(120),
      en: z.string().min(1).max(120),
      ur: z.string().min(1).max(120),
      fr: z.string().min(1).max(120),
      tr: z.string().min(1).max(120),
      id: z.string().min(1).max(120),
    })
    .optional(),
});
export function checkpointUrl(q: Checkpoint, appUrl: string) {
  const url = new URL(appUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("hospital", q.hospitalId);
  url.searchParams.set("checkpoint", q.id);
  return url.href;
}
export async function checkpointQR(q: Checkpoint, appUrl: string) {
  const payload = checkpointUrl(q, appUrl);
  const options = {
    errorCorrectionLevel: "M" as const,
    margin: 4,
    width: 600,
    color: { dark: "#000000", light: "#ffffff" },
  };
  const [image, svg] = await Promise.all([
    QRCode.toDataURL(payload, options),
    QRCode.toString(payload, { ...options, type: "svg" }),
  ]);
  return { checkpoint: q, payload, image, svg };
}

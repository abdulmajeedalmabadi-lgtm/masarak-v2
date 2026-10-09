import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
const content = `NODE_ENV=development\nPORT=4000\nSTORAGE_MODE=file-demo\nDATABASE_URL=postgresql://masarak:unused@127.0.0.1:5432/masarak\nJWT_SECRET=${randomBytes(48).toString("hex")}\nDEMO_PASSWORD=${randomBytes(18).toString("base64url")}\nPUBLIC_APP_URL=http://localhost:5173\nCORS_ORIGINS=http://localhost:5173\nVITE_API_URL=\n`;
await fs.writeFile(".env", content, { flag: "wx", mode: 0o600 });
console.log(
  "Created private .env for local file-demo. Read DEMO_PASSWORD there for the demo login. Existing files are never overwritten.",
);

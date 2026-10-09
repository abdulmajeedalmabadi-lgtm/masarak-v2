import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
// A shared workspace temp directory also works in restricted Windows subprocesses.
const temp = resolve(".data/test-runtime");
mkdirSync(temp, { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--maxWorkers",
    "2",
    "--testTimeout",
    "15000",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
  },
);
process.exit(result.status ?? 1);

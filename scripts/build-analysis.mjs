import { build } from "esbuild";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = new URL("roster-analyze.cjs", import.meta.url);
const result = await build({ absWorkingDir: root, entryPoints: ["scripts/roster-analyze.ts"], bundle: true,
  platform: "node", target: "node18", format: "cjs", write: false, legalComments: "none" });
const bytes = result.outputFiles[0].contents;
if (process.argv.slice(2).some(x => x !== "--check") || process.argv.length > 3) throw new Error("usage: build-analysis.mjs [--check]");
if (process.argv.includes("--check")) {
  if (!fs.existsSync(target) || !Buffer.from(bytes).equals(fs.readFileSync(target))) throw new Error("analysis bundle is stale; run npm run build:analysis");
} else { fs.writeFileSync(target, bytes, { mode: 0o755 }); }

// Ratchet for checker setup classification: 0 pass, 1 assertion, 2 infrastructure.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const source = path.resolve(__dirname, "..");
const checker = path.join(source, "scripts/content-snapshot-guards.check.js");

function runCheck(fixture, scenario, extraEnv = {}) {
  const result = spawnSync(process.execPath, [checker, fixture, scenario], {
    encoding: "utf8", env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error("checker terminated without an exit code");
  assert.ok(result.status >= 2, `${scenario} setup failure must exit >=2, got ${result.status}: ${result.stderr}`);
}

let temporary;
try {
  fs.accessSync(checker, fs.constants.R_OK);
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-checker-setup-"));
  const fixture = path.join(temporary, "source");
  for (const rel of ["scripts/lib/review/redgreen-scratch.js", "scripts/lib/git-tree-snapshot.js"]) {
    const target = path.join(fixture, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, rel), target);
  }
  // The wrapper alone is missing: every other source prerequisite is intact.
  for (const scenario of ["all", "mutation", "read-only", "snapshot-errors"]) runCheck(fixture, scenario);
  fs.copyFileSync(path.join(source, "scripts/xruntime-exec.sh"), path.join(fixture, "scripts/xruntime-exec.sh"));
  const bin = path.join(temporary, "bin");
  fs.mkdirSync(bin);
  for (const tool of ["git", "node", "timeout"]) {
    const shim = path.join(bin, tool);
    fs.writeFileSync(shim, "#!/bin/sh\nexit 127\n", { mode: 0o755 });
    for (const scenario of ["mutation", "read-only", "snapshot-errors"]) {
      runCheck(fixture, scenario, { PATH: bin + path.delimiter + process.env.PATH });
    }
    fs.unlinkSync(shim);
  }
  fs.writeFileSync(path.join(fixture, "scripts/xruntime-exec.sh"), "#!/bin/sh\nexit 127\n");
  for (const scenario of ["mutation", "read-only", "snapshot-errors"]) runCheck(fixture, scenario);
  console.log("checker setup failures are infrastructure errors");
} catch (error) {
  console.error(error.message);
  process.exitCode = error instanceof assert.AssertionError ? 1 : 2;
} finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }

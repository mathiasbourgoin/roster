// Standalone consumer-boundary assertion: 0 pass, 1 assertion, 2 infrastructure.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const source = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..");
const scenario = process.argv[3] || "all";
let dir;
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" }).toString().trim();
try {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-snapshot-check-"));
  if (!["all", "mutation", "read-only", "snapshot-errors"].includes(scenario)) throw new Error("unknown check scenario");
  const { verifyCheck } = require(path.join(source, "scripts/lib/review/redgreen-scratch"));
  git("init", "-q");
  git("config", "user.email", "check@example.invalid");
  git("config", "user.name", "snapshot check");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "payload"), "base");
  git("add", "payload"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  const checkPath = path.join(dir, "check.js");
  fs.writeFileSync(checkPath, "require('fs').writeFileSync('payload', 'after');");
  const blob = git("hash-object", "check.js");
  const stub = path.join(dir, "runtime");
  fs.writeFileSync(stub, "#!/usr/bin/env node\nrequire('fs').writeFileSync('payload', 'after');\n", { mode: 0o755 });
  fs.writeFileSync(path.join(dir, "payload"), "before");
  const before = git("status", "--porcelain", "-uall");
  if (scenario === "all" || scenario === "mutation") {
    const wrapper = spawnSync("bash", [path.join(source, "scripts/xruntime-exec.sh"), "codex", "inspect"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, XRUNTIME_BIN: stub },
    });
    if (wrapper.error) throw wrapper.error;
    assert.equal(git("status", "--porcelain", "-uall"), before);
    assert.equal(wrapper.status, 3, "wrapper must reject existing dirty content mutation");
    fs.writeFileSync(path.join(dir, "payload"), "before");
    const result = verifyCheck({ repoRoot: dir, checkRelPath: "check.js", preFixSha: base,
      recordedBlob: blob, redVerified: true, timeoutMs: 5000 });
    assert.equal(result.inconclusive, true, "green guard must reject existing dirty content mutation");
    assert.match(result.reason, /mutated the working tree/);
  }
  if (scenario === "all" || scenario === "read-only") {
    fs.writeFileSync(checkPath, "process.exit(0);");
    const valid = verifyCheck({ repoRoot: dir, checkRelPath: "check.js", preFixSha: base,
      recordedBlob: git("hash-object", "check.js"), redVerified: true, timeoutMs: 5000 });
    assert.equal(valid.greenFailed, false, "read-only green run must pass");
    fs.writeFileSync(stub, "#!/bin/sh\nprintf inspected\\n\n", { mode: 0o755 });
    const noWrite = spawnSync("bash", [path.join(source, "scripts/xruntime-exec.sh"), "codex", "inspect"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, XRUNTIME_BIN: stub },
    });
    if (noWrite.error) throw noWrite.error;
    assert.equal(noWrite.status, 0, "read-only runtime must pass");
  }
  if (scenario === "all" || scenario === "snapshot-errors") {
    fs.writeFileSync(stub, "#!/usr/bin/env node\nrequire('fs').rmSync('.git', { recursive: true });\n", { mode: 0o755 });
    const unavailable = spawnSync("bash", [path.join(source, "scripts/xruntime-exec.sh"), "codex", "inspect"], {
      cwd: dir, encoding: "utf8", env: { ...process.env, XRUNTIME_BIN: stub },
    });
    if (unavailable.error) throw unavailable.error;
    assert.equal(unavailable.status, 3, "after-snapshot failure must reject runtime success");
  }
  console.log("content snapshot consumer checks passed: " + scenario);
} catch (error) {
  console.error(error.message);
  process.exitCode = error instanceof assert.AssertionError ? 1 : 2;
} finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); }

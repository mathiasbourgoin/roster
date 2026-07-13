// scripts/lib/redgreen-scratch.js — CommonJS
// Low-level, git/filesystem-facing primitives for red-before-green check
// verification (spec: specs/pipeline-loop-convergence.md FR-035..FR-039,
// A-6). Split out of scripts/check-review-convergence.js (FIX-1 follow-on:
// the round/strike/audit/breaker extraction alone left the main script over
// the repo's 500-line limit; this module carries the same "split by
// responsibility" principle one level further) so each file stays under
// that limit.
//
// Responsibility boundary: this module owns "safely run a check command
// against an isolated pre-fix copy of the repo, never mutating the real
// tree or .git" — extracting the pre-fix tree via `git archive | tar -x`
// (never `git worktree add`, FR-022/A-2), running the red/green halves with
// a cwd jail and timeout, and the exit-code interpretation (A-6:
// 0=pass, 1=assertion fired, >=2=error). The main script keeps the
// per-finding orchestration (which findings need checking, how a raw
// outcome becomes a violation) and everything else (CLI parsing, structural
// finding checks, round/strike/audit — the last three via
// scripts/lib/review-convergence-rules.js).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function isFullSha(s) {
  return typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
}

// Verify a single ratcheted check: red against pre_fix_sha (scratch, overlay-only),
// green against the current tree. Never mutates the real repo or .git.
// Guard clauses only — the two verification branches are extracted below.
function verifyCheck({ repoRoot, checkRelPath, preFixSha, recordedBlob, timeoutMs }) {
  if (!isFullSha(preFixSha)) {
    return { inconclusive: true, reason: `pre_fix_sha is not a full 40-hex sha: ${preFixSha}` };
  }
  try {
    execFileSync("git", ["rev-parse", "-q", "--verify", `${preFixSha}^{commit}`], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch (e) {
    return { inconclusive: true, reason: `pre_fix_sha unreachable: ${preFixSha}` };
  }

  const checkAbsPath = path.resolve(repoRoot, checkRelPath);
  if (!fs.existsSync(checkAbsPath)) {
    return { inconclusive: true, reason: `check file not found in current tree: ${checkRelPath}` };
  }

  let currentBlob;
  try {
    currentBlob = execFileSync("git", ["hash-object", checkRelPath], { cwd: repoRoot, stdio: "pipe" })
      .toString()
      .trim();
  } catch (e) {
    return { inconclusive: true, reason: `git hash-object failed for ${checkRelPath}` };
  }

  const needsVerification = recordedBlob === null || recordedBlob !== currentBlob;
  if (!needsVerification) {
    return reverifyGreenOnly(checkAbsPath, repoRoot, timeoutMs, currentBlob);
  }
  return verifyViaScratch({ repoRoot, checkRelPath, checkAbsPath, preFixSha, recordedBlob, currentBlob, timeoutMs });
}

// Already red-verified at this exact blob — only the green half re-runs.
function reverifyGreenOnly(checkAbsPath, repoRoot, timeoutMs, currentBlob) {
  const green = runGreenPhase(checkAbsPath, repoRoot, timeoutMs);
  if (green.inconclusive) return { inconclusive: true, reason: green.reason, check_blob: currentBlob };
  return { red_verified: true, check_blob: currentBlob, greenFailed: green.code !== 0 };
}

// First-time (or blob-mismatch re-)verification: extract the pre-fix tree,
// run red there, then run green against the current tree.
function verifyViaScratch({ repoRoot, checkRelPath, checkAbsPath, preFixSha, recordedBlob, currentBlob, timeoutMs }) {
  let scratchDir;
  try {
    scratchDir = extractPreFixTree(repoRoot, preFixSha, checkRelPath, checkAbsPath);
  } catch (e) {
    return { inconclusive: true, reason: e.message, check_blob: currentBlob };
  }

  try {
    const scratchCheckPath = path.resolve(scratchDir, checkRelPath);
    const red = runRedPhase(scratchCheckPath, scratchDir, repoRoot, timeoutMs);
    if (red.inconclusive) return { inconclusive: true, reason: red.reason, check_blob: currentBlob };
    if (red.code === 0) return { vacuous: true, check_blob: currentBlob };
    if (red.code >= 2) {
      return {
        inconclusive: true,
        reason: `red command exited ${red.code} (>=2, error/setup)`,
        check_blob: currentBlob,
      };
    }

    // red.code === 1: assertion fired as expected.
    const wasPreviouslyVerified = recordedBlob !== null;
    const green = runGreenPhase(checkAbsPath, repoRoot, timeoutMs);
    if (green.inconclusive) return { inconclusive: true, reason: green.reason, check_blob: currentBlob };

    return {
      red_verified: true,
      check_blob: currentBlob,
      weakened: wasPreviouslyVerified && green.code !== 0,
      greenFailed: !wasPreviouslyVerified && green.code !== 0,
    };
  } finally {
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch (e) {
      // best-effort cleanup; scratch dir is outside the repo, never blocks the verdict
    }
  }
}

// Extracts the pre-fix tree via `git archive | tar -x` into a fresh scratch
// directory — never `git worktree add` (FR-022/A-2) — then overlays ONLY the
// new check file (copied in from the CURRENT tree). Throws on any setup
// failure; the caller treats that as inconclusive.
function extractPreFixTree(repoRoot, preFixSha, checkRelPath, checkAbsPath) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "check-review-convergence-"));
  try {
    execFileSync("sh", ["-c", `git archive ${preFixSha} | tar -x -C "${scratchDir}"`], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch (e) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    throw new Error(`git archive extraction failed for ${preFixSha}`);
  }

  const scratchCheckPath = path.resolve(scratchDir, checkRelPath);
  try {
    fs.mkdirSync(path.dirname(scratchCheckPath), { recursive: true });
    fs.copyFileSync(checkAbsPath, scratchCheckPath);
  } catch (e) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    throw new Error(`overlay of check file failed: ${e.message}`);
  }

  return scratchDir;
}

// Runs the red half: the check executed inside the scratch (pre-fix) tree.
function runRedPhase(scratchCheckPath, scratchDir, repoRoot, timeoutMs) {
  return runNode(scratchCheckPath, scratchDir, repoRoot, timeoutMs);
}

// Runs the green half: the check executed against the current (real) tree.
function runGreenPhase(checkAbsPath, repoRoot, timeoutMs) {
  return runNode(checkAbsPath, repoRoot, repoRoot, timeoutMs);
}

// Runs `node <absPath>` honoring the red-command exit convention (A-6):
// 0 = pass, 1 = assertion fired, >=2 = error. NODE_PATH points at the live
// repo's node_modules so scratch-tree runs have dependency availability
// without repo mutation.
function runNode(absPath, cwd, repoRoot, timeoutMs) {
  try {
    execFileSync("node", [absPath], {
      cwd,
      timeout: timeoutMs,
      env: Object.assign({}, process.env, { NODE_PATH: path.resolve(repoRoot, "node_modules") }),
      stdio: "pipe",
    });
    return { code: 0 };
  } catch (e) {
    if (e.signal) {
      return { inconclusive: true, reason: `red/green command timed out or was killed (signal ${e.signal})` };
    }
    if (typeof e.status === "number") {
      return { code: e.status };
    }
    return { inconclusive: true, reason: `red/green command failed to run: ${e.message}` };
  }
}

module.exports = { isFullSha, verifyCheck };

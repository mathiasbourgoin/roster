#!/usr/bin/env node
// check-review-convergence.js — CommonJS
// Read-only mechanical gate deciding whether a NO-GO route-back is permitted
// (spec: specs/pipeline-loop-convergence.md, FR-021..FR-039; extended by
// specs/review-fanout-convergence.md FR-050..FR-085 + Amendments B-1..B-9).
// Patterned on scripts/check-scope-diff.sh's exit contract.
//
// Usage:
//   node scripts/check-review-convergence.js <review.json path> [--static]
//     [--max-rounds N] [--timeout S] [--strikes N]
//
// Exit contract:
//   0 = pass (no violations, no degraded input)
//   1 = design violation(s) found — JSON report on stdout (`violations`
//       array); top-level `cause` is one of round-cap | unencodable-finding |
//       novel-finding-streak (precedence: unencodable-finding >
//       novel-finding-streak > round-cap; B-5/FR-059)
//   2 = degraded input (absent/malformed review.json, an unknown flag, or an
//       inconclusive red/green verification — fail-closed; see FR-023, FR-036)
//   3 = process-incomplete-only (missing/incomplete rounds_audit entry for the
//       current round, B-5/FR-079) — repair the draft and re-gate, do NOT
//       route; top-level `cause` is never "process-incomplete"
//
// Read-only guarantee (FR-022, amended A-2): this script MUST NOT modify any
// repo file or `.git` state. Pre-fix trees are extracted via
// `git archive <sha> | tar -x` into a scratch directory — `git worktree add`
// is NEVER used. Red/green commands run inside scratch copies with a cwd
// jail and a per-command timeout (default 120s, --timeout).
//
// Check-value contract: a finding's `check` field MUST be a node-runnable
// file path (the gate always invokes it as `node <path>`, per A-6 — the file
// itself is the red/green command). A spec-level `CHECK-N` id with no
// corresponding file is recorded by roster-review but is NOT red/green
// executed by this gate (see roster-review.md §5.5) — it is out of scope for
// mechanical verification, not a violation.
//
// Legacy handling (B-8): when review.json lacks the `round` key (the physical
// per-cycle counter introduced by review-fanout-convergence), strike
// classification and the rounds_audit completeness check are SKIPPED
// entirely with a warning — the 17 pre-existing fixtures (keyed on
// `no_go_round` only) therefore pass unmodified. New behavior activates only
// once `round` is present in review.json.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const HIGH_PLUS = new Set(["CRITICAL", "HIGH"]);
const KNOWN_FLAGS = new Set(["--static", "--max-rounds", "--timeout", "--strikes"]);
const DEFAULT_STRIKES = 2;

// B-4: unknown flags are rejected (exit 2) so a stale/mismatched invocation
// fails loudly instead of silently ignoring a new flag.
function parseArgs(argv) {
  const out = { reviewPath: null, static: false, maxRounds: 5, timeout: 120, strikes: DEFAULT_STRIKES, unknownFlag: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--static") {
      out.static = true;
    } else if (a === "--max-rounds") {
      out.maxRounds = parseInt(argv[++i], 10);
    } else if (a === "--timeout") {
      out.timeout = parseInt(argv[++i], 10);
    } else if (a === "--strikes") {
      out.strikes = parseInt(argv[++i], 10);
    } else if (a.startsWith("--") && !KNOWN_FLAGS.has(a)) {
      out.unknownFlag = a;
    } else if (!out.reviewPath) {
      out.reviewPath = a;
    } else {
      out.unknownFlag = a;
    }
  }
  return out;
}

function fail(code, message) {
  if (message) process.stderr.write(`check-review-convergence: ${message}\n`);
  process.exit(code);
}

function isFullSha(s) {
  return typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
}

function findingFingerprint(f) {
  return typeof f.fingerprint === "string" ? f.fingerprint : `${f.path || "?"}:${f.line ?? 0}:${f.category || "?"}`;
}

// ── argument + input validation ─────────────────────────────────────────
// Parses argv, reads review.json, and validates its shape. Exits (via fail)
// on any usage or degraded-input error — never returns in that case.
function validateArgsAndReview(argv) {
  const args = parseArgs(argv);
  if (args.unknownFlag) fail(2, `unknown flag or extra argument: ${args.unknownFlag}`);
  if (!args.reviewPath) fail(2, "usage: <review.json path> [--static] [--max-rounds N] [--timeout S] [--strikes N]");
  if (Number.isNaN(args.maxRounds) || args.maxRounds < 1) fail(2, "--max-rounds must be a positive integer");
  if (Number.isNaN(args.timeout) || args.timeout < 1) fail(2, "--timeout must be a positive integer (seconds)");
  if (Number.isNaN(args.strikes) || args.strikes < 1) fail(2, "--strikes must be a positive integer");

  const review = readReviewJson(path.resolve(process.cwd(), args.reviewPath), args.reviewPath);
  const roundState = deriveRoundState(review);

  return Object.assign({ args, review }, roundState);
}

// Reads and parses review.json. Exits (via fail) on any absent/unreadable/
// malformed/non-object input — never returns in that case.
function readReviewJson(reviewPath, displayPath) {
  if (!fs.existsSync(reviewPath)) fail(2, `review.json not found: ${displayPath}`);

  let raw;
  try {
    raw = fs.readFileSync(reviewPath, "utf8");
  } catch (e) {
    fail(2, `cannot read review.json: ${e.message}`);
    return;
  }

  let review;
  try {
    review = JSON.parse(raw);
  } catch (e) {
    fail(2, `review.json is not valid JSON: ${e.message}`);
    return;
  }
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail(2, "review.json must be a JSON object");
    return;
  }
  return review;
}

// Derives no_go_round (FR-030 legacy handling), the physical `round` counter
// (B-8 legacy handling), the findings array, and the B-7 re-keyed
// carry-forward-inconsistency warning from a validated review object.
function deriveRoundState(review) {
  const warnings = [];

  let noGoRound = 0;
  let legacyNoGoRound = false;
  if (Object.prototype.hasOwnProperty.call(review, "no_go_round")) {
    if (typeof review.no_go_round !== "number" || !Number.isFinite(review.no_go_round) || review.no_go_round < 0) {
      fail(2, "review.json field no_go_round must be a non-negative number");
      return;
    }
    noGoRound = review.no_go_round;
  } else {
    legacyNoGoRound = true;
    warnings.push("legacy review.json: no_go_round key absent — treating as round 0");
  }

  // B-8: `round` (physical per-cycle verdict counter) is a distinct field from
  // `no_go_round` (qualifying-only backstop). Its absence means legacy
  // review.json — strike classification and the rounds_audit completeness
  // check are skipped entirely (below, in main()), not just defaulted.
  let round = null;
  let legacyRound = false;
  if (Object.prototype.hasOwnProperty.call(review, "round")) {
    if (typeof review.round !== "number" || !Number.isFinite(review.round) || review.round < 0) {
      fail(2, "review.json field round must be a non-negative number");
      return;
    }
    round = review.round;
  } else {
    legacyRound = true;
    warnings.push("legacy review.json: round key absent — skipping strike and rounds_audit checks (B-8)");
  }

  const findings = Array.isArray(review.findings) ? review.findings : [];

  // B-7: A-11 re-keyed to the physical `round` counter (retiring the old
  // no_go_round-based form) — warn when round is absent/0 while a finding
  // carries first_seen_round > 0 (unverifiable carry-forward inconsistency).
  if ((round === null || round === 0) && findings.some((f) => typeof f.first_seen_round === "number" && f.first_seen_round > 0)) {
    warnings.push(
      "inconsistency: round is absent/0 but a finding carries first_seen_round > 0 (unverifiable carry-forward, A-11/B-7)"
    );
  }

  return { findings, warnings, noGoRound, legacyNoGoRound, round, legacyRound };
}

// ── structural finding checks ────────────────────────────────────────────
// FR-012/013/025/027 (ratchet obligation + unencodable-finding escalation)
// and the FIX-2 hardening: a RESOLVED HIGH+ finding with missing/non-numeric
// round provenance must not silently escape the ratchet.
function computeFindingViolations(findings) {
  const violations = [];

  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    if (!HIGH_PLUS.has(f.severity)) continue;

    const fingerprint = findingFingerprint(f);
    const accepted = f.status === "ACCEPTED";

    if (f.status === "RESOLVED" && !accepted) {
      const firstSeenValid = typeof f.first_seen_round === "number" && Number.isFinite(f.first_seen_round);
      const resolvedValid = typeof f.resolved_round === "number" && Number.isFinite(f.resolved_round);

      if (!firstSeenValid || !resolvedValid) {
        // Missing/non-numeric round provenance — cannot prove this was (or
        // wasn't) a same-round raise+resolve, so it cannot be waved through.
        violations.push({
          type: "missing-round-provenance",
          cause: "unencodable-finding",
          fingerprint,
          detail:
            "HIGH+ finding RESOLVED but missing/non-numeric first_seen_round or resolved_round — cannot verify ratchet exemption",
        });
      } else if (f.resolved_round > f.first_seen_round && (f.check === null || f.check === undefined)) {
        // FR-012/FR-025: crossed a loop-back round with no linked check.
        violations.push({
          type: "resolved-without-check",
          cause: "unencodable-finding",
          fingerprint,
          detail: "HIGH+ finding RESOLVED across a loop-back round with no linked check (FR-012)",
        });
      }
    }

    // FR-027: unencodable + not ACCEPTED -> design-not-converging.
    if (f.check_encodable === false && !accepted) {
      violations.push({
        type: "unencodable-finding",
        cause: "unencodable-finding",
        fingerprint,
        detail: "HIGH+ finding marked check_encodable: false and not human-ACCEPTED (FR-027)",
      });
    }
  }

  return violations;
}

// ── two-strike novel-finding escalation (US-1, B-1) ──────────────────────
// A physical round r >= 2 is a strike iff it contains >=1 novel HIGH+
// non-scope finding (first_seen_round == r) that is neither same-round-
// resolved nor ACCEPTED (FR-053). Round 1 never strikes (FR-053, AC-4).
function isNovelStrikeFinding(f, round) {
  if (!f || typeof f !== "object") return false;
  if (!HIGH_PLUS.has(f.severity)) return false;
  if (f.category === "scope") return false; // EC-4: scope findings never strike
  if (f.status === "ACCEPTED") return false; // EC-1
  if (typeof f.first_seen_round !== "number" || f.first_seen_round !== round) return false;
  if (f.status === "RESOLVED" && f.resolved_round === f.first_seen_round) return false; // same-round-resolved
  return true;
}

// B-1: past strikes are read from rounds_audit[].strike — journaled by
// roster-review, never recomputed here. Only the CURRENT round's strike is
// computed fresh, from findings, since that is point-in-time correct at gate
// time. Returns a round -> strike boolean map covering every round seen.
function computeStrikeMap(review, currentRound, findings) {
  const strikeByRound = new Map();
  const roundsAudit = Array.isArray(review.rounds_audit) ? review.rounds_audit : [];
  for (const entry of roundsAudit) {
    if (entry && typeof entry.round === "number" && typeof entry.strike === "boolean") {
      strikeByRound.set(entry.round, entry.strike);
    }
  }
  const currentStrike = currentRound >= 2 && findings.some((f) => isNovelStrikeFinding(f, currentRound));
  strikeByRound.set(currentRound, currentStrike);
  return { strikeByRound, currentStrike };
}

// FR-054/FR-055: violation when the last `strikesRequired` consecutive
// physical rounds (all >= 2) each classify as a strike; a strike-free round
// resets the streak (non-consecutive strikes never accumulate).
function computeStreakViolation(strikeByRound, currentRound, strikesRequired) {
  if (currentRound < 2) return null;
  for (let r = currentRound; r > currentRound - strikesRequired; r--) {
    if (r < 2 || strikeByRound.get(r) !== true) return null;
  }
  return {
    type: "novel-finding-streak",
    cause: "novel-finding-streak",
    detail: `${strikesRequired} consecutive round(s) (>= round 2) each classified as a strike, ending at round ${currentRound}`,
  };
}

// ── delta-scoped loop-back rounds_audit completeness (US-3, B-8) ────────
// FR-078/FR-079: on round >= 2, the current round's rounds_audit entry must
// be present and complete (reviewed_sha, fix_sha|fix_sha_reason,
// non-empty specialists_run with non-empty selection_reason each). Missing
// or incomplete -> process-incomplete (exit 3), never routed (B-5).
function computeMissingAuditViolation(review, currentRound) {
  if (currentRound < 2) return null;
  const roundsAudit = Array.isArray(review.rounds_audit) ? review.rounds_audit : [];
  const entry = roundsAudit.find((e) => e && e.round === currentRound);
  const incomplete = (detail) => ({ type: "missing-loopback-audit", cause: "process-incomplete", detail });

  if (!entry) return incomplete(`no rounds_audit entry for round ${currentRound}`);
  if (typeof entry.reviewed_sha === "undefined") {
    return incomplete(`rounds_audit entry for round ${currentRound} missing reviewed_sha`);
  }
  if (typeof entry.fix_sha === "undefined") {
    return incomplete(`rounds_audit entry for round ${currentRound} missing fix_sha`);
  }
  if (entry.fix_sha === null && (typeof entry.fix_sha_reason !== "string" || entry.fix_sha_reason.trim() === "")) {
    // EC-8: dirty tree -> fix_sha null + fix_sha_reason passes with a flag;
    // null without a reason is incomplete.
    return incomplete(`rounds_audit entry for round ${currentRound} has null fix_sha without fix_sha_reason`);
  }
  if (!Array.isArray(entry.specialists_run) || entry.specialists_run.length === 0) {
    return incomplete(`rounds_audit entry for round ${currentRound} has empty specialists_run`);
  }
  for (const s of entry.specialists_run) {
    if (!s || typeof s.selection_reason !== "string" || s.selection_reason.trim() === "") {
      return incomplete(`rounds_audit entry for round ${currentRound} has an empty selection_reason`);
    }
  }
  return null;
}

// ── cross-runtime circuit breaker structural warning (US-2, FR-069) ─────
// The breaker's mechanical teeth are limited to this structural warning plus
// the config echo (B-9, accepted residual R-4) — probe-once/discard/no-retry
// compliance is prose-level, enforced by roster-review.
function computeCrossRuntimeWarnings(review) {
  const warnings = [];
  const crossRuntime = review.cross_runtime;
  if (!crossRuntime || typeof crossRuntime !== "object" || Array.isArray(crossRuntime)) return warnings;
  for (const [name, entry] of Object.entries(crossRuntime)) {
    if (!entry || entry.status !== "degraded") continue;
    if (!entry.reason) warnings.push(`cross_runtime.${name}: degraded entry missing reason`);
    if (!entry.config_digest) warnings.push(`cross_runtime.${name}: degraded entry missing config_digest`);
  }
  return warnings;
}

// FR-059/B-5: precedence unencodable-finding > novel-finding-streak >
// round-cap; process-incomplete is never a top-level cause.
function selectCause(violations) {
  const causes = new Set(violations.map((v) => v.cause));
  if (causes.has("unencodable-finding")) return "unencodable-finding";
  if (causes.has("novel-finding-streak")) return "novel-finding-streak";
  if (causes.has("round-cap")) return "round-cap";
  return null;
}

// ── red-before-green verification (full mode only) ──────────────────────
// FR-035..FR-039. Returns { violations, checks, anyInconclusive }.
function runRedGreenVerification(findings, args) {
  const violations = [];
  const checks = [];
  let anyInconclusive = false;
  if (args.static) return { violations, checks, anyInconclusive };

  const repoRoot = process.cwd();
  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    if (!f.check || typeof f.check !== "string") continue;

    const outcome = verifyFinding(f, repoRoot, args.timeout * 1000);
    checks.push(outcome.checkEntry);
    violations.push(...outcome.violations);
    if (outcome.inconclusive) anyInconclusive = true;
  }

  return { violations, checks, anyInconclusive };
}

// Verifies a single finding's ratcheted check and translates the raw
// verifyCheck() result into report entries (violations + a checks[] entry).
function verifyFinding(f, repoRoot, timeoutMs) {
  if (f.pre_fix_sha === null || f.pre_fix_sha === undefined) {
    // FR-034: uncommitted-tree task — accepted, flagged, not a violation.
    return {
      checkEntry: {
        check: f.check,
        fingerprint: f.fingerprint,
        red_verified: null,
        flagged: "no pre_fix_sha recorded (uncommitted-tree task, FR-034)",
      },
      violations: [],
      inconclusive: false,
    };
  }

  const result = verifyCheck({
    repoRoot,
    checkRelPath: f.check,
    preFixSha: f.pre_fix_sha,
    recordedBlob: f.check_blob || null,
    timeoutMs,
  });

  return {
    checkEntry: Object.assign({ check: f.check, fingerprint: f.fingerprint }, result),
    violations: buildRedGreenViolations(result, f),
    inconclusive: !!result.inconclusive,
  };
}

// Translates a verifyCheck() outcome into 0-2 violation report entries.
function buildRedGreenViolations(result, f) {
  const violations = [];

  if (result.vacuous) {
    violations.push({
      type: "vacuous-check",
      cause: "unencodable-finding",
      fingerprint: f.fingerprint,
      check: f.check,
      detail: "red command exited 0 against the pre-fix tree — check never fails (FR-036)",
    });
  } else if (result.weakened) {
    violations.push({
      type: "weakened-check",
      cause: "unencodable-finding",
      fingerprint: f.fingerprint,
      check: f.check,
      detail: "check_blob mismatch and re-verification could not reproduce red (FR-038)",
    });
  }

  if (result.greenFailed) {
    violations.push({
      type: "green-failure",
      cause: "unencodable-finding",
      fingerprint: f.fingerprint,
      check: f.check,
      detail: "check does not pass against the current tree (FR-039)",
    });
  }

  return violations;
}

// ── main ─────────────────────────────────────────────────────────────────
function main() {
  const { args, review, findings, warnings, noGoRound, legacyNoGoRound, round, legacyRound } = validateArgsAndReview(
    process.argv.slice(2)
  );

  const violations = [];

  // FR-026: cap violation.
  if (noGoRound >= args.maxRounds) {
    violations.push({
      type: "round-cap",
      cause: "round-cap",
      detail: `no_go_round (${noGoRound}) >= max-rounds (${args.maxRounds})`,
    });
  }

  violations.push(...computeFindingViolations(findings));

  // US-1/US-3 (B-8): only evaluated when `round` is present — legacy
  // review.json skips strike classification and the audit check entirely.
  let currentRoundStrike = null;
  if (!legacyRound) {
    const { strikeByRound, currentStrike } = computeStrikeMap(review, round, findings);
    currentRoundStrike = currentStrike;
    const streakViolation = computeStreakViolation(strikeByRound, round, args.strikes);
    if (streakViolation) violations.push(streakViolation);

    const auditViolation = computeMissingAuditViolation(review, round);
    if (auditViolation) violations.push(auditViolation);
  }

  warnings.push(...computeCrossRuntimeWarnings(review));

  const redGreen = runRedGreenVerification(findings, args);
  violations.push(...redGreen.violations);

  const cause = selectCause(violations);
  const hasDesignViolation = violations.some((v) => v.cause !== "process-incomplete");
  const hasProcessIncompleteOnly = !hasDesignViolation && violations.some((v) => v.cause === "process-incomplete");

  const report = {
    mode: args.static ? "static" : "full",
    no_go_round: noGoRound,
    max_rounds: args.maxRounds,
    legacy_no_go_round: legacyNoGoRound,
    round,
    legacy_round: legacyRound,
    current_round_strike: currentRoundStrike,
    config: { max_rounds: args.maxRounds, strikes: args.strikes, static: args.static },
    cause,
    warnings,
    violations,
    checks: redGreen.checks,
  };

  // Always emit the JSON report, even on exit 0 — unlike check-scope-diff.sh's
  // silent-on-clean convention, roster-review must merge `checks[]`
  // (red_verified/check_blob) back into review.json on every verdict,
  // including a clean GO round (A-1/A-2 gate-before-write order).
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (redGreen.anyInconclusive) process.exit(2);
  if (hasDesignViolation) process.exit(1);
  if (hasProcessIncompleteOnly) process.exit(3);
  process.exit(0);
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

if (require.main === module) {
  main();
}

module.exports = { parseArgs, isFullSha, isNovelStrikeFinding, computeStrikeMap, computeStreakViolation, selectCause };

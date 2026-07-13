#!/usr/bin/env node
// scripts/xruntime-review.js — CommonJS.
//
// Cross-runtime (second-model) review helper (spec: specs/review-skill-slimming.md
// US-1, FR-086..098, Amendments D-2/D-3/D-8/D-9). Owns probe execution,
// health-state transitions, output validation, and the invocation journal in
// one deterministic script, so breaker compliance stops depending on prose
// discipline (roster-review.md §"Cross-Runtime Review").
//
// MUST NOT modify scripts/xruntime-exec.sh in any way (FR-086, byte-identical,
// preserving roster-qa co-consumption) — this script invokes it as a
// subprocess and captures stdout/stderr separately (D-3).
//
// Usage:
//   node scripts/xruntime-review.js <codex|opencode> "<prompt>" --task <slug>
//     [--round <n>] [--write] [--timeout <sec>] [--human-retry] [--skip "<reason>"]
//
// stdout carries only the helper's own JSON result (FR-087):
//   { status, reason, config_digest, findings[], journal_line }
//   status: "healthy" | "degraded" | "skipped-degraded" | "skipped-human"
//
// Exit: 0 = a classification was produced and journaled (any status above);
//       2 = usage error, bad --task slug, or journal-append failure (never
//           reports healthy in this case, FR-096).
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { computeDigest } = require("./lib/xruntime-digest");
const { classify } = require("./lib/xruntime-classify");
const {
  validSlug,
  warnIfBriefsNotIgnored,
  appendJournalLine,
  readReviewJson,
  shouldRefuseDegraded,
} = require("./lib/xruntime-journal");

const WRAPPER = path.resolve(__dirname, "xruntime-exec.sh");

function fail(code, message) {
  process.stderr.write(`xruntime-review: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    runtime: null,
    prompt: null,
    task: null,
    round: null,
    write: false,
    timeout: 480,
    humanRetry: false,
    skip: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task") out.task = argv[++i];
    else if (a === "--round") out.round = parseInt(argv[++i], 10);
    else if (a === "--write") out.write = true;
    else if (a === "--timeout") out.timeout = parseInt(argv[++i], 10);
    else if (a === "--human-retry") out.humanRetry = true;
    else if (a === "--skip") out.skip = argv[++i];
    else positionals.push(a);
  }
  out.runtime = positionals[0] || null;
  out.prompt = positionals[1] || null;
  return out;
}

// Invokes the unmodified wrapper as a subprocess, capturing stdout and
// stderr SEPARATELY (D-3 — exit-code corroboration needs the stderr marker
// without it ever reaching the helper's own stdout, FR-087).
function runWrapper(args) {
  const start = Date.now();
  const cmdArgs = [WRAPPER, args.runtime, args.prompt];
  if (args.write) cmdArgs.push("--write");
  cmdArgs.push("--timeout", String(args.timeout));

  const result = spawnSync("bash", cmdArgs, {
    encoding: "utf8",
    timeout: (args.timeout + 15) * 1000,
    env: process.env,
  });
  const durationS = (Date.now() - start) / 1000;
  // spawnSync reports status: null when ITS OWN timeout fires (a harness-level
  // backstop above the wrapper's own `timeout` call) — treat as exit 124.
  const exitCode = result.status === null ? 124 : result.status;

  const classification = classify({
    exitCode,
    stderr: result.stderr || "",
    durationS,
    timeoutS: args.timeout,
    stdout: result.stdout || "",
  });

  if (classification.outcome === "healthy") {
    return { status: "healthy", reason: null, findings: classification.findings, runtimeExit: exitCode, durationS };
  }
  return { status: "degraded", reason: classification.outcome, findings: [], runtimeExit: exitCode, durationS };
}

// Appends the journal entry, then emits the helper's stdout JSON. Journal
// append happens before stdout is written, so an append failure (FR-096)
// never lets a healthy report reach the caller.
function finish(root, args, digest, outcome) {
  const entry = {
    ts: new Date().toISOString(),
    task: args.task,
    cycle_round: args.round === null || Number.isNaN(args.round) ? null : args.round,
    runtime: args.runtime,
    digest,
    outcome: outcome.status,
    reason: outcome.reason || null,
    duration_s: outcome.durationS === undefined ? null : outcome.durationS,
    runtime_exit: outcome.runtimeExit === undefined ? null : outcome.runtimeExit,
  };
  const appended = appendJournalLine(root, args.task, entry);
  if (!appended.ok) fail(2, `journal append failed: ${appended.error}`);

  const result = {
    status: outcome.status,
    reason: outcome.reason || null,
    config_digest: digest,
    findings: outcome.status === "healthy" ? outcome.findings : [],
    journal_line: appended.line,
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.runtime || !args.prompt) {
    fail(
      2,
      'usage: xruntime-review.js <codex|opencode> "<prompt>" --task <slug> ' +
        '[--round N] [--write] [--timeout S] [--human-retry] [--skip "<reason>"]'
    );
  }
  if (!validSlug(args.task)) fail(2, `--task slug invalid or missing (must match [a-z0-9-]+): ${args.task}`);

  const root = process.cwd();
  warnIfBriefsNotIgnored(root);

  const runtimeBin = process.env.XRUNTIME_BIN || args.runtime;
  const sandboxFlag = args.write ? "workspace-write" : "read-only";
  const { digest, versionProbeTimedOut } = computeDigest(args.runtime, runtimeBin, sandboxFlag);

  // --skip is journaled as an explicit human decision — distinguishable from
  // never-attempted (FR-098) — and never invokes the wrapper.
  if (args.skip) {
    return finish(root, args, digest, { status: "skipped-human", reason: args.skip, runtimeExit: null, durationS: 0 });
  }

  if (versionProbeTimedOut) {
    return finish(root, args, digest, {
      status: "degraded",
      reason: "version-probe-timeout",
      runtimeExit: null,
      durationS: null,
    });
  }

  const reviewJson = readReviewJson(root, args.task);
  if (shouldRefuseDegraded(reviewJson, args.runtime, digest, args.humanRetry)) {
    return finish(root, args, digest, {
      status: "skipped-degraded",
      reason: "runtime degraded this cycle with unchanged digest (D-2)",
      runtimeExit: null,
      durationS: 0,
    });
  }

  const outcome = runWrapper(args);
  return finish(root, args, digest, outcome);
}

module.exports = { parseArgs, runWrapper, finish, main };

if (require.main === module) {
  main(process.argv.slice(2));
}

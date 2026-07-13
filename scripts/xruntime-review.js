#!/usr/bin/env node
// scripts/xruntime-review.js — CommonJS.
//
// Cross-runtime (second-model) review helper (spec: specs/review-skill-slimming.md
// US-1, FR-086..098, Amendments D-2/D-3/D-8/D-9; specs/review-v2-corrections.md
// INV-4/6/7, Amendments E-5/E-8/E-10). Owns probe execution, health-state
// transitions, output validation, and the invocation journal in one
// deterministic script, so breaker compliance stops depending on prose
// discipline (roster-review.md §"Cross-Runtime Review").
//
// MUST NOT modify scripts/xruntime-exec.sh in any way (FR-086, byte-identical,
// preserving roster-qa co-consumption) — this script invokes it as a
// subprocess and captures stdout/stderr separately (D-3).
//
// Usage:
//   node scripts/xruntime-review.js <codex|opencode> --task <slug>
//     (--prompt-file <path> | reads the prompt from stdin)
//     [--round <n>] [--cycle <n>] [--write] [--timeout <sec>] [--human-retry]
//     [--skip "<reason>"]
//
// INV-6: the prompt is NEVER a positional CLI argument (removed, breaking —
// this script is the sole caller) — a large diff embedded positionally could
// exceed a shell/tool invocation's argv-length limit before the runtime even
// starts. `--prompt-file <path>` or stdin keep the invocation's own argv
// small regardless of prompt size; only the prompt's digest is ever
// journaled, never its content.
//
// stdout carries only the helper's own JSON result (FR-087):
//   { status, reason, config_digest, findings[], journal_line }
//   status: "healthy" | "degraded" | "skipped-degraded" | "skipped-human" | "blocked"
//   skipped-human results additionally carry {actor, round, ts} (E-10/INV-7).
//
// Exit: 0 = a classification was produced and journaled (any status above
//       except "blocked"); 2 = usage error, bad --task slug, journal-append
//       failure (never reports healthy in this case, FR-096), or a malformed
//       persisted verdict (E-8 — "blocked"/"malformed-verdict", fail closed:
//       unverifiable round state, same posture as the convergence gate's own
//       exit 2).
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { computeDigest } = require("./lib/xruntime-digest");
const { classify, isSpawnError } = require("./lib/xruntime-classify");
const {
  validSlug,
  warnIfBriefsNotIgnored,
  appendJournalLine,
  readReviewJson,
  readLatestJournalEntry,
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
    promptFile: null,
    task: null,
    round: null,
    cycle: null,
    write: false,
    timeout: 480,
    humanRetry: false,
    skip: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--task") out.task = argv[++i];
    else if (a === "--prompt-file") out.promptFile = argv[++i];
    else if (a === "--round") out.round = parseInt(argv[++i], 10);
    else if (a === "--cycle") out.cycle = parseInt(argv[++i], 10);
    else if (a === "--write") out.write = true;
    else if (a === "--timeout") out.timeout = parseInt(argv[++i], 10);
    else if (a === "--human-retry") out.humanRetry = true;
    else if (a === "--skip") out.skip = argv[++i];
    else positionals.push(a);
  }
  out.runtime = positionals[0] || null;
  return out;
}

// INV-6: reads the prompt from --prompt-file when given, else from stdin.
// Never a positional argument — this keeps the helper's own argv small
// regardless of diff size.
function readPrompt(promptFile) {
  if (promptFile) {
    if (!fs.existsSync(promptFile)) fail(2, `--prompt-file not found: ${promptFile}`);
    return fs.readFileSync(promptFile, "utf8");
  }
  try {
    return fs.readFileSync(0, "utf8");
  } catch (e) {
    return "";
  }
}

function promptDigest(prompt) {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 16);
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

  // INV-6: a spawn-layer failure never reaches output inspection — it is
  // never runtime "empty output", it's a distinct pre-runtime failure the
  // breaker must not blame on the model.
  if (isSpawnError(result)) {
    return {
      status: "degraded",
      reason: "spawn-error",
      findings: [],
      runtimeExit: null,
      durationS,
      spawnErrorCode: result.error.code,
    };
  }

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
  // FR-091: non-conforming-output carries an excerpt for human inspection —
  // thread it through to both the journal and the stdout result (below).
  return {
    status: "degraded",
    reason: classification.outcome,
    findings: [],
    runtimeExit: exitCode,
    durationS,
    excerpt: classification.excerpt,
  };
}

// Appends the journal entry, then emits the helper's stdout JSON. Journal
// append happens before stdout is written, so an append failure (FR-096)
// never lets a healthy report reach the caller.
function finish(root, args, digest, outcome) {
  const entry = {
    ts: new Date().toISOString(),
    task: args.task,
    cycle_round: args.round === null || Number.isNaN(args.round) ? null : args.round,
    cycle: args.cycle === null || Number.isNaN(args.cycle) ? null : args.cycle, // E-5
    runtime: args.runtime,
    digest,
    outcome: outcome.status,
    reason: outcome.reason || null,
    duration_s: outcome.durationS === undefined ? null : outcome.durationS,
    runtime_exit: outcome.runtimeExit === undefined ? null : outcome.runtimeExit,
  };
  // FR-091: excerpt is present only for non-conforming-output — never a key
  // with a null/undefined value cluttering every other journal line.
  if (outcome.excerpt !== undefined) entry.excerpt = outcome.excerpt;
  if (outcome.spawnErrorCode !== undefined) entry.spawn_error_code = outcome.spawnErrorCode;
  if (outcome.promptDigest !== undefined) entry.prompt_digest = outcome.promptDigest; // INV-6: digest only, never the prompt
  const appended = appendJournalLine(root, args.task, entry);
  if (!appended.ok) fail(2, `journal append failed: ${appended.error}`);

  const result = {
    status: outcome.status,
    reason: outcome.reason || null,
    config_digest: digest,
    findings: outcome.status === "healthy" ? outcome.findings : [],
    journal_line: appended.line,
  };
  if (outcome.excerpt !== undefined) result.excerpt = outcome.excerpt;
  // E-10/INV-7: the explicit human-skip decision carries the first-class
  // {reason, actor, digest, round, ts} shape the verdict schema accepts —
  // config_digest/reason/status are already above; add actor/round/ts here.
  if (outcome.status === "skipped-human") {
    result.actor = "human";
    result.round = args.round === null || Number.isNaN(args.round) ? null : args.round;
    result.ts = entry.ts;
  }
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

// E-8: a malformed persisted verdict is explicit degraded-input — reversed
// from the old malformed->null ("no state") rationale. Unverifiable round
// state fails closed, the same argument as the convergence gate's own
// exit 2. Journals a `blocked` entry (best-effort) then exits 2 — never 0,
// never healthy.
function finishBlocked(root, args, digest) {
  const entry = {
    ts: new Date().toISOString(),
    task: args.task,
    cycle_round: args.round === null || Number.isNaN(args.round) ? null : args.round,
    cycle: args.cycle === null || Number.isNaN(args.cycle) ? null : args.cycle,
    runtime: args.runtime,
    digest,
    outcome: "blocked",
    reason: "malformed-verdict",
  };
  const appended = appendJournalLine(root, args.task, entry);
  const result = {
    status: "blocked",
    reason: "malformed-verdict",
    config_digest: digest,
    findings: [],
    journal_line: appended.ok ? appended.line : null,
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(2);
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.runtime) {
    fail(
      2,
      "usage: xruntime-review.js <codex|opencode> --task <slug> (--prompt-file <path> | stdin) " +
        '[--round N] [--cycle N] [--write] [--timeout S] [--human-retry] [--skip "<reason>"]'
    );
  }
  if (!validSlug(args.task)) fail(2, `--task slug invalid or missing (must match [a-z0-9-]+): ${args.task}`);

  args.prompt = readPrompt(args.promptFile);
  if (!args.prompt) fail(2, "prompt is empty — pass --prompt-file <path> or pipe it via stdin");

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

  const reviewJsonResult = readReviewJson(root, args.task);
  if (reviewJsonResult.state === "malformed") {
    return finishBlocked(root, args, digest); // E-8: fail closed, never a silent no-state
  }

  const currentCycle = args.cycle === null || Number.isNaN(args.cycle) ? null : args.cycle;
  const journalEntry = readLatestJournalEntry(root, args.task, args.runtime, digest);
  if (
    shouldRefuseDegraded({
      reviewJson: reviewJsonResult.value,
      journalEntry,
      runtime: args.runtime,
      digest,
      humanRetry: args.humanRetry,
      currentCycle,
    })
  ) {
    return finish(root, args, digest, {
      status: "skipped-degraded",
      reason: "runtime degraded this cycle with unchanged digest (D-2/E-5)",
      runtimeExit: null,
      durationS: 0,
    });
  }

  const outcome = runWrapper(args);
  outcome.promptDigest = promptDigest(args.prompt);
  return finish(root, args, digest, outcome);
}

module.exports = { parseArgs, runWrapper, finish, main };

if (require.main === module) {
  main(process.argv.slice(2));
}

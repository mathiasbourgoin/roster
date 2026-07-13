// Tests for scripts/lib/review-lifecycle.js (spec: specs/review-v2-corrections.md
// INV-3, CHECK-2, Amendments E-5/E-6). Two layers:
//   1. Pure unit coverage of deriveRoundState()'s two-event lifecycle.
//   2. An end-to-end drive — NO-GO -> GO -> QA-return -> resumed review —
//      over real artifacts through the real helper (scripts/xruntime-review.js),
//      normalizer (scripts/review-normalize.js), and gate
//      (scripts/check-review-convergence.js) binaries, asserting fresh-cycle
//      behavior at the resumed boundary: round 1, a fresh probe, and gate
//      acceptance of a correctly-fresh draft vs. rejection of a
//      wrongly-continued one. XRUNTIME_BIN stubs the runtime and a short
//      timeout keeps this fast — no model runtime, no real version probes.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isFreshCycle, deriveRoundState } = require("./lib/review-lifecycle");
const { normalize } = require("./review-normalize");

const XRUNTIME_SCRIPT = path.resolve(__dirname, "xruntime-review.js");
const GATE_SCRIPT = path.resolve(__dirname, "check-review-convergence.js");

// ── 1. pure unit coverage ──────────────────────────────────────────────

test("absent prior -> fresh cycle: round 1, cycle 1, empty rounds_audit/cross_runtime", () => {
  const state = deriveRoundState(null);
  assert.strictEqual(state.freshCycle, true);
  assert.strictEqual(state.round, 1);
  assert.strictEqual(state.cycle, 1);
  assert.deepStrictEqual(state.roundsAudit, []);
  assert.deepStrictEqual(state.crossRuntime, {});
});

test("prior GO -> fresh cycle: round resets to 1, cycle increments, rounds_audit/cross_runtime reset (INV-3 event 2)", () => {
  const prior = { status: "GO", round: 4, cycle: 2, rounds_audit: [{ round: 4 }], cross_runtime: { codex: { status: "healthy" } } };
  const state = deriveRoundState(prior);
  assert.strictEqual(isFreshCycle(prior), true);
  assert.strictEqual(state.round, 1);
  assert.strictEqual(state.cycle, 3);
  assert.deepStrictEqual(state.roundsAudit, []);
  assert.deepStrictEqual(state.crossRuntime, {});
});

test("prior NO-GO with numeric round -> round + 1, cycle/rounds_audit/cross_runtime carried forward (same cycle)", () => {
  const prior = { status: "NO-GO", round: 2, cycle: 1, rounds_audit: [{ round: 2, strike: false }], cross_runtime: { codex: { status: "healthy" } } };
  const state = deriveRoundState(prior);
  assert.strictEqual(state.freshCycle, false);
  assert.strictEqual(state.round, 3);
  assert.strictEqual(state.cycle, 1);
  assert.deepStrictEqual(state.roundsAudit, prior.rounds_audit);
  assert.deepStrictEqual(state.crossRuntime, prior.cross_runtime);
});

test("prior NO-GO with round absent (legacy) -> stays legacy for this cycle", () => {
  const prior = { status: "NO-GO", rounds_audit: [{ round: 2 }] };
  const state = deriveRoundState(prior);
  assert.strictEqual(state.legacyRound, true);
  assert.strictEqual(state.round, null);
});

// ── 2. end-to-end drive: NO-GO -> GO -> QA-return -> resumed review ──────

const STUB_SOURCE = `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "stub-runtime 1.0.0"; exit 0; fi
touch invoked.marker
echo '\`\`\`json'
echo '[]'
echo '\`\`\`'
exit 0
`;

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-lifecycle-"));
  const run = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: dir, stdio: "pipe" }).toString();
  run("git init -q .");
  run("git config user.email t@t && git config user.name t && git config commit.gpgsign false");
  fs.writeFileSync(path.join(dir, ".gitignore"), "briefs/\ninvoked.marker\n");
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  run("git add -A && git commit -qm base");
  const stubPath = path.join(dir, "stub-runtime.sh");
  fs.writeFileSync(stubPath, STUB_SOURCE, { mode: 0o755 });
  return { dir, run, stubPath };
}

function writeReview(repo, obj) {
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  const p = path.join(repo.dir, "briefs", "demo-task-review.json");
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function runGate(repo, reviewPath, extraArgs = []) {
  const result = spawnSync("node", [GATE_SCRIPT, reviewPath, ...extraArgs], { cwd: repo.dir, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function runXruntimeHelper(repo, promptFile, extraArgs = []) {
  const result = spawnSync(
    "node",
    [XRUNTIME_SCRIPT, "codex", "--prompt-file", promptFile, "--task", "demo-task", "--timeout", "5", ...extraArgs],
    { cwd: repo.dir, encoding: "utf8", env: Object.assign({}, process.env, { XRUNTIME_BIN: repo.stubPath }) }
  );
  return { code: result.status, stdout: result.stdout || "" };
}

test("CHECK-2: NO-GO(round1) -> GO(round1) -> resumed review after QA return -> fresh cycle (round1, new probe, gate accepts fresh draft / rejects wrongly-continued one)", () => {
  const repo = makeRepo();
  const promptFile = path.join(repo.dir, "prompt.txt");
  fs.writeFileSync(promptFile, "diff + prior state");

  // Round 1: NO-GO with a HIGH finding, real gate run (static — no red/green needed for this drive).
  const round1 = writeReview(repo, {
    status: "NO-GO",
    round: 1,
    cycle: 1,
    findings: [{ severity: "HIGH", status: "OPEN", category: "correctness", fingerprint: "a.ml:1:correctness", first_seen_round: 1 }],
    rounds_audit: [{ round: 1, reviewed_sha: "a".repeat(40), fix_sha: "b".repeat(40), specialists_run: [{ name: "reviewer", selection_reason: "always runs" }] }],
  });
  const gate1 = runGate(repo, round1, ["--static"]);
  assert.strictEqual(gate1.code, 0, "round 1 findings have no linked check yet — no ratchet violation");

  // The cross-runtime probe runs healthy at round 1.
  const probe1 = runXruntimeHelper(repo, promptFile, ["--round", "1", "--cycle", "1"]);
  assert.strictEqual(JSON.parse(probe1.stdout).status, "healthy");
  assert.ok(fs.existsSync(path.join(repo.dir, "invoked.marker")));
  fs.rmSync(path.join(repo.dir, "invoked.marker"));

  // GO: the finding resolved same-round is fine; persist a GO verdict at round 1.
  const prior = JSON.parse(fs.readFileSync(round1, "utf8"));
  const goVerdict = Object.assign({}, prior, { status: "GO", findings: [] });
  fs.writeFileSync(round1, JSON.stringify(goVerdict));

  // Resumed review (simulating a QA NO-GO sending it back): derive the next
  // draft's state from the persisted GO verdict — INV-3 event 2, a fresh cycle.
  const resumedState = deriveRoundState(goVerdict);
  assert.strictEqual(resumedState.freshCycle, true);
  assert.strictEqual(resumedState.round, 1);
  assert.strictEqual(resumedState.cycle, 2);

  // The normalizer accepts a fresh round-1 draft (empty ledger, no dispositions).
  const normResult = normalize({ newFindings: [], ledger: [], round: resumedState.round });
  assert.deepStrictEqual(normResult.findings, []);

  // A fresh cycle re-probes — GO means the prior degraded/healthy state is stale.
  const probe2 = runXruntimeHelper(repo, promptFile, ["--round", String(resumedState.round), "--cycle", String(resumedState.cycle)]);
  assert.strictEqual(JSON.parse(probe2.stdout).status, "healthy");
  assert.ok(fs.existsSync(path.join(repo.dir, "invoked.marker")), "the fresh cycle must re-probe, never trust stale state");

  // Gate acceptance of the fresh round-1 draft (no rounds_audit entry required at round 1).
  const freshDraft = writeReview(repo, {
    status: "NO-GO",
    round: resumedState.round,
    cycle: resumedState.cycle,
    findings: [],
    rounds_audit: resumedState.roundsAudit,
  });
  const gateFresh = runGate(repo, freshDraft, ["--static"]);
  assert.strictEqual(gateFresh.code, 0, "the gate must accept a correctly-fresh round-1 draft");

  // Gate REJECTION of a wrongly-continued draft: claims round 2 (as if the
  // fresh-cycle reset never happened) but carries no rounds_audit entry for
  // round 2 — the loop-back-audit-completeness check must fire (exit 3).
  const wronglyContinued = writeReview(repo, {
    status: "NO-GO",
    round: 2,
    cycle: resumedState.cycle,
    findings: [],
    rounds_audit: [],
  });
  const gateWrong = runGate(repo, wronglyContinued, ["--static"]);
  assert.strictEqual(gateWrong.code, 3, "a round >= 2 claim with no rounds_audit entry must be rejected as process-incomplete");
});

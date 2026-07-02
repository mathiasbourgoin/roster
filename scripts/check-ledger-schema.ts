/**
 * Execute the durable-state LEDGER_SCHEMA jq predicate embedded in roster-run.md
 * against a 12-case fixture matrix, so predicate defects become CI failures instead
 * of silent resume bugs (the embedded predicate previously shipped two defects that
 * were invisible to `npm test` — pipeline-ledger-coherence friction entry).
 *
 * PARSED CONVENTION — the predicate is LLM-prose bash inside
 * skills/pipeline/roster-run.md Step 1.4, extracted with the SAME regex as
 * scripts/check-pipeline-install.js Check 4 (byte-identity with roster-doctor is
 * that checker's job, not ours): /LEDGER_SCHEMA='([\s\S]*?)'\n/  — sample:
 *
 *     LEDGER_SCHEMA='
 *       {express:["implement","review","ship"], ...
 *     '
 *
 * FIXTURE MATRIX (ledger JSON piped through `jq -e --arg t <task> "$LEDGER_SCHEMA"`):
 *   legal   → implement/PARTIAL with reason; implement/PARTIAL without reason;
 *             ship/BLOCKED with reason; ship/BLOCKED without reason;
 *             full-mode complete 9-phase history; PARTIAL-then-COMPLETED resume
 *   illegal → reason:false (non-string); earlier illegal event in history;
 *             non-object event entry; ship/PARTIAL; implement/BLOCKED; intake/PARTIAL
 *
 * Requires `jq` on PATH — HARD FAILURE (exit 1) if absent: jq is already a hard
 * dependency of init-harness.sh and sync-harness.sh, so any CI environment running
 * this suite must have it; a green skip would be a vacuous pass.
 * Flags: --report  → print findings but always exit 0 (debug mode).
 * Exit 0 = clean. Exit 1 = missing jq, or a fixture was mis-classified (fixture printed).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(__dirname, "../..");
const SOURCE = "skills/pipeline/roster-run.md";
const TASK = "fixture-task";

type Fixture = { name: string; legal: boolean; ledger: object };

const ev = (phase: string, outcome: string, reason?: unknown) =>
  reason === undefined ? { phase, outcome } : { phase, outcome, reason };

const ledger = (mode: string, currentPhase: string, events: unknown[]) => ({
  task: TASK,
  mode,
  current_phase: currentPhase,
  events,
});

const FIXTURES: Fixture[] = [
  // ── legal ──
  { name: "implement/PARTIAL with reason", legal: true,
    ledger: ledger("fast", "implement", [ev("implement", "PARTIAL", "tests still red")]) },
  { name: "implement/PARTIAL without reason", legal: true,
    ledger: ledger("fast", "implement", [ev("implement", "PARTIAL")]) },
  { name: "ship/BLOCKED with reason", legal: true,
    ledger: ledger("fast", "ship", [ev("implement", "COMPLETED"), ev("review", "GO"), ev("qa", "GO"), ev("ship", "BLOCKED", "CI red")]) },
  { name: "ship/BLOCKED without reason", legal: true,
    ledger: ledger("fast", "ship", [ev("implement", "COMPLETED"), ev("review", "GO"), ev("qa", "GO"), ev("ship", "BLOCKED")]) },
  { name: "full-mode complete history", legal: true,
    ledger: ledger("full", "ship", [
      ev("question", "COMPLETED"), ev("research", "COMPLETED"), ev("intake", "VALIDATED"),
      ev("spec", "VALIDATED"), ev("plan", "COMPLETED"), ev("implement", "COMPLETED"),
      ev("review", "GO"), ev("qa", "GO"), ev("ship", "COMPLETED"),
    ]) },
  { name: "PARTIAL-then-COMPLETED resume", legal: true,
    ledger: ledger("fast", "implement", [ev("implement", "PARTIAL", "ran out of budget"), ev("implement", "COMPLETED")]) },
  // ── illegal ──
  { name: "reason:false (non-string reason)", legal: false,
    ledger: ledger("fast", "implement", [ev("implement", "PARTIAL", false)]) },
  { name: "earlier illegal event in history", legal: false,
    ledger: ledger("full", "implement", [ev("intake", "PARTIAL"), ev("implement", "COMPLETED")]) },
  { name: "non-object event entry", legal: false,
    ledger: ledger("fast", "implement", ["implement done"]) },
  { name: "ship/PARTIAL", legal: false,
    ledger: ledger("fast", "ship", [ev("ship", "PARTIAL")]) },
  { name: "implement/BLOCKED", legal: false,
    ledger: ledger("fast", "implement", [ev("implement", "BLOCKED")]) },
  { name: "intake/PARTIAL", legal: false,
    ledger: ledger("full", "intake", [ev("intake", "PARTIAL")]) },
];

function extractSchema(): string | null {
  // Same extraction as scripts/check-pipeline-install.js:149 (Check 4).
  const m = fs.readFileSync(path.join(REPO_ROOT, SOURCE), "utf-8").match(/LEDGER_SCHEMA='([\s\S]*?)'\n/);
  return m ? m[1] : null;
}

function main(): void {
  const reportOnly = process.argv.includes("--report");
  const errors: string[] = [];

  if (spawnSync("jq", ["--version"], { encoding: "utf-8" }).status !== 0) {
    console.error(
      "✗ ledger-schema: jq not found on PATH — jq is a hard dependency of init-harness.sh and sync-harness.sh, so a jq-less environment cannot run roster anyway; a green skip here would be a vacuous pass. Install jq."
    );
    process.exit(reportOnly ? 0 : 1);
  }

  const schema = extractSchema();
  if (schema === null) {
    console.error(`✗ ledger-schema: LEDGER_SCHEMA='...' block not found in ${SOURCE}`);
    process.exit(reportOnly ? 0 : 1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-schema-"));
  try {
    for (const fixture of FIXTURES) {
      const file = path.join(tmp, "ledger.json");
      fs.writeFileSync(file, JSON.stringify(fixture.ledger));
      const run = spawnSync("jq", ["-e", "--arg", "t", TASK, schema, file], { encoding: "utf-8" });
      const accepted = run.status === 0;
      if (accepted !== fixture.legal) {
        errors.push(
          `predicate ${fixture.legal ? "REJECTED a legal" : "ACCEPTED an illegal"} ledger — case "${fixture.name}": ${JSON.stringify(fixture.ledger)}`
        );
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (errors.length === 0) {
    console.log(`✓ ledger-schema: the roster-run LEDGER_SCHEMA predicate classifies all ${FIXTURES.length} fixtures correctly`);
    process.exit(0);
  }
  console.error(`\nledger-schema violations (${errors.length}):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\n${errors.length} violation(s) found.`);
  process.exit(reportOnly ? 0 : 1);
}

main();

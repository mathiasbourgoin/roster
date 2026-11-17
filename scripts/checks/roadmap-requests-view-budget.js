"use strict";
// Ratchet check for review finding "scripts/roster-roadmap-requests-view.cjs:51:correctness"
// (roadmap-operator-requests, round 1): writes that pass every request limit must never make
// `view` fail. Exit 0 = holds, 1 = assertion fired, 2 = setup error.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function setup() {
  const core = require(path.join(__dirname, "..", "roster-roadmap.cjs"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roadmap-budget-check-"));
  const board = path.join(root, "board");
  core.main(["init", board, "--id", "demo"]);
  const task = { id: "a", intake: "briefs/a.md", objective: "Deliver a", depends_on: [], inputs: [], outputs: [], allowed_files: ["src/a.js"],
    dod: ["Checks pass"], success: ["Observable"], checks: [{ id: "test", description: "Run test" }],
    topology: { runtime: "codex", model: "configured", role: "implementer", persona: "Engineer", route: "sequential", fallbacks: [] },
    policy: { max_attempts: 2, on_failure: "retry", stop_if: ["Scope changed"], recovery: ["Diagnose"], failure: "Budget exhausted" },
    workflow: { recommendation: "none", reason: "Bounded", steps: [] } };
  const contract = { schema_version: 1, id: "demo", goal: "Demo", success: ["Works"], global_checks: [{ id: "global", description: "Works" }], execution: { max_active: 1 }, tasks: [task] };
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  write(path.join(board, "roadmap.json"), contract);
  write(path.join(board, "capabilities.json"), { schema_version: 1, runtimes: { codex: { available: true, evidence: ["Observed"], capabilities: {} } } });
  write(path.join(root, "decision.json"), { by: "owner", basis: "Disposable check", contract_digest: core.hash(contract) });
  core.main(["accept", board, "--coordinator", "lead", "--revision", "0", "--decision", path.join(root, "decision.json")]);
  return { core, root, board, write };
}

let ctx;
try { ctx = setup(); } catch (error) { console.error(`setup error: ${error.message}`); process.exit(2); }
const { core, root, board, write } = ctx;
const cjk = n => "漢".repeat(n);
try {
  for (let i = 0; i < 100; i++) {
    const file = path.join(root, `r${i}.json`);
    write(file, { id: `big${i}`, to: { kind: "role", label: cjk(200) }, kind: "supply", text: cjk(2000), need: "blocking", refs: Array(10).fill(cjk(500)) });
    try { core.main(["request-open", board, "--coordinator", "lead", "--revision", String(i), "--request", file]); } catch { break; }
  }
  const view = core.main(["view", board]);
  if (view.operator_requests.status !== "valid") throw new Error(`unexpected annex status ${view.operator_requests.status}`);
  core.main(["status", board, "--format", "text"]);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(0);
} catch (error) {
  console.error(`assertion fired: ${error.message}`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

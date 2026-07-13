// Tests for scripts/xruntime-review.js (spec: specs/review-skill-slimming.md US-1,
// FR-086..098, Amendments D-2/D-3/D-8/D-9). Uses a bash stub runtime (XRUNTIME_BIN,
// matching xruntime-exec.sh's own testing hook) so scenarios are deterministic without
// a real codex/opencode CLI on PATH.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { computeDigest } = require("./lib/xruntime-digest");

const SCRIPT = path.resolve(__dirname, "xruntime-review.js");

const STUB_SOURCE = `#!/usr/bin/env bash
mode="\${STUB_MODE:-healthy}"
if [ "$1" = "--version" ]; then
  if [ "$mode" = "hang-version" ]; then sleep 30; fi
  echo "stub-runtime 1.0.0"
  exit 0
fi
touch invoked.marker
case "$mode" in
  healthy)
    echo '\`\`\`json'
    echo '[]'
    echo '\`\`\`'
    ;;
  banner)
    echo "Welcome to stub-runtime!"
    echo '\`\`\`json'
    echo '[{"severity":"HIGH","confidence":4,"path":"a.ml","line":1,"category":"correctness","summary":"s","evidence":"e","fix":"f","fingerprint":"a.ml:1:correctness","specialist":"codex-xruntime"}]'
    echo '\`\`\`'
    ;;
  empty)
    : ;;
  non-conforming)
    echo "I refuse to comply." ;;
  tree-mutate)
    date > mutated.txt
    echo "done" ;;
  hang-run)
    sleep 30 ;;
esac
exit 0
`;

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xruntime-review-"));
  const run = (cmd) => execFileSync("bash", ["-c", cmd], { cwd: dir, stdio: "pipe" }).toString();
  run("git init -q .");
  run("git config user.email t@t && git config user.name t && git config commit.gpgsign false");
  fs.writeFileSync(path.join(dir, ".gitignore"), "briefs/\ninvoked.marker\n");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git add -A && git commit -qm base");
  const stubPath = path.join(dir, "stub-runtime.sh");
  fs.writeFileSync(stubPath, STUB_SOURCE, { mode: 0o755 });
  return { dir, run, stubPath };
}

function runHelper(repo, args, env) {
  const result = spawnSync("node", [SCRIPT, ...args], {
    cwd: repo.dir,
    encoding: "utf8",
    env: Object.assign({}, process.env, { XRUNTIME_BIN: repo.stubPath }, env || {}),
  });
  return { code: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function readJournal(repo, task) {
  const p = path.join(repo.dir, "briefs", `${task}-xruntime.jsonl`);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test("healthy runtime: stdout carries only helper JSON, journal gets one line", () => {
  const repo = makeRepo();
  const { code, stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  assert.strictEqual(code, 0);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "healthy");
  assert.deepStrictEqual(parsed.findings, []);
  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(journal.length, 1);
  assert.strictEqual(journal[0].outcome, "healthy");
});

test("EC-5: banner + fenced valid JSON -> healthy (banner tolerated)", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "banner" });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "healthy");
  assert.strictEqual(parsed.findings.length, 1);
});

test("empty output classifies degraded empty-output", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "empty" });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "degraded");
  assert.strictEqual(parsed.reason, "empty-output");
});

test("non-conforming output classifies degraded non-conforming-output", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "non-conforming" });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "degraded");
  assert.strictEqual(parsed.reason, "non-conforming-output");
});

test("tree mutation (corroborated exit 3 + TREE-MUTATED marker) classifies degraded tree-mutation", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--timeout", "10"], {
    STUB_MODE: "tree-mutate",
  });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "degraded");
  assert.strictEqual(parsed.reason, "tree-mutation");
});

test("wrapper timeout (corroborated exit 124) classifies degraded timeout", { timeout: 20000 }, () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--timeout", "2"], {
    STUB_MODE: "hang-run",
  });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "degraded");
  assert.strictEqual(parsed.reason, "timeout");
});

test("version-probe hang -> degraded version-probe-timeout with placeholder digest (FR-094), wrapper never invoked", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(
    repo,
    ["codex", "hello", "--task", "demo-task"],
    { STUB_MODE: "hang-version", XRUNTIME_VERSION_PROBE_TIMEOUT_MS: "500" }
  );
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "degraded");
  assert.strictEqual(parsed.reason, "version-probe-timeout");
  assert.strictEqual(parsed.config_digest, "codex:version-unavailable");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")), "wrapper must not run on a version-probe hang");
});

test("D-2: NO-GO + degraded + unchanged digest -> skipped-degraded, wrapper never invoked", () => {
  const repo = makeRepo();
  const { digest } = computeDigest("codex", repo.stubPath, "read-only");
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, "briefs", "demo-task-review.json"),
    JSON.stringify({ status: "NO-GO", cross_runtime: { codex: { status: "degraded", config_digest: digest } } })
  );
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "skipped-degraded");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")), "wrapper must not run when refused");
});

test("D-2: persisted GO status means fresh cycle — degraded state is stale, helper re-probes", () => {
  const repo = makeRepo();
  const { digest } = computeDigest("codex", repo.stubPath, "read-only");
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, "briefs", "demo-task-review.json"),
    JSON.stringify({ status: "GO", cross_runtime: { codex: { status: "degraded", config_digest: digest } } })
  );
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "healthy");
  assert.ok(fs.existsSync(path.join(repo.dir, "invoked.marker")), "a fresh cycle must re-probe");
});

test("D-2: --human-retry bypasses the refusal even with matching digest + NO-GO", () => {
  const repo = makeRepo();
  const { digest } = computeDigest("codex", repo.stubPath, "read-only");
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, "briefs", "demo-task-review.json"),
    JSON.stringify({ status: "NO-GO", cross_runtime: { codex: { status: "degraded", config_digest: digest } } })
  );
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--human-retry"], {
    STUB_MODE: "healthy",
  });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "healthy");
});

test("FR-098: --skip journals an explicit human-skip entry, wrapper never invoked", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--skip", "human decided to skip"], {
    STUB_MODE: "healthy",
  });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "skipped-human");
  assert.strictEqual(parsed.reason, "human decided to skip");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")));
  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(journal[0].outcome, "skipped-human");
});

test("FR-096: task slug with '/' -> exit 2, never healthy, no journal written", () => {
  const repo = makeRepo();
  const { code, stderr } = runHelper(repo, ["codex", "hello", "--task", "bad/slug"], { STUB_MODE: "healthy" });
  assert.strictEqual(code, 2);
  assert.match(stderr, /invalid or missing/);
  assert.strictEqual(readJournal(repo, "bad/slug").length, 0);
});

test("EC-2: two sequential probes for the same task accumulate two journal lines", () => {
  const repo = makeRepo();
  runHelper(repo, ["codex", "hello", "--task", "demo-task", "--round", "1"], { STUB_MODE: "healthy" });
  runHelper(repo, ["codex", "hello", "--task", "demo-task", "--round", "2"], { STUB_MODE: "healthy" });
  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(journal.length, 2);
  assert.strictEqual(journal[0].cycle_round, 1);
  assert.strictEqual(journal[1].cycle_round, 2);
});

test("D-9: --round absent -> journal cycle_round null (helper never derives it)", () => {
  const repo = makeRepo();
  runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(journal[0].cycle_round, null);
});

test("digest excludes the review timeout: two different --timeout values, same digest", () => {
  const repo = makeRepo();
  const first = JSON.parse(runHelper(repo, ["codex", "hello", "--task", "t1", "--timeout", "60"], { STUB_MODE: "healthy" }).stdout);
  const second = JSON.parse(runHelper(repo, ["codex", "hello", "--task", "t2", "--timeout", "300"], { STUB_MODE: "healthy" }).stdout);
  assert.strictEqual(first.config_digest, second.config_digest);
});

test("D-8: warns on stderr when briefs/ is not git-ignored", () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, ".gitignore"), ""); // no briefs/ ignore rule
  const { stderr } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  assert.match(stderr, /not git-ignored/);
});

test("usage error: missing prompt -> exit 2", () => {
  const repo = makeRepo();
  const { code } = runHelper(repo, ["codex"], {});
  assert.strictEqual(code, 2);
});

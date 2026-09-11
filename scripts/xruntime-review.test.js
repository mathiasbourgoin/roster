// Tests for scripts/xruntime-review.js (spec: specs/review-skill-slimming.md US-1,
// FR-086..098, Amendments D-2/D-3/D-8/D-9; specs/review-v2-corrections.md
// INV-4/6/7/9, Amendments E-5/E-8/E-10/E-13). Uses a bash stub runtime (XRUNTIME_BIN,
// matching xruntime-exec.sh's own testing hook) so scenarios are deterministic without
// a real codex/opencode CLI on PATH.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { computeDigest } = require("./lib/xruntime/xruntime-digest");
const { isSpawnError } = require("./lib/xruntime/xruntime-classify");

const SCRIPT = path.resolve(__dirname, "xruntime-review.js");
const WRAPPER = path.resolve(__dirname, "xruntime-exec.sh");

const STUB_SOURCE = `#!/usr/bin/env bash
mode="\${STUB_MODE:-healthy}"
if [ "$1" = "--version" ]; then
  if [ "$mode" = "hang-version" ]; then sleep 30; fi
  echo "stub-runtime 1.0.0"
  exit 0
fi
touch invoked.marker
printf '%s\\n' "$@" > invoked-args.txt
cat > received-prompt.txt
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
  banner-non-conforming)
    echo "Welcome to stub-runtime!"
    echo "I am unable to comply with this request." ;;
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
  fs.writeFileSync(path.join(dir, ".gitignore"), "briefs/\ninvoked.marker\ninvoked-args.txt\nreceived-prompt.txt\n");
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  run("git add -A && git commit -qm base");
  const stubPath = path.join(dir, "stub-runtime.sh");
  fs.writeFileSync(stubPath, STUB_SOURCE, { mode: 0o755 });
  return { dir, run, stubPath };
}

// INV-6: the prompt is never positional — this harness writes it to a scratch
// file and passes --prompt-file so existing call sites (`["codex", "hello",
// "--task", ...]`) keep reading naturally as "runtime, prompt-text, ...".
function runHelper(repo, args, env) {
  const runtime = args[0];
  const promptText = args[1];
  const rest = args.slice(2);
  const promptFile = path.join(repo.dir, `prompt-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(promptFile, promptText === undefined ? "" : promptText);
  const finalArgs = [runtime, "--prompt-file", promptFile, ...rest];
  const result = spawnSync("node", [SCRIPT, ...finalArgs], {
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
  assert.ok(!("excerpt" in parsed), "a healthy result must not carry an excerpt key");
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

test("FR-091: a banner-only (non-conforming) run carries the excerpt in both stdout and the journal", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], {
    STUB_MODE: "banner-non-conforming",
  });
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "degraded");
  assert.strictEqual(parsed.reason, "non-conforming-output");
  assert.ok(typeof parsed.excerpt === "string" && parsed.excerpt.includes("Welcome to stub-runtime!"));

  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(journal.length, 1);
  assert.ok(typeof journal[0].excerpt === "string" && journal[0].excerpt.includes("Welcome to stub-runtime!"));
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

test("QA breaker sharing: availability check reuses matching degraded state from review GO", () => {
  const repo = makeRepo();
  const { digest } = computeDigest("codex", repo.stubPath, "read-only");
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, "briefs", "demo-task-review.json"),
    JSON.stringify({ status: "GO", cross_runtime: { codex: { status: "degraded", config_digest: digest } } })
  );

  const { code, stdout } = runHelper(
    repo,
    ["codex", "", "--task", "demo-task", "--phase", "qa", "--check-availability", "--write"],
    { STUB_MODE: "healthy" }
  );
  const parsed = JSON.parse(stdout);
  assert.strictEqual(code, 0);
  assert.strictEqual(parsed.status, "skipped-degraded");
  assert.strictEqual(parsed.source, "review-go");
  assert.notStrictEqual(parsed.config_digest, digest, "QA may use workspace-write while review used read-only");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")), "availability check must never invoke the runtime");
  assert.strictEqual(readJournal(repo, "demo-task").length, 0, "a state lookup is not a provider invocation");
});

test("QA breaker sharing: availability check permits a changed runtime configuration", () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(
    path.join(repo.dir, "briefs", "demo-task-review.json"),
    JSON.stringify({
      status: "GO",
      cross_runtime: { codex: { status: "degraded", config_digest: "codex:stale-configuration" } },
    })
  );

  const { code, stdout } = runHelper(
    repo,
    ["codex", "", "--task", "demo-task", "--phase", "qa", "--check-availability", "--write"],
    { STUB_MODE: "healthy" }
  );
  const parsed = JSON.parse(stdout);
  assert.strictEqual(code, 0);
  assert.strictEqual(parsed.status, "available");
  assert.strictEqual(parsed.source, "review-go");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")), "availability check must remain provider-free");
});

test("QA breaker sharing: a non-object GO handoff fails closed instead of throwing", () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, "briefs", "demo-task-review.json"), "null");

  const { code, stderr } = runHelper(
    repo,
    ["codex", "", "--task", "demo-task", "--phase", "qa", "--check-availability", "--write"],
    { STUB_MODE: "healthy" }
  );
  assert.strictEqual(code, 2);
  assert.match(stderr, /requires a persisted GO review verdict/);
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")));
});

test("QA breaker sharing: roster-qa checks availability before invoking the raw wrapper", () => {
  const qaSkill = fs.readFileSync(path.resolve(__dirname, "../skills/pipeline/roster-qa.md"), "utf8");
  const check = qaSkill.indexOf("--phase qa --check-availability");
  const invoke = qaSkill.indexOf("bash scripts/xruntime-exec.sh <runtime> --prompt-file=<scratch-file> --write");
  assert.ok(check >= 0, "roster-qa must call the shared availability checker");
  assert.ok(invoke > check, "the provider invocation must occur only after the breaker check");
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

test("E-10/INV-7: --skip result carries the first-class {actor, round, ts} shape", () => {
  const repo = makeRepo();
  const { stdout } = runHelper(
    repo,
    ["codex", "hello", "--task", "demo-task", "--round", "2", "--skip", "human decided to skip"],
    { STUB_MODE: "healthy" }
  );
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.actor, "human");
  assert.strictEqual(parsed.round, 2);
  assert.strictEqual(typeof parsed.ts, "string");
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

test("usage error: missing runtime -> exit 2", () => {
  const repo = makeRepo();
  const result = spawnSync("node", [SCRIPT], { cwd: repo.dir, encoding: "utf8" });
  assert.strictEqual(result.status, 2);
});

// ── INV-6: transport (prompt-file/stdin, never positional) ──────────────

for (const runtime of ["codex", "opencode"]) {
  test(`INV-6: ${runtime} receives a prompt above ARG_MAX without a large argv element`, () => {
    const repo = makeRepo();
    const bigPrompt = "x".repeat(3 * 1024 * 1024);
    const { stdout } = runHelper(repo, [runtime, bigPrompt, "--task", "demo-task"], { STUB_MODE: "healthy" });
    const parsed = JSON.parse(stdout);
    assert.strictEqual(parsed.status, "healthy");
    const runtimeArgs = fs.readFileSync(path.join(repo.dir, "invoked-args.txt"), "utf8").split("\n");
    assert.ok(runtimeArgs.every((arg) => arg.length < 4096), "runtime argv must contain only bounded control arguments");
    assert.strictEqual(fs.readFileSync(path.join(repo.dir, "received-prompt.txt"), "utf8").length, bigPrompt.length);
  });
}

test("INV-6: stdin transport works when --prompt-file is omitted", () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  const result = spawnSync("node", [SCRIPT, "codex", "--task", "demo-task"], {
    cwd: repo.dir,
    input: "the diff and prior state",
    encoding: "utf8",
    env: Object.assign({}, process.env, { XRUNTIME_BIN: repo.stubPath, STUB_MODE: "healthy" }),
  });
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.status, "healthy");
});

test("wrapper compatibility: an option-shaped legacy positional prompt remains a prompt", () => {
  const repo = makeRepo();
  const result = spawnSync("bash", [WRAPPER, "codex", "--write", "--timeout", "2"], {
    cwd: repo.dir,
    encoding: "utf8",
    env: Object.assign({}, process.env, { XRUNTIME_BIN: repo.stubPath, STUB_MODE: "healthy" }),
  });
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /```json/);
});

test("wrapper compatibility: the literal legacy prompt --prompt-file remains a prompt", () => {
  const repo = makeRepo();
  const result = spawnSync("bash", [WRAPPER, "codex", "--prompt-file", "--timeout", "2"], {
    cwd: repo.dir,
    encoding: "utf8",
    env: Object.assign({}, process.env, { XRUNTIME_BIN: repo.stubPath, STUB_MODE: "healthy" }),
  });
  assert.strictEqual(result.status, 0);
  assert.match(result.stdout, /```json/);
});

test("wrapper removes owned output files on success, timeout, tree mutation, and unknown runtime", () => {
  for (const scenario of [
    { runtime: "codex", mode: "healthy", timeout: "2", status: 0 },
    { runtime: "codex", mode: "hang-run", timeout: "1", status: 124 },
    { runtime: "codex", mode: "tree-mutate", timeout: "2", status: 3 },
    { runtime: "unknown", mode: "healthy", timeout: "2", status: 2 },
  ]) {
    const repo = makeRepo();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "xruntime-out-"));
    const result = spawnSync("bash", [WRAPPER, scenario.runtime, "prompt", "--timeout", scenario.timeout], {
      cwd: repo.dir,
      encoding: "utf8",
      env: Object.assign({}, process.env, { TMPDIR: tmp, XRUNTIME_BIN: repo.stubPath, STUB_MODE: scenario.mode }),
    });
    assert.strictEqual(result.status, scenario.status, `${scenario.runtime}/${scenario.mode}`);
    assert.deepStrictEqual(fs.readdirSync(tmp), [], `${scenario.runtime}/${scenario.mode} leaked wrapper-owned output`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runWrapper removes its private prompt directory when prompt writing fails", () => {
  const controlledDir = fs.mkdtempSync(path.join(os.tmpdir(), "xruntime-write-fail-"));
  const originalMkdtempSync = fs.mkdtempSync;
  const originalWriteFileSync = fs.writeFileSync;
  fs.mkdtempSync = () => controlledDir;
  fs.writeFileSync = () => {
    throw new Error("injected prompt write failure");
  };
  try {
    assert.throws(
      () => require("./xruntime-review").runWrapper({ runtime: "codex", prompt: "secret", write: false, timeout: 1 }),
      /injected prompt write failure/
    );
  } finally {
    fs.mkdtempSync = originalMkdtempSync;
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.strictEqual(fs.existsSync(controlledDir), false);
});

test("INV-6: journal records the prompt digest, never the prompt content", () => {
  const repo = makeRepo();
  runHelper(repo, ["codex", "a secret diff nobody should see verbatim", "--task", "demo-task"], { STUB_MODE: "healthy" });
  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(typeof journal[0].prompt_digest, "string");
  const raw = fs.readFileSync(path.join(repo.dir, "briefs", "demo-task-xruntime.jsonl"), "utf8");
  assert.ok(!raw.includes("a secret diff"), "the journal must never contain the prompt text");
});

test("INV-6: empty prompt (no --prompt-file, empty stdin) -> exit 2", () => {
  const repo = makeRepo();
  const result = spawnSync("node", [SCRIPT, "codex", "--task", "demo-task"], {
    cwd: repo.dir,
    input: "",
    encoding: "utf8",
    env: Object.assign({}, process.env, { XRUNTIME_BIN: repo.stubPath }),
  });
  assert.strictEqual(result.status, 2);
});

// ── INV-6: spawn-error classification (never conflated with empty-output) ─

test("INV-6: isSpawnError classifies a spawn-layer failure (E2BIG/ENOENT), excludes ETIMEDOUT", () => {
  assert.strictEqual(isSpawnError({ error: { code: "E2BIG" } }), true);
  assert.strictEqual(isSpawnError({ error: { code: "ENOENT" } }), true);
  assert.strictEqual(isSpawnError({ error: { code: "ETIMEDOUT" } }), false, "ETIMEDOUT is the wrapper timeout path, not spawn-error");
  assert.strictEqual(isSpawnError({}), false);
  assert.strictEqual(isSpawnError({ status: 0 }), false);
});

// ── E-8: malformed persisted verdict fails closed ─────────────────────────

test("E-8: a malformed briefs/<task>-review.json -> status blocked, reason malformed-verdict, exit 2", () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, "briefs", "demo-task-review.json"), "{not valid json");
  const { code, stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  assert.strictEqual(code, 2);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "blocked");
  assert.strictEqual(parsed.reason, "malformed-verdict");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")), "the wrapper must never run against unverifiable state");
});

test("E-8: an absent review.json is NOT malformed — a fresh task still probes normally", () => {
  const repo = makeRepo();
  const { code, stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  assert.strictEqual(code, 0);
  assert.strictEqual(JSON.parse(stdout).status, "healthy");
});

test("breaker journal: a malformed line fails closed instead of permitting a provider retry", () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, "briefs"), { recursive: true });
  fs.writeFileSync(path.join(repo.dir, "briefs", "demo-task-xruntime.jsonl"), "{not-json\n");

  const { code, stdout } = runHelper(repo, ["codex", "hello", "--task", "demo-task"], {
    STUB_MODE: "healthy",
  });
  assert.strictEqual(code, 2);
  const parsed = JSON.parse(stdout);
  assert.strictEqual(parsed.status, "blocked");
  assert.strictEqual(parsed.reason, "malformed-journal");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")));

  const second = runHelper(repo, ["codex", "hello", "--task", "demo-task"], { STUB_MODE: "healthy" });
  assert.strictEqual(second.code, 2);
  assert.strictEqual(JSON.parse(second.stdout).reason, "malformed-journal");
  assert.ok(!fs.existsSync(path.join(repo.dir, "invoked.marker")), "a blocked audit row must retain the refusal");
});

// ── INV-4/E-5: journal-driven refusal for crash-before-persist ───────────

test("INV-4/E-5: crash-before-persist — no review.json was ever written, but the journal shows THIS cycle degraded -> refuse re-probe", () => {
  const repo = makeRepo();
  // First invocation: degrades, journals it under cycle 1, but (simulating a
  // crash) no review.json is ever persisted afterward.
  const first = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--cycle", "1"], { STUB_MODE: "empty" });
  assert.strictEqual(JSON.parse(first.stdout).status, "degraded");
  assert.ok(!fs.existsSync(path.join(repo.dir, "briefs", "demo-task-review.json")), "simulated crash-before-persist");

  const second = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--cycle", "1"], { STUB_MODE: "healthy" });
  const parsed = JSON.parse(second.stdout);
  assert.strictEqual(parsed.status, "skipped-degraded");
  const journal = readJournal(repo, "demo-task");
  assert.strictEqual(journal.length, 2, "the refusal itself is journaled too, not a silent no-op");
});

test("INV-4/E-5: a PRIOR cycle's degraded journal entry is stale — a new cycle re-probes", () => {
  const repo = makeRepo();
  runHelper(repo, ["codex", "hello", "--task", "demo-task", "--cycle", "1"], { STUB_MODE: "empty" });
  const second = runHelper(repo, ["codex", "hello", "--task", "demo-task", "--cycle", "2"], { STUB_MODE: "healthy" });
  const parsed = JSON.parse(second.stdout);
  assert.strictEqual(parsed.status, "healthy", "a fresh cycle must re-probe even if the prior cycle degraded");
});

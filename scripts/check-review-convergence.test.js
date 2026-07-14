// Tests for scripts/check-review-convergence.js (spec: specs/pipeline-loop-convergence.md)
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, 'check-review-convergence.js');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-convergence-'));
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' }).toString();
  run('git init -q .');
  run('git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  run('git add -A && git commit -qm base');
  const base = run('git rev-parse HEAD').trim();
  return { dir, run, base };
}

// Commits a check file at its current content and returns the resulting sha.
function commitFile(repo, relPath, content) {
  const abs = path.join(repo.dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  repo.run(`git add -A && git commit -qm "commit ${relPath}"`);
  return repo.run('git rev-parse HEAD').trim();
}

function writeReview(repo, obj, name = 'review.json') {
  const p = path.join(repo.dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

function gate(repo, reviewPath, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [SCRIPT, reviewPath, ...extraArgs], {
      cwd: repo.dir,
      stdio: 'pipe',
    }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

// A self-contained node script honoring the red-command exit convention
// (A-6): 0 = pass, 1 = assertion fired, >=2 = error. Reads a marker file to
// decide its behavior — content "buggy" -> exit 1 (red), else exit 0 (green).
const CHECK_SRC = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const marker = path.resolve(__dirname, '..', 'marker.txt');",
  "let content = '';",
  "try { content = fs.readFileSync(marker, 'utf8').trim(); } catch (e) {}",
  "if (content === 'buggy') { process.exit(1); } else { process.exit(0); }",
].join('\n');

const VACUOUS_CHECK_SRC = 'process.exit(0);\n';

test('absent review.json -> exit 2', () => {
  const repo = makeRepo();
  const r = gate(repo, path.join(repo.dir, 'nope.json'));
  assert.strictEqual(r.code, 2);
});

test('malformed JSON -> exit 2', () => {
  const repo = makeRepo();
  const p = path.join(repo.dir, 'review.json');
  fs.writeFileSync(p, '{ not valid json');
  const r = gate(repo, p);
  assert.strictEqual(r.code, 2);
});

test('legacy review.json (no no_go_round key) -> round 0 + warning, exit 0', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { task: 't', status: 'NO-GO', findings: [] });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.legacy_no_go_round, true);
  assert.strictEqual(report.no_go_round, 0);
  assert.ok(report.warnings.some((w) => /legacy/i.test(w)));
});

test('cap hit (no_go_round >= max-rounds) -> exit 1 with round-cap violation', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { no_go_round: 5, findings: [] });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'round-cap'));
});

test('cap respects --max-rounds override', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { no_go_round: 2, findings: [] });
  const r = gate(repo, p, ['--max-rounds', '2']);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.max_rounds, 2);
  assert.ok(report.violations.some((v) => v.type === 'round-cap'));
});

test('RESOLVED-without-check (HIGH, loop-back round, null check) -> exit 1', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: null,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'resolved-without-check'));
});

test('RESOLVED-without-check exempt: same-round raise+resolve', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 0,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 1,
        check: null,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
});

test('RESOLVED-without-check exempt: ACCEPTED finding', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'ACCEPTED',
        first_seen_round: 1,
        resolved_round: 2,
        check: null,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
});

test('RESOLVED finding with missing round provenance -> violation (does not silently escape the ratchet)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        // first_seen_round absent entirely, resolved_round non-numeric — neither
        // the ratchet obligation nor the same-round exemption can be evaluated.
        resolved_round: 'two',
        check: null,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'missing-round-provenance'));
});

test('unencodable finding not ACCEPTED -> design-not-converging violation report', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'OPEN',
        check_encodable: false,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  const v = report.violations.find((v) => v.type === 'unencodable-finding');
  assert.ok(v);
  assert.strictEqual(v.cause, 'unencodable-finding');
});

test('scope-only NO-GO (OPEN, category scope) is not a violation', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 0,
    findings: [
      {
        severity: 'HIGH',
        status: 'OPEN',
        category: 'scope',
        first_seen_round: 1,
        fingerprint: 'lib.txt:0:scope',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
});

test('--static mode skips command execution (unreachable pre_fix_sha never inspected)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 0,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 1, // same-round: exempt, so this alone would not violate anyway
        check: 'checks/foo.js',
        pre_fix_sha: '0'.repeat(40),
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.mode, 'static');
  assert.deepStrictEqual(report.checks, []);
});

test('vacuous red: check exits 0 against the pre-fix tree -> violation, exit 1', () => {
  const repo = makeRepo();
  const preFixSha = repo.base;
  commitFile(repo, 'checks/vacuous.js', VACUOUS_CHECK_SRC);
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/vacuous.js',
        check_blob: null,
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'vacuous-check'));
});

test('red-before-green happy path: red at pre-fix sha, green at current tree -> exit 0', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'buggy\n');
  repo.run('git add -A && git commit -qm buggy-marker');
  const preFixSha = repo.run('git rev-parse HEAD').trim();
  commitFile(repo, 'checks/redgreen.js', CHECK_SRC);
  // Fix the bug on the current tree.
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'fixed\n');
  repo.run('git add -A && git commit -qm fixed-marker');

  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/redgreen.js',
        check_blob: null,
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  const c = report.checks.find((c) => c.check === 'checks/redgreen.js');
  assert.strictEqual(c.red_verified, true);
  assert.ok(c.check_blob);
});

test('inconclusive red: unreachable pre_fix_sha -> exit >= 2', () => {
  const repo = makeRepo();
  commitFile(repo, 'checks/redgreen.js', CHECK_SRC);
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/redgreen.js',
        check_blob: null,
        pre_fix_sha: 'a'.repeat(40),
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p);
  assert.ok(r.code >= 2, `expected exit >= 2, got ${r.code}`);
});

test('blob weakening: recorded check_blob mismatches current -> mandatory re-verification', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'buggy\n');
  repo.run('git add -A && git commit -qm buggy-marker');
  const preFixSha = repo.run('git rev-parse HEAD').trim();
  commitFile(repo, 'checks/redgreen.js', CHECK_SRC);
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'fixed\n');
  repo.run('git add -A && git commit -qm fixed-marker');

  // Simulate the check having been weakened after its original verification:
  // overwrite it with a vacuous version (uncommitted — gate reads the current
  // working tree via git hash-object, so blob differs from the stale recorded one).
  fs.writeFileSync(path.join(repo.dir, 'checks/redgreen.js'), VACUOUS_CHECK_SRC);

  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/redgreen.js',
        check_blob: 'stale-blob-that-will-never-match',
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p);
  // Re-verification runs (blob mismatch) and the weakened (now-vacuous) check
  // fails to reproduce red -> reported as a violation, blocking route-back.
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.length > 0);
});

// ── FIX-A (CGF-1/CGF-2, CHECK-1): fail-closed on present-but-non-array findings ──

test('FIX-A: present non-array findings -> exit 2 (degraded input)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: { 0: { severity: 'HIGH', status: 'OPEN', check_encodable: false, fingerprint: 'a.ml:1:correctness' } },
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 2);
});

test('FIX-A: same finding as array -> exit 1 (unchanged behavior)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [{ severity: 'HIGH', status: 'OPEN', check_encodable: false, fingerprint: 'a.ml:1:correctness' }],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1);
});

test('FIX-A: absent findings key -> exit 0 (legacy-safe, CGF-2)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { no_go_round: 0 });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
});

// ── FIX-B (CGF-3/CGF-4/CGF-5, CHECK-2): red-verified fast path ──────────────

test('FIX-B: blob match without red_verified falls through to scratch red -> vacuous, exit 1', () => {
  const repo = makeRepo();
  const preFixSha = repo.base;
  commitFile(repo, 'checks/vacuous2.js', VACUOUS_CHECK_SRC);
  const blob = repo.run('git hash-object checks/vacuous2.js').trim();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/vacuous2.js',
        check_blob: blob, // matches current tree, but never actually red-verified
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
        // red_verified intentionally absent
      },
    ],
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'vacuous-check'));
});

test('FIX-B: proven red_verified true + matching blob -> fast path taken, exit 0 (pins the optimization)', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'fixed\n');
  repo.run('git add -A && git commit -qm fixed-marker');
  const preFixSha = repo.run('git rev-parse HEAD').trim();
  commitFile(repo, 'checks/redgreen2.js', CHECK_SRC);
  const blob = repo.run('git hash-object checks/redgreen2.js').trim();

  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/redgreen2.js',
        check_blob: blob,
        red_verified: true,
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  const c = report.checks.find((c) => c.check === 'checks/redgreen2.js');
  assert.strictEqual(c.red_verified, true);
});

test('read-only: gate run creates/modifies no repo file and never invokes git worktree add', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'buggy\n');
  repo.run('git add -A && git commit -qm buggy-marker');
  const preFixSha = repo.run('git rev-parse HEAD').trim();
  commitFile(repo, 'checks/redgreen.js', CHECK_SRC);
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'fixed\n');
  repo.run('git add -A && git commit -qm fixed-marker');

  const beforeStatus = repo.run('git status --porcelain -uall');
  const beforeWorktrees = repo.run('git worktree list');

  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/redgreen.js',
        check_blob: null,
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  gate(repo, p);

  const afterStatus = repo.run('git status --porcelain -uall');
  const afterWorktrees = repo.run('git worktree list');
  // review.json itself is an expected new file written by the test, not the gate;
  // strip it from the comparison.
  const strip = (s) =>
    s
      .split('\n')
      .filter((l) => !l.includes('review.json'))
      .join('\n');
  assert.strictEqual(strip(afterStatus), strip(beforeStatus));
  assert.strictEqual(afterWorktrees, beforeWorktrees);
});

// ── FIX-A (RGC-1/4, CHECK-1/2): path-containment choke point ────────────────

// A self-contained node script honoring the red-command exit convention
// (A-6), but placed OUTSIDE the repo: on execution it writes a canary file
// next to itself so a fixture can prove out-of-tree execution occurred.
const ATTACKER_SRC = [
  "const fs = require('fs');",
  "const path = require('path');",
  "fs.writeFileSync(path.resolve(__dirname, 'canary.txt'), 'pwned');",
  "process.exit(1);",
].join('\n');

test('CHECK-1: traversal check path escapes repo root -> exit 2, no out-of-tree execution', () => {
  const repo = makeRepo();
  const attackerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redgreen-attacker-'));
  try {
    const attackerFile = path.join(attackerDir, 'evil.js');
    fs.writeFileSync(attackerFile, ATTACKER_SRC);
    const canaryPath = path.join(attackerDir, 'canary.txt');

    const preFixSha = repo.base;
    const traversalCheck = path.relative(repo.dir, attackerFile);
    const p = writeReview(repo, {
      no_go_round: 1,
      findings: [
        {
          severity: 'HIGH',
          status: 'RESOLVED',
          first_seen_round: 1,
          resolved_round: 2,
          check: traversalCheck,
          check_blob: null,
          pre_fix_sha: preFixSha,
          fingerprint: 'a.ml:1:correctness',
        },
      ],
    });
    const r = gate(repo, p);
    assert.strictEqual(r.code, 2, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.ok(report.checks.some((c) => /check path escapes repo root/.test(c.reason)), r.stdout);
    assert.strictEqual(fs.existsSync(canaryPath), false, 'attacker script must never execute');
  } finally {
    fs.rmSync(attackerDir, { recursive: true, force: true });
  }
});

test('CHECK-2: absolute check path escapes repo root -> exit 2, no out-of-tree execution', () => {
  const repo = makeRepo();
  const attackerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'redgreen-attacker-'));
  try {
    const attackerFile = path.join(attackerDir, 'evil.js');
    fs.writeFileSync(attackerFile, ATTACKER_SRC);
    const canaryPath = path.join(attackerDir, 'canary.txt');

    const preFixSha = repo.base;
    const p = writeReview(repo, {
      no_go_round: 1,
      findings: [
        {
          severity: 'HIGH',
          status: 'RESOLVED',
          first_seen_round: 1,
          resolved_round: 2,
          check: attackerFile, // absolute path
          check_blob: null,
          pre_fix_sha: preFixSha,
          fingerprint: 'a.ml:1:correctness',
        },
      ],
    });
    const r = gate(repo, p);
    assert.strictEqual(r.code, 2, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.ok(report.checks.some((c) => /check path escapes repo root/.test(c.reason)), r.stdout);
    assert.strictEqual(fs.existsSync(canaryPath), false, 'attacker script must never execute');
  } finally {
    fs.rmSync(attackerDir, { recursive: true, force: true });
  }
});

// ── FIX-B (RGC-2/4, CHECK-3): green-phase tree-integrity corroboration ──────

// A check that reproduces red against the pre-fix (buggy) tree, but on the
// green run — regardless of marker state — writes an untracked side-effect
// file into cwd, mutating the real working tree.
const MUTATING_CHECK_SRC = [
  "const fs = require('fs');",
  "const path = require('path');",
  "fs.writeFileSync(path.resolve(process.cwd(), 'side-effect.txt'), 'mutated');",
  "const marker = path.resolve(__dirname, '..', 'marker.txt');",
  "let content = '';",
  "try { content = fs.readFileSync(marker, 'utf8').trim(); } catch (e) {}",
  "if (content === 'buggy') { process.exit(1); } else { process.exit(0); }",
].join('\n');

test('CHECK-3: green-phase mutation -> exit 2, not reported red_verified', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'buggy\n');
  repo.run('git add -A && git commit -qm buggy-marker');
  const preFixSha = repo.run('git rev-parse HEAD').trim();
  commitFile(repo, 'checks/mut.js', MUTATING_CHECK_SRC);
  // Fix the bug on the current tree (so red-against-pre-fix still fires,
  // isolating the failure to the green-phase mutation).
  fs.writeFileSync(path.join(repo.dir, 'marker.txt'), 'fixed\n');
  repo.run('git add -A && git commit -qm fixed-marker');

  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [
      {
        severity: 'HIGH',
        status: 'RESOLVED',
        first_seen_round: 1,
        resolved_round: 2,
        check: 'checks/mut.js',
        check_blob: null,
        pre_fix_sha: preFixSha,
        fingerprint: 'a.ml:1:correctness',
      },
    ],
  });
  const r = gate(repo, p);
  assert.strictEqual(r.code, 2, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  const c = report.checks.find((c) => c.check === 'checks/mut.js');
  assert.ok(c, r.stdout);
  assert.ok(/green run mutated the working tree/.test(c.reason), r.stdout);
  assert.notStrictEqual(c.red_verified, true);
  fs.rmSync(path.join(repo.dir, 'side-effect.txt'), { force: true });
});

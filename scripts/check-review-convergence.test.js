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

// ── review-fanout-convergence (US-1/US-2/US-3, spec v1.1.0) ──────────────

function novelFinding(round, overrides = {}) {
  return Object.assign(
    {
      severity: 'HIGH',
      status: 'OPEN',
      category: 'correctness',
      first_seen_round: round,
      resolved_round: null,
      fingerprint: `a.ml:${round}:correctness`,
    },
    overrides
  );
}

function auditEntry(round, overrides = {}) {
  return Object.assign(
    {
      round,
      reviewed_sha: 'a'.repeat(40),
      fix_sha: 'b'.repeat(40),
      specialists_run: [{ name: 'reviewer', selection_reason: 'owner reviewer always runs' }],
    },
    overrides
  );
}

test('AC-1: novel HIGH+ findings in rounds 2 and 3 (default strikes=2) -> novel-finding-streak, exit 1, top-level cause', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 3,
    findings: [novelFinding(2), novelFinding(3, { fingerprint: 'a.ml:3:correctness' })],
    rounds_audit: [auditEntry(2, { strike: true }), auditEntry(3)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'novel-finding-streak'));
  assert.strictEqual(report.cause, 'novel-finding-streak');
});

test('AC-3: strike, strike-free round, strike -> no streak violation (reset)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 4,
    findings: [], // round 4 itself is strike-free (no novel finding this round)
    rounds_audit: [
      auditEntry(2, { strike: true }),
      auditEntry(3, { strike: false }),
      auditEntry(4),
    ],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(!report.violations.some((v) => v.type === 'novel-finding-streak'));
});

test('AC-4: round 1 contributes no strike regardless of content', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 1,
    findings: [novelFinding(1)],
    rounds_audit: [],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.current_round_strike, false);
});

test('AC-5: --strikes abc -> exit 2', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 2, findings: [] });
  const r = gate(repo, p, ['--static', '--strikes', 'abc']);
  assert.strictEqual(r.code, 2);
});

test('AC-5: --strikes 0 -> exit 2', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 2, findings: [] });
  const r = gate(repo, p, ['--static', '--strikes', '0']);
  assert.strictEqual(r.code, 2);
});

test('AC-5: --strikes absent -> config.strikes default 2', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 1, findings: [] });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.config.strikes, 2);
});

test('AC-5: explicit --strikes 3 is passed through into config echo', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 1, findings: [] });
  const r = gate(repo, p, ['--static', '--strikes', '3']);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.config.strikes, 3);
});

test('AC-6: same-round-resolved novel finding -> GO round strike-free by construction', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [novelFinding(2, { status: 'RESOLVED', resolved_round: 2 })],
    rounds_audit: [auditEntry(2)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.current_round_strike, false);
});

test('AC-7: unencodable-finding + novel-finding-streak -> cause unencodable-finding (precedence)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 3,
    findings: [
      novelFinding(2),
      novelFinding(3, { fingerprint: 'a.ml:3:correctness' }),
      { severity: 'HIGH', status: 'OPEN', check_encodable: false, fingerprint: 'b.ml:1:correctness' },
    ],
    rounds_audit: [auditEntry(2, { strike: true }), auditEntry(3)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, 'unencodable-finding');
});

test('AC-7: novel-finding-streak + round-cap -> cause novel-finding-streak (precedence)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 5,
    round: 3,
    findings: [novelFinding(2), novelFinding(3, { fingerprint: 'a.ml:3:correctness' })],
    rounds_audit: [auditEntry(2, { strike: true }), auditEntry(3)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.cause, 'novel-finding-streak');
  assert.ok(report.violations.some((v) => v.type === 'round-cap'));
});

test('AC-13: degraded cross_runtime entry missing reason/config_digest -> warning, not violation', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 1,
    findings: [],
    cross_runtime: { codex: { status: 'degraded' } },
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0);
  const report = JSON.parse(r.stdout);
  assert.ok(report.warnings.some((w) => /missing reason/.test(w)));
  assert.ok(report.warnings.some((w) => /missing config_digest/.test(w)));
});

test('AC-15: complete loop-back GO draft audit entry -> no process-incomplete violation', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [],
    rounds_audit: [auditEntry(2)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
});

test('AC-16: missing rounds_audit entry for round >= 2 -> exit 3, cause never process-incomplete', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [],
    rounds_audit: [],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 3, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'missing-loopback-audit' && v.cause === 'process-incomplete'));
  assert.notStrictEqual(report.cause, 'process-incomplete');
});

test('AC-16: incomplete rounds_audit entry (empty selection_reason) -> exit 3', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [],
    rounds_audit: [auditEntry(2, { specialists_run: [{ name: 'reviewer', selection_reason: '' }] })],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 3, r.stdout + r.stderr);
});

test('AC-18: legacy review.json (no round key), physical loop-back-shaped findings -> warnings only, exit 0', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    no_go_round: 1,
    findings: [novelFinding(2), novelFinding(3, { fingerprint: 'a.ml:3:correctness' })],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.legacy_round, true);
  assert.strictEqual(report.current_round_strike, null);
});

test('EC-1: ACCEPTED novel HIGH+ finding -> no strike', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [novelFinding(2, { status: 'ACCEPTED' })],
    rounds_audit: [auditEntry(2)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.current_round_strike, false);
});

test('EC-3: --strikes 1 fires on any single strike round >= 2', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [novelFinding(2)],
    rounds_audit: [auditEntry(2)],
  });
  const r = gate(repo, p, ['--static', '--strikes', '1']);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'novel-finding-streak'));
});

test('EC-4: novel scope-category finding never strikes', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [novelFinding(2, { category: 'scope' })],
    rounds_audit: [auditEntry(2)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.current_round_strike, false);
});

test('EC-8: dirty tree fix_sha null + fix_sha_reason -> passes with flag (not a violation)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [],
    rounds_audit: [auditEntry(2, { fix_sha: null, fix_sha_reason: 'dirty-tree' })],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
});

test('EC-8: dirty tree fix_sha null WITHOUT fix_sha_reason -> violation (exit 3)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 2,
    findings: [],
    rounds_audit: [auditEntry(2, { fix_sha: null })],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 3, r.stdout + r.stderr);
});

test('config echo present in every report (GO and NO-GO)', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 1, findings: [] });
  const r = gate(repo, p, ['--static', '--strikes', '2', '--max-rounds', '5']);
  const report = JSON.parse(r.stdout);
  assert.deepStrictEqual(report.config, { max_rounds: 5, strikes: 2, static: true });
});

test('unknown flag -> exit 2', () => {
  const repo = makeRepo();
  const p = writeReview(repo, { round: 1, findings: [] });
  const r = gate(repo, p, ['--static', '--bogus-flag']);
  assert.strictEqual(r.code, 2);
});

test('streak read from rounds_audit[].strike is not recomputed: a late ACCEPT of a past finding cannot erase a journaled strike', () => {
  const repo = makeRepo();
  // Round 2's finding is now ACCEPTED (would compute as non-strike if
  // re-derived), but rounds_audit[].strike for round 2 was journaled true
  // when it actually happened — B-1 requires the gate to trust that flag,
  // not recompute it from the now-mutated finding status.
  const p = writeReview(repo, {
    round: 3,
    findings: [
      novelFinding(2, { status: 'ACCEPTED' }),
      novelFinding(3, { fingerprint: 'a.ml:3:correctness' }),
    ],
    rounds_audit: [auditEntry(2, { strike: true }), auditEntry(3)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(report.violations.some((v) => v.type === 'novel-finding-streak'));
});

// Tests for the review-fanout-convergence mechanics (US-1/US-2/US-3, spec:
// specs/review-fanout-convergence.md v1.1.0) added on top of
// scripts/check-review-convergence.js. Split into its own file (FIX-3) so
// scripts/check-review-convergence.test.js can keep its 17 pre-existing
// tests byte-unmodified while both files stay under the repo's 500-line
// limit.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, 'check-review-convergence.js');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-convergence-rules-'));
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' }).toString();
  run('git init -q .');
  run('git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  run('git add -A && git commit -qm base');
  const base = run('git rev-parse HEAD').trim();
  return { dir, run, base };
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

test('FIX-4: a PAST rounds_audit entry (2 <= round < currentRound) lacking a boolean strike field -> gate warning', () => {
  const repo = makeRepo();
  const p = writeReview(repo, {
    round: 3,
    findings: [],
    // Round 2's entry omits `strike` entirely — computeStrikeMap silently
    // treats it as not-a-strike (Map.get() returns undefined), resetting the
    // streak with no signal; this must surface as a warning instead.
    rounds_audit: [auditEntry(2), auditEntry(3)],
  });
  const r = gate(repo, p, ['--static']);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.ok(
    report.warnings.some((w) => /round 2/.test(w) && /strike/.test(w)),
    JSON.stringify(report.warnings)
  );
});

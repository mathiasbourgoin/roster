// Tests for scripts/check-scope-diff.sh (spec: specs/surgical-implementation.md FR-041/FR-042)
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.resolve(__dirname, 'check-scope-diff.sh');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-diff-'));
  const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'pipe' }).toString();
  run('git init -q .');
  run('git config user.email t@t && git config user.name t && git config commit.gpgsign false');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src/b.txt'), 'b\n');
  fs.writeFileSync(path.join(dir, 'lib.txt'), 'lib\n');
  // mirror real usage: the manifest lives in a gitignored location (briefs/)
  fs.writeFileSync(path.join(dir, '.gitignore'), 'manifest.txt\n');
  run('git add -A && git commit -qm base');
  const base = run('git rev-parse HEAD').trim();
  return { dir, run, base };
}

function writeManifest(repo, entries, { dirty = [] } = {}) {
  const lines = [`base=${repo.base}`, ...dirty.map((d) => `dirty=${d}`), '---', ...entries];
  const p = path.join(repo.dir, 'manifest.txt');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function gate(repo, manifestPath) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, manifestPath], { cwd: repo.dir, stdio: 'pipe' }).toString();
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || '').toString(), stderr: (e.stderr || '').toString() };
  }
}

test('in-manifest change → exit 0', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'src/a.txt'), 'changed\n');
  const m = writeManifest(repo, ['src/']);
  assert.strictEqual(gate(repo, m).code, 0);
});

test('out-of-manifest change → exit 1 with scope finding JSON', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'lib.txt'), 'changed\n');
  const m = writeManifest(repo, ['src/']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  const findings = JSON.parse(r.stdout);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].path, 'lib.txt');
  assert.strictEqual(findings[0].category, 'scope');
  assert.strictEqual(findings[0].severity, 'HIGH');
  assert.strictEqual(findings[0].line, 0);
  assert.strictEqual(findings[0].fingerprint, 'lib.txt:0:scope');
  assert.strictEqual(findings[0].status, 'OPEN');
});

test('exact-path entry allows only that file', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'src/a.txt'), 'changed\n');
  fs.writeFileSync(path.join(repo.dir, 'src/b.txt'), 'changed\n');
  const m = writeManifest(repo, ['src/a.txt']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  const paths = JSON.parse(r.stdout).map((f) => f.path);
  assert.deepStrictEqual(paths, ['src/b.txt']);
});

test('rename counts both paths', () => {
  const repo = makeRepo();
  repo.run('git mv src/a.txt renamed.txt');
  const m = writeManifest(repo, ['src/']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  const paths = JSON.parse(r.stdout).map((f) => f.path).sort();
  // old path src/a.txt is in-manifest; new path renamed.txt is not
  assert.deepStrictEqual(paths, ['renamed.txt']);
});

test('deletion counts as a change', () => {
  const repo = makeRepo();
  fs.unlinkSync(path.join(repo.dir, 'lib.txt'));
  const m = writeManifest(repo, ['src/']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout)[0].path, 'lib.txt');
});

test('committed change since base is detected', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'lib.txt'), 'committed change\n');
  repo.run('git add -A && git commit -qm change');
  const m = writeManifest(repo, ['src/']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout)[0].path, 'lib.txt');
});

test('pre-task dirty file is excluded', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'lib.txt'), 'pre-task edit\n');
  const m = writeManifest(repo, ['src/'], { dirty: ['lib.txt'] });
  assert.strictEqual(gate(repo, m).code, 0);
});

test('untracked new file out of manifest → violation (-uall)', () => {
  const repo = makeRepo();
  fs.mkdirSync(path.join(repo.dir, 'newdir'));
  fs.writeFileSync(path.join(repo.dir, 'newdir/new.txt'), 'new\n');
  const m = writeManifest(repo, ['src/']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout)[0].path, 'newdir/new.txt');
});

test('filename with a space matches a dir/ prefix', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'src/with space.txt'), 'x\n');
  const m = writeManifest(repo, ['src/']);
  assert.strictEqual(gate(repo, m).code, 0);
});

test('violation finding carries the real status line as evidence', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'lib.txt'), 'changed\n');
  const m = writeManifest(repo, ['src/']);
  const r = gate(repo, m);
  assert.strictEqual(r.code, 1);
  const f = JSON.parse(r.stdout)[0];
  assert.match(f.evidence, /git (status --porcelain|diff --name-status)/);
  assert.match(f.evidence, /lib\.txt/);
});

test('missing manifest → exit 2', () => {
  const repo = makeRepo();
  assert.strictEqual(gate(repo, path.join(repo.dir, 'nope.txt')).code, 2);
});

test('malformed manifest (no separator) → exit 2', () => {
  const repo = makeRepo();
  const p = path.join(repo.dir, 'manifest.txt');
  fs.writeFileSync(p, `base=${repo.base}\nsrc/\n`);
  assert.strictEqual(gate(repo, p).code, 2);
});

test('symbolic base (HEAD) → exit 2, not a silent pass', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'lib.txt'), 'committed violation\n');
  repo.run('git add -A && git commit -qm violation');
  const p = path.join(repo.dir, 'manifest.txt');
  fs.writeFileSync(p, 'base=HEAD\n---\nsrc/\n');
  assert.strictEqual(gate(repo, p).code, 2);
});

test('abbreviated base sha → exit 2', () => {
  const repo = makeRepo();
  const p = path.join(repo.dir, 'manifest.txt');
  fs.writeFileSync(p, `base=${repo.base.slice(0, 12)}\n---\nsrc/\n`);
  assert.strictEqual(gate(repo, p).code, 2);
});

test('duplicate base= lines → exit 2', () => {
  const repo = makeRepo();
  const p = path.join(repo.dir, 'manifest.txt');
  fs.writeFileSync(p, `base=${repo.base}\nbase=${repo.base}\n---\nsrc/\n`);
  assert.strictEqual(gate(repo, p).code, 2);
});

test('unknown base sha → exit 2', () => {
  const repo = makeRepo();
  const p = path.join(repo.dir, 'manifest.txt');
  fs.writeFileSync(p, 'base=0000000000000000000000000000000000000000\n---\nsrc/\n');
  assert.strictEqual(gate(repo, p).code, 2);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, 'roster-telemetry.js');
function run(cmd, args, cwd, extraEnv = {}) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_EDITOR: 'true', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid', ...extraEnv } });
}
function git(root, ...args) {
  const r = run('git', args, root);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
function harness(root) {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/harness.json'), '{"version":"1.0.0"}');
}
function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-telemetry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  harness(root);
  return root;
}
function cli(root, ...args) { return run(process.execPath, [source, ...args, '--root', root], root); }
function ok(root, ...args) {
  const r = cli(root, ...args);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
function stage(root, data = 'one') {
  fs.writeFileSync(path.join(root, 'file'), data);
  git(root, 'add', 'file');
}
function report(root, patch = {}) {
  const value = { schema_version: 1, task: 'test', harness_version: '1.0.0', staged_tree: git(root, 'write-tree'), elapsed_seconds: 12, input_tokens: 20, output_tokens: 5, agents: ['implementer'], mode: 'full', formal: { status: 'not-used', backend: null }, ...patch };
  fs.mkdirSync(path.join(root, '.harness/.local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/.local/commit-report.json'), JSON.stringify(value));
  return value;
}
function linked(t, root, suffix = '-linked') {
  const sibling = root + suffix;
  t.after(() => fs.rmSync(sibling, { recursive: true, force: true }));
  git(root, 'worktree', 'add', '-qb', 'linked' + suffix, sibling);
  harness(sibling);
  return sibling;
}
test('init-harness distributes skill/runtime and silently activates hooks', t => {
  const root = repo(t);
  const args = [path.join(__dirname, 'init-harness.sh'), root, 'core', '--force'];
  const init = run('bash', args, root);
  assert.equal(init.status, 0, init.stderr);
  assert.equal(ok(root, 'status').active, true);
  assert.ok(fs.existsSync(path.join(root, '.harness/skills/roster-telemetry.md')));
  assert.ok(fs.existsSync(path.join(root, '.harness/rules/commit-telemetry.md')));
  ok(root, 'configure', '--enabled', 'false');
  const again = run('bash', args, root);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(ok(root, 'status').config.enabled, false);
});
test('advisory validation removes inconsistent trailers, not body examples', t => {
  const root = repo(t);
  ok(root, 'install'); stage(root); report(root);
  const message = path.join(root, '.git/message-test');
  fs.writeFileSync(message, 'feat: example\n\nHarness-Input-Tokens: 999999\n');
  assert.equal(cli(root, 'validate', message).status, 0);
  assert.doesNotMatch(fs.readFileSync(message, 'utf8'), /Harness-/);
});
test('installed-only ESM distribution boots without changing consumer module scope', t => {
  const root = repo(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  fs.mkdirSync(path.join(root, '.harness/bin'), { recursive: true });
  const installed = path.join(root, '.harness/bin/roster-telemetry.cjs');
  fs.copyFileSync(source, installed);
  const result = run(process.execPath, [installed, 'install', '--root', root], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(ok(root, 'status').active, true);
  assert.equal(fs.existsSync(path.join(root, '.harness/bin/package.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).type, 'module');
  stage(root); report(root); git(root, 'commit', '-qm', 'feat: esm');
  assert.match(git(root, 'log', '-1', '--format=%B'), /Harness-Task: test/);
});
test('standalone installation preserves unrelated ESM scripts', t => {
  const root = repo(t);
  fs.mkdirSync(path.join(root, '.harness/bin'), { recursive: true });
  const file = path.join(root, '.harness/bin/unrelated.js');
  fs.writeFileSync(file, 'export default 1;\n');
  ok(root, 'install');
  assert.equal(fs.existsSync(path.join(root, '.harness/bin/package.json')), false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'export default 1;\n');
});
test('all active native hooks are protected, including pre-commit', t => {
  const root = repo(t);
  const file = path.join(root, '.git/hooks/pre-commit');
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.notEqual(cli(root, 'install').status, 0);
  assert.equal(run('git', ['config', '--get', 'core.hooksPath'], root).status, 1);
});
test('default native hooksPath can be migrated safely', t => {
  const root = repo(t);
  git(root, 'config', 'core.hooksPath', path.join(root, '.git/hooks'));
  ok(root, 'install');
  assert.equal(ok(root, 'status').active, true);
});
test('report template uses nulls, stays ignored and never overwrites evidence', t => {
  const root = repo(t);
  ok(root, 'install'); stage(root);
  const r = ok(root, 'report', 'example');
  assert.equal(r.input_tokens, null); assert.equal(r.agents, null);
  assert.equal(r.formal.status, 'unavailable');
  assert.notEqual(cli(root, 'report', 'example').status, 0);
  assert.equal(git(root, 'check-ignore', '.harness/.local/commit-report.json'), '.harness/.local/commit-report.json');
});
test('invalid identifiers, booleans and formal shapes are rejected; real zero is valid', t => {
  const root = repo(t);
  ok(root, 'install'); ok(root, 'configure', '--policy', 'strict'); stage(root);
  for (const patch of [{ input_tokens: true }, { agents: ['x', 'x'] }, { task: 'line\nbreak' }, { mode: 'other' }, { formal: { status: 'verified', backend: null } }, { extra: 1 }]) {
    report(root, patch);
    assert.notEqual(run('git', ['commit', '-qm', 'bad'], root).status, 0, JSON.stringify(patch));
  }
  report(root, { elapsed_seconds: 0, input_tokens: 0, output_tokens: 0 });
  git(root, 'commit', '-qm', 'feat: measured zero');
  assert.match(git(root, 'log', '-1', '--format=%B'), /Harness-Input-Tokens: 0/);
});
test('status catches broken permissions and install repairs owned hooks', t => {
  const root = repo(t); ok(root, 'install');
  fs.chmodSync(path.join(root, '.harness/git-hooks/commit-msg'), 0o644);
  assert.equal(ok(root, 'status').active, false);
  ok(root, 'install'); assert.equal(ok(root, 'status').active, true);
});
test('install is idempotent and actual hooks project metrics once', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'install');
  assert.equal(ok(root, 'status').active, true);
  stage(root); report(root); git(root, 'commit', '-qm', 'feat: test');
  const msg = git(root, 'log', '-1', '--format=%B');
  assert.match(msg, /Harness-Task: test/); assert.match(msg, /Harness-Agents: implementer/);
  assert.match(msg, /Harness-Mode: full/);
  assert.equal((msg.match(/Harness-Task:/g) || []).length, 1);
});
test('disabled survives repair and field controls suppress data', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--enabled', 'false');
  ok(root, 'install'); assert.equal(ok(root, 'status').config.enabled, false);
  stage(root); git(root, 'commit', '-qm', 'chore: no metrics');
  assert.doesNotMatch(git(root, 'log', '-1', '--format=%B'), /Harness-/);
  ok(root, 'configure', '--enabled', 'true', '--agents', 'false', '--mode', 'false', '--formal', 'false');
  stage(root, 'two'); report(root); git(root, 'commit', '-qm', 'feat: selected');
  assert.doesNotMatch(git(root, 'log', '-1', '--format=%B'), /Harness-(Agents|Mode|Formal):/);
});
test('strict blocks absent/stale enabled measurements; advisory allows missing', t => {
  const root = repo(t); ok(root, 'install'); stage(root); git(root, 'commit', '-qm', 'chore: advisory');
  ok(root, 'configure', '--policy', 'strict'); stage(root, 'two');
  assert.notEqual(run('git', ['commit', '-qm', 'bad'], root).status, 0);
  report(root); stage(root, 'three');
  assert.notEqual(run('git', ['commit', '-qm', 'stale'], root).status, 0);
  report(root, { input_tokens: null });
  assert.notEqual(run('git', ['commit', '-qm', 'missing'], root).status, 0);
  ok(root, 'configure', '--tokens', 'false'); git(root, 'commit', '-qm', 'feat: selected');
  assert.doesNotMatch(git(root, 'log', '-1', '--format=%B'), /Harness-Input-Tokens:/);
});
test('same-task totals cannot decrease and no-edit amend preserves identity', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  stage(root); report(root); git(root, 'commit', '-qm', 'feat: first');
  report(root, { input_tokens: 19 });
  assert.notEqual(run('git', ['commit', '--amend', '--no-edit'], root).status, 0);
  report(root, { task: 'other' });
  assert.notEqual(run('git', ['commit', '--amend', '--no-edit'], root).status, 0);
  report(root, { input_tokens: 30 }); git(root, 'commit', '--amend', '--no-edit', '-q');
  assert.match(git(root, 'log', '-1', '--format=%B'), /Harness-Input-Tokens: 30/);
});
test('custom hooks and hook paths are preserved', t => {
  const root = repo(t);
  const hook = path.join(root, '.git/hooks/commit-msg');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.notEqual(cli(root, 'install').status, 0);
  assert.equal(fs.readFileSync(hook, 'utf8'), '#!/bin/sh\nexit 0\n');
  fs.unlinkSync(hook); git(root, 'config', 'core.hooksPath', 'custom');
  assert.notEqual(cli(root, 'install').status, 0);
  assert.equal(git(root, 'config', 'core.hooksPath'), 'custom');
});
test('worktree setup never retargets a sibling or blocks new worktree creation', t => {
  const root = repo(t); ok(root, 'install'); stage(root); git(root, 'commit', '-qm', 'chore: base');
  const sibling = linked(t, root); ok(sibling, 'install');
  assert.equal(git(root, 'config', '--get', 'core.hooksPath'), path.join(root, '.harness/git-hooks'));
  assert.equal(git(sibling, 'config', '--get', 'core.hooksPath'), path.join(sibling, '.harness/git-hooks'));
  assert.equal(ok(sibling, 'status').active, true);
});
test('inherited sibling custom hooks cannot be bypassed by install', t => {
  const root = repo(t); ok(root, 'install'); stage(root); git(root, 'commit', '-qm', 'chore: base');
  const directory = path.join(root, '.harness/git-hooks');
  git(root, 'config', '--local', 'core.hooksPath', directory);
  fs.writeFileSync(path.join(directory, 'pre-commit'), '#!/bin/sh\nexit 42\n', { mode: 0o755 });
  const sibling = linked(t, root); stage(sibling, 'changed');
  assert.notEqual(run('git', ['commit', '-qm', 'blocked'], sibling).status, 0);
  assert.notEqual(cli(sibling, 'install').status, 0);
  assert.equal(git(sibling, 'config', '--get', 'core.hooksPath'), directory);
  assert.notEqual(run('git', ['commit', '-qm', 'still blocked'], sibling).status, 0);
});
test('bare-parent and shared core.worktree layouts fail before configuration changes', t => {
  const root = repo(t); stage(root); git(root, 'commit', '-qm', 'chore: base');
  const bare = root + '-bare'; const sibling = root + '-bare-linked';
  t.after(() => { fs.rmSync(sibling, { recursive: true, force: true }); fs.rmSync(bare, { recursive: true, force: true }); });
  git(root, 'clone', '--bare', '-q', root, bare);
  git(root, '--git-dir', bare, 'worktree', 'add', '-qb', 'bare-linked', sibling);
  harness(sibling);
  for (const alias of ['true', 'yes', 'on', '1']) {
    git(sibling, 'config', '--local', 'core.bare', alias);
    const before = git(sibling, 'config', '--local', '--list');
    assert.notEqual(cli(sibling, 'install').status, 0, alias);
    assert.equal(git(sibling, 'config', '--local', '--list'), before);
    git(sibling, 'status', '--porcelain');
  }
  git(root, 'config', '--local', 'core.worktree', root);
  assert.notEqual(cli(root, 'install').status, 0);
  git(root, 'status', '--porcelain');
});
test('strict amend -m/-F preserves task, ordinary -C/-c permits a new task', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  stage(root); report(root); git(root, 'commit', '-qm', 'feat: first');
  const before = git(root, 'rev-parse', 'HEAD');
  report(root, { task: 'different' });
  const file = path.join(root, '.git/new-message'); fs.writeFileSync(file, 'feat: replacement\n');
  for (const args of [['--amend', '-qm', 'feat: replacement'], ['--amend', '-qF', file]]) {
    assert.notEqual(run('git', ['commit', ...args], root).status, 0);
    assert.equal(git(root, 'rev-parse', 'HEAD'), before);
  }
  stage(root, 'two'); report(root, { task: 'second' }); git(root, 'commit', '-qC', 'HEAD');
  assert.match(git(root, 'log', '-1', '--format=%B'), /Harness-Task: second/);
  stage(root, 'three'); report(root, { task: 'third' }); git(root, 'commit', '-qc', 'HEAD');
  assert.match(git(root, 'log', '-1', '--format=%B'), /Harness-Task: third/);
});
test('body examples and unrelated trailers survive valid and advisory cleanup', t => {
  const root = repo(t); ok(root, 'install'); stage(root);
  const file = path.join(root, '.git/body-message');
  const body = 'feat: example\n\nDocumentation:\nHarness-Task: literal-example\nNot metadata.\n\nSigned-off-by: Person\nHarness-Task: stale\n';
  fs.writeFileSync(file, body); assert.equal(cli(root, 'prepare', file).status, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /Harness-Task: literal-example/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /Harness-Task: stale/);
  report(root); fs.writeFileSync(file, body); assert.equal(cli(root, 'prepare', file).status, 0);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /Harness-Task: literal-example/); assert.match(text, /Signed-off-by: Person/);
  assert.match(text, /Harness-Task: test/); assert.doesNotMatch(text, /Harness-Task: stale/);
});
test('abandoned receipt never blocks an unrelated same-tree reset', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  stage(root); report(root); git(root, 'commit', '-qm', 'feat: first');
  const first = git(root, 'rev-parse', 'HEAD');
  git(root, 'commit', '--allow-empty', '-qm', 'feat: second');
  const aborted = run('git', ['commit', '--allow-empty', '--edit', '-m', 'feat: aborted'], root, { GIT_EDITOR: 'false' });
  assert.notEqual(aborted.status, 0);
  assert.ok(fs.existsSync(path.join(root, '.harness/.local/commit-intent.json')));
  git(root, 'reset', '--hard', first);
  assert.equal(git(root, 'rev-parse', 'HEAD'), first);
});
test('disabled telemetry ignores malformed local intent', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--enabled', 'false');
  fs.mkdirSync(path.join(root, '.harness/.local'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness/.local/commit-intent.json'), 'not json');
  stage(root); git(root, 'commit', '-qm', 'feat: disabled');
  assert.doesNotMatch(git(root, 'log', '-1', '--format=%B'), /Harness-/);
});
test('folded owned trailers are not accepted as unchanged metadata', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  stage(root); report(root);
  const file = path.join(root, '.git/fold-message'); fs.writeFileSync(file, 'feat: fold\n');
  assert.equal(cli(root, 'prepare', file, 'message').status, 0);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Harness-Agents: implementer', 'Harness-Agents: implementer\n extra-agent'));
  assert.notEqual(cli(root, 'validate', file).status, 0);
});
test('advisory missing data is allowed, but contradictory final amend metadata is refused', t => {
  const root = repo(t); ok(root, 'install'); stage(root); report(root);
  git(root, 'commit', '-qm', 'feat: first'); const first = git(root, 'rev-parse', 'HEAD');
  report(root, { task: 'different', input_tokens: 1 });
  assert.notEqual(run('git', ['commit', '--amend', '-qm', 'feat: changed task'], root).status, 0);
  assert.equal(git(root, 'rev-parse', 'HEAD'), first);
});
test('empty commits do not acquire metadata-only messages; interactive subjects work', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  stage(root); report(root);
  assert.notEqual(run('git', ['commit', '-qm', ''], root).status, 0);
  const editor = path.join(root, '.git/subject-editor.sh');
  fs.writeFileSync(editor, '#!/bin/sh\nprintf "feat: interactive\\n" > "$1"\n', { mode: 0o755 });
  const result = run('git', ['commit', '-q'], root, { GIT_EDITOR: editor });
  assert.equal(result.status, 0, result.stderr);
  assert.match(git(root, 'log', '-1', '--format=%B'), /^feat: interactive\n/);
  assert.match(git(root, 'log', '-1', '--format=%B'), /Harness-Task: test/);
});
test('comment-prefixed -m subjects are preserved', t => {
  const root = repo(t); ok(root, 'install'); stage(root); report(root);
  git(root, 'commit', '-qm', '# actual subject');
  assert.match(git(root, 'log', '-1', '--format=%B'), /^# actual subject\n/);
});
test('automatic comment characters preserve strict scissors metadata', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  git(root, 'config', 'core.commentChar', 'auto'); stage(root); report(root);
  const file = path.join(root, '.git/auto-scissors-message');
  fs.writeFileSync(file, 'feat: auto scissors\n\nBody.\n\n# ------------------------ >8 ------------------------\n# discarded\n');
  git(root, 'commit', '-q', '--cleanup=scissors', '--edit', '-F', file);
  const message = git(root, 'log', '-1', '--format=%B');
  assert.match(message, /Harness-Task: test/); assert.doesNotMatch(message, /discarded/);
});
test('strict final metadata survives Git scissors cleanup', t => {
  const root = repo(t); ok(root, 'install'); ok(root, 'configure', '--policy', 'strict');
  stage(root); report(root);
  const file = path.join(root, '.git/scissors-message');
  fs.writeFileSync(file, 'feat: scissors\n\nBody.\n\n# ------------------------ >8 ------------------------\n# discarded text\n');
  git(root, 'commit', '-q', '--cleanup=scissors', '--edit', '-F', file);
  const message = git(root, 'log', '-1', '--format=%B');
  assert.match(message, /Harness-Task: test/); assert.doesNotMatch(message, /discarded text/);
});

for (const policy of ['advisory', 'strict']) {
  test(`Express Lite records the actual ledger mode under ${policy} policy`, t => {
    const root = repo(t);
    ok(root, 'install');
    ok(root, 'configure', '--policy', policy);
    stage(root); report(root, { mode: 'express-lite' });
    git(root, 'commit', '-qm', 'docs: express lite');
    const message = git(root, 'log', '-1', '--format=%B');
    assert.match(message, /^Harness-Mode: express-lite$/m);
    assert.match(message, /^Harness-Task: test$/m);
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../schema/telemetry-report.schema.json'), 'utf8'));
    assert.ok(schema.properties.mode.enum.includes('express-lite'));
  });
}

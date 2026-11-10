#!/usr/bin/env node
'use strict';
// R4 supplemental real-entrypoint ratchet. Builtins only; 0 pass, 1 assertion, 2 setup.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const base = path.resolve(__dirname, '..');
const source = path.join(base, 'scripts/roster-telemetry.js');
const cut = '# ------------------------ >8 ------------------------';
const groups = ['assets', 'editor', 'auto', 'branch', 'content'];
let temp, serial = 0;
const results = [];
class SetupError extends Error {}
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
function run(root, command, args, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^GIT_|^ROSTER_/.test(k)) delete env[k];
  Object.assign(env, { HOME: path.join(temp, 'home'), CODEX_HOME: path.join(temp, 'codex'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temp, 'global'), LC_ALL: 'C',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_EDITOR: 'true', ...extra.env });
  const r = spawnSync(command, args, { cwd: root, env, input: extra.input, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.signal || r.status === null) throw new SetupError(`${command}: ${r.error?.message || r.signal}`);
  if (!Buffer.isBuffer(r.stdout) || !Buffer.isBuffer(r.stderr)) throw new SetupError('subprocess capture unavailable');
  return { ...r, diagnostic: Buffer.concat([r.stdout, r.stderr]).toString() };
}
function ok(r, label) { assert.equal(r.status, 0, `${label}: ${r.diagnostic}`); return r; }
function g(root, ...args) {
  const r = run(root, 'git', args);
  if (r.status) throw new SetupError(`git ${args.join(' ')}: ${r.diagnostic}`);
  return r.stdout.toString().trim();
}
function cli(root, ...args) { return run(root, process.execPath, [source, ...args, '--root', root]); }
function repo(active = true, policy = 'advisory') {
  const root = path.join(temp, `consumer-${++serial}`); fs.mkdirSync(root); g(root, 'init', '-q');
  write(path.join(root, '.harness/harness.json'), '{"version":"1.0.0","runtimes":[],"layers":{}}');
  if (active) { ok(cli(root, 'install'), 'install'); ok(cli(root, 'configure', '--policy', policy), 'configure'); }
  return root;
}
function stage(root) { write(path.join(root, 'file'), String(++serial)); g(root, 'add', 'file'); }
function report(root) {
  write(path.join(root, '.harness/.local/commit-report.json'), JSON.stringify({ schema_version: 1,
    task: 'contract', harness_version: '1.0.0', staged_tree: g(root, 'write-tree'), elapsed_seconds: 12,
    input_tokens: 20, output_tokens: 5, agents: ['fixture'], mode: 'full',
    formal: { status: 'not-used', backend: null } }));
}
function raw(root) {
  const r = ok(run(root, 'git', ['cat-file', 'commit', 'HEAD']), 'read commit').stdout;
  return r.subarray(r.indexOf(Buffer.from('\n\n')) + 2);
}
function parsed(root) { return ok(run(root, 'git', ['interpret-trailers', '--parse'], { input: raw(root) }), 'parse').stdout.toString(); }
function probe(group, label, fn) {
  try { fn(); results.push({ group, label, result: 'PASS' }); }
  catch (e) { results.push({ group, label, result: e.code === 'ERR_ASSERTION' ? 'ASSERTION' : 'ERROR', detail: e.stack }); }
  const r = results.at(-1); console.log(`${r.result} ${group}: ${label}${r.detail ? '\n' + r.detail : ''}`);
}
function snapshot(file) {
  try { const s = fs.lstatSync(file); return s.isSymbolicLink() ? { link: fs.readlinkSync(file), mode: s.mode } :
    s.isDirectory() ? { directory: true, mode: s.mode } : { bytes: fs.readFileSync(file).toString('base64'), mode: s.mode }; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function init(root) { return run(root, 'bash', [path.join(base, 'scripts/init-harness.sh'), root, 'core', '--force']); }
function assets() {
  const files = ['.harness/skills/roster-telemetry.md', '.harness/rules/commit-telemetry.md',
    '.claude/commands/roster-telemetry.md', '.claude/rules/commit-telemetry.md',
    '.opencode/skills/roster-telemetry/SKILL.md', '.agents/skills/roster-telemetry/SKILL.md'];
  for (const file of files) for (const kind of ['link', 'dangling', 'hardlink']) probe('assets', `${file} ${kind}`, () => {
    const root = repo(false), outside = path.join(temp, `outside-${++serial}`), target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (kind !== 'dangling') { write(outside, 'EXTERNAL SENTINEL\n'); fs.chmodSync(outside, 0o640); }
    if (kind === 'hardlink') fs.linkSync(outside, target); else fs.symlinkSync(outside, target);
    const before = snapshot(outside), alias = snapshot(target), r = init(root);
    assert.notEqual(r.status, 0, 'init must refuse before distribution');
    assert.deepEqual(snapshot(outside), before); assert.deepEqual(snapshot(target), alias);
  });
  for (const dir of ['.harness/skills', '.harness/rules', '.claude', '.opencode', '.agents']) probe('assets', `${dir} ancestor`, () => {
    const root = repo(false), outside = path.join(temp, `directory-${++serial}`), target = path.join(root, dir);
    fs.mkdirSync(outside); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(outside, target);
    const r = init(root); assert.notEqual(r.status, 0); assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.readlinkSync(target), outside);
  });
  probe('assets', 'safe core init control', () => {
    const root = repo(false); ok(init(root), 'safe init');
    assert(fs.existsSync(path.join(root, '.harness/skills/roster-telemetry.md')));
  });
}
function edited(variant, policy, cleanup) {
  const root = repo(true, policy); stage(root); report(root);
  const script = path.join(temp, `editor-${++serial}.cjs`);
  // Introduce an actual conflict whether emission happens before or after editing.
  const tail = JSON.stringify('\n' + cut + '\nauthored tail\n');
  const edits = variant === 'before' ? `if(s.includes('Harness-Telemetry-Version:'))s=s.replace('Harness-Telemetry-Version:',${JSON.stringify(cut + '\nHarness-Telemetry-Version:')});else s+=${tail};` :
    variant === 'partial' ? `s=s.replace(/^Harness-Telemetry-Version:.*\\n/m,'');s+=${tail};` :
      `if(s.includes('Harness-Task: contract'))s=s.replace('Harness-Task: contract','Harness-Task: contract\\nauthored note');else s+='\\nauthored note\\n';s+=${tail};`;
  write(script, `const fs=require('node:fs'),p=process.argv[2];let s=fs.readFileSync(p,'utf8');${edits}fs.writeFileSync(p,s);`);
  const r = run(root, 'git', ['commit', '-qm', 'subject', '--edit', `--cleanup=${cleanup}`],
    { env: { GIT_EDITOR: `${process.execPath} ${script}` } });
  if (policy === 'strict' || (variant !== 'before' && r.status !== 0)) {
    assert.notEqual(r.status, 0); assert.notEqual(run(root, 'git', ['rev-parse', '--verify', 'HEAD']).status, 0);
  } else {
    ok(r, 'M7 ordinary advisory commit'); const body = raw(root).toString();
    assert(!/^Harness-/m.test(body), 'generated fields survived advisory fallback');
    assert(/subject/.test(body));
    if (variant !== 'before') assert(body.includes('authored tail'));
    if (variant === 'note') assert(body.includes('authored note'));
    assert.equal(parsed(root), '');
  }
}
function editor() {
  for (const policy of ['advisory', 'strict']) for (const cleanup of ['whitespace', 'verbatim'])
    for (const variant of ['before', 'partial', 'note']) probe('editor', `${policy} ${cleanup} ${variant}`, () => edited(variant, policy, cleanup));
}
function auto() {
  for (const policy of ['advisory', 'strict']) for (const marker of ['$', ';', '@', '!', '%', '|', ':'])
    for (const cleanup of ['whitespace', 'verbatim']) probe('auto', `${policy} ${cleanup} trailing ${marker}`, () => {
      const root = repo(true, policy); g(root, 'config', 'core.commentChar', 'auto'); stage(root); report(root);
      const text = `subject\n\nBody.\n\n${marker} last body line\n`, file = path.join(root, '.git/message'); write(file, text);
      ok(run(root, 'git', ['commit', '-q', '-F', file, `--cleanup=${cleanup}`]), 'supported M1 body');
      const message = raw(root).toString(); assert(message.includes(`${marker} last body line`));
      assert(parsed(root).includes('Harness-Task: contract\n'));
      assert(message.indexOf(`${marker} last body line`) < message.indexOf('Harness-Telemetry-Version:'), 'body displaced below footer');
    });
}
function content() {
  for (const policy of ['advisory', 'strict']) {
    probe('content', `${policy} removed provenance cannot publish old generated values after conflict`, () => {
      const root = repo(true, policy); stage(root); report(root);
      const script = path.join(temp, `editor-${++serial}.cjs`);
      write(script, `const fs=require('node:fs'),p=process.argv[2];let s=fs.readFileSync(p,'utf8').replace(/^.*roster-telemetry:.*\\n/gm,'');s=s.replace('Harness-Telemetry-Version:',${JSON.stringify(cut + '\nHarness-Telemetry-Version:')});fs.writeFileSync(p,s);`);
      const r = run(root, 'git', ['commit', '-qm', 'subject', '--edit', '--cleanup=verbatim'], { env: { GIT_EDITOR: `${process.execPath} ${script}` } });
      if (r.status === 0) assert(!/^Harness-/m.test(raw(root).toString()), 'generated metadata survived lost provenance');
      else assert.notEqual(run(root, 'git', ['rev-parse', '--verify', 'HEAD']).status, 0);
    });
    probe('content', `${policy} replaced buffer does not authorize changed prepared report`, () => {
      const root = repo(true, policy); stage(root); report(root);
      const script = path.join(temp, `editor-${++serial}.cjs`), file = path.join(root, '.harness/.local/commit-report.json');
      write(script, `const fs=require('node:fs'),p=${JSON.stringify(file)},r=JSON.parse(fs.readFileSync(p));r.input_tokens=999;fs.writeFileSync(p,JSON.stringify(r));fs.writeFileSync(process.argv[2],'new subject\\n');`);
      const r = run(root, 'git', ['commit', '-qm', 'subject', '--edit'], { env: { GIT_EDITOR: `${process.execPath} ${script}` } });
      assert.notEqual(r.status, 0); assert.notEqual(run(root, 'git', ['rev-parse', '--verify', 'HEAD']).status, 0);
    });
    probe('content', `${policy} auto editor subject starts with dollar`, () => {
      const root = repo(true, policy); g(root, 'config', 'core.commentChar', 'auto'); stage(root); report(root);
      const script = path.join(temp, `editor-${++serial}.cjs`);
      write(script, `require('node:fs').writeFileSync(process.argv[2],'$ actual subject\\n');`);
      ok(run(root, 'git', ['commit', '-qm', 'subject', '--edit'], { env: { GIT_EDITOR: `${process.execPath} ${script}` } }), 'authored subject');
      assert(raw(root).toString().startsWith('$ actual subject\n')); assert(parsed(root).includes('Harness-Task: contract\n'));
    });
    probe('content', `${policy} whole-buffer authored partial example`, () => {
      const root = repo(true, policy); stage(root); report(root);
      const version = ok(cli(root, 'version'), 'runtime version').stdout.toString().trim();
      const body = 'new subject\n\nExample follows.\n' + 'Ordinary authored prose.\n'.repeat(12) + `\`\`\`\nHarness-Telemetry-Version: ${version}\n\`\`\`\n`;
      const script = path.join(temp, `editor-${++serial}.cjs`);
      write(script, `require('node:fs').writeFileSync(process.argv[2],${JSON.stringify(body)});`);
      ok(run(root, 'git', ['commit', '-qm', 'subject', '--edit'], { env: { GIT_EDITOR: `${process.execPath} ${script}` } }), 'authored example');
      assert(raw(root).toString().startsWith(body)); assert(parsed(root).includes('Harness-Task: contract\n'));
    });
    probe('content', `${policy} intact footer plus identical non-footer example`, () => {
      const root = repo(true, policy); stage(root); report(root);
      const version = ok(cli(root, 'version'), 'runtime version').stdout.toString().trim();
      const example = `Harness-Telemetry-Version: ${version}\nHarness-Version: 1.0.0\nHarness-Task: contract\nHarness-Metrics-Source: agent-reported-cumulative\nHarness-Elapsed-Seconds: 12\nHarness-Input-Tokens: 20\nHarness-Output-Tokens: 5\nHarness-Agents: fixture\nHarness-Mode: full\nHarness-Formal: not-used\n`;
      const body = 'subject\n\nExample follows.\n```\n' + example + '```\n' + 'Ordinary authored prose.\n'.repeat(60);
      const file = path.join(root, '.git/message'); write(file, body);
      ok(run(root, 'git', ['commit', '-q', '-F', file]), 'duplicate authored example');
      assert(raw(root).toString().startsWith(body)); assert(parsed(root).includes('Harness-Task: contract\n'));
    });
  }
}
function branch() {
  probe('branch', 'inherited hooks survive switch to branch without telemetry', () => {
    const root = repo(false); stage(root); g(root, 'commit', '-qm', 'base'); const old = g(root, 'rev-parse', 'HEAD');
    ok(cli(root, 'install'), 'install feature'); g(root, 'add', '.harness'); report(root);
    ok(run(root, 'git', ['commit', '-qm', 'feature']), 'feature commit');
    const other = path.join(temp, `worktree-${++serial}`); g(root, 'worktree', 'add', '-q', '--detach', other, 'HEAD');
    // Reproduce the actual stale/inherited per-worktree activation reported by peer.
    g(other, 'config', '--worktree', 'core.hooksPath', path.join(root, '.harness/git-hooks'));
    g(other, 'checkout', '-q', '--detach', old);
    assert(!fs.existsSync(path.join(other, '.harness/bin/roster-telemetry.cjs'))); stage(other);
    ok(run(other, 'git', ['commit', '-qm', 'ordinary old branch']), 'branch without telemetry');
    assert(!/^Harness-/m.test(raw(other).toString()));
  });
  probe('branch', 'missing tracked runtime remains an actionable failure', () => {
    const root = repo(); stage(root); g(root, 'add', '.harness'); report(root);
    ok(run(root, 'git', ['commit', '-qm', 'feature']), 'feature commit');
    fs.unlinkSync(path.join(root, '.harness/bin/roster-telemetry.cjs')); stage(root);
    const before = g(root, 'rev-parse', 'HEAD'), r = run(root, 'git', ['commit', '-qm', 'broken install']);
    assert.notEqual(r.status, 0); assert.equal(g(root, 'rev-parse', 'HEAD'), before);
  });
}
function main() {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-lifecycle-'));
  try {
    if (!fs.existsSync(source)) throw new SetupError('trusted source runtime missing');
    const gitVersion = run(temp, 'git', ['--version']); if (gitVersion.status) throw new SetupError(gitVersion.diagnostic);
    const selected = process.argv.slice(2); if (selected.some(n => !groups.includes(n))) throw new SetupError('unknown case');
    for (const name of selected.length ? selected : groups) ({ assets, editor, auto, branch, content })[name]();
  } catch (e) { console.log(`ERROR setup: ${e.stack}`); results.push({ result: 'ERROR' }); }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
  for (const name of groups) {
    const rs = results.filter(r => r.group === name); if (rs.length) console.log(`SUMMARY ${name}: ${rs.filter(r => r.result === 'PASS').length} PASS, ${rs.filter(r => r.result === 'ASSERTION').length} ASSERTION, ${rs.filter(r => r.result === 'ERROR').length} ERROR`);
  }
  process.exitCode = results.some(r => r.result === 'ERROR') ? 2 : results.some(r => r.result === 'ASSERTION') ? 1 : 0;
}
if (require.main === module) main();

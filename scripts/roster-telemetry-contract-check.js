#!/usr/bin/env node
'use strict';
// Standalone contract ratchet: only builtins, disposable consumers, no test runner.
// 0 = pass; 1 = contract assertion; 2 = inconclusive setup/tool/permission error.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const base = path.resolve(__dirname, '..');
const source = path.join(base, 'scripts/roster-telemetry.js');
const names = ['filesystem', 'readonly', 'trailers', 'messages', 'encoding', 'receipts', 'reports', 'distribution'];
const owned = /^Harness-(Telemetry-Version|Version|Task|Elapsed-Seconds|Input-Tokens|Output-Tokens|Agents|Mode|Formal|Metrics-Source)$/i;
const canonicalKeys = new Set(['Telemetry-Version', 'Version', 'Task', 'Elapsed-Seconds', 'Input-Tokens', 'Output-Tokens', 'Agents', 'Mode', 'Formal', 'Metrics-Source'].map(k => 'Harness-' + k));
const scissors = '# ------------------------ >8 ------------------------';
let temp, serial = 0;
const results = [];
class SetupError extends Error {}
function write(file, bytes, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, mode ? { mode } : undefined);
}
function run(root, command, args, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_|^ROSTER_/.test(key)) delete env[key];
  Object.assign(env, { HOME: path.join(temp, 'home'), CODEX_HOME: path.join(temp, 'codex'),
    PATH: path.join(temp, 'offline') + path.delimiter + process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(temp, 'global'),
    GIT_AUTHOR_NAME: 'Contract', GIT_AUTHOR_EMAIL: 'contract@example.invalid',
    GIT_COMMITTER_NAME: 'Contract', GIT_COMMITTER_EMAIL: 'contract@example.invalid',
    GIT_EDITOR: 'true', LC_ALL: 'C', ...extra.env });
  const r = spawnSync(command, args, { cwd: root, env, input: extra.input, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new SetupError(`${command}: ${r.error.code}: ${r.error.message}`);
  if (r.signal || r.status === null) throw new SetupError(`${command}: terminated ${r.signal}`);
  if (!Buffer.isBuffer(r.stdout) || !Buffer.isBuffer(r.stderr)) throw new SetupError(`${command}: subprocess capture unavailable`);
  const diagnostic = Buffer.concat([r.stdout || Buffer.alloc(0), r.stderr || Buffer.alloc(0)]).toString();
  if (/\bEPERM\b|Operation not permitted|Cannot find module|MODULE_NOT_FOUND|Missing required command:|command not found|SyntaxError:/.test(diagnostic)) {
    throw new SetupError(`${command} exit ${r.status}: ${diagnostic.slice(-2400)}`);
  }
  return { ...r, diagnostic };
}
function success(r, label) { assert.equal(r.status, 0, `${label}: exit ${r.status}\n${r.diagnostic}`); return r; }
function setup(r, label) {
  if (r.status !== 0) throw new SetupError(`${label}: exit ${r.status}\n${r.diagnostic}`);
  return r;
}
function git(root, ...args) { return run(root, 'git', args); }
function g(root, ...args) { return setup(git(root, ...args), `git ${args.join(' ')}`).stdout.toString().trim(); }
function cli(root, ...args) { return run(root, process.execPath, [source, ...args, '--root', root]); }
function installed(root, ...args) {
  return run(root, process.execPath, [path.join(root, '.harness/bin/roster-telemetry.cjs'), ...args, '--root', root]);
}
function json(r) { setup(r, 'runtime setup'); try { return JSON.parse(r.stdout); } catch (e) { throw new SetupError(e.message); } }
function repo(active = false, policy = 'strict') {
  const root = path.join(temp, `consumer-${++serial}`);
  fs.mkdirSync(root); g(root, 'init', '-q');
  write(path.join(root, '.harness/harness.json'), JSON.stringify({ version: '1.0.0', runtimes: [], layers: {} }));
  if (active) { json(cli(root, 'install')); json(cli(root, 'configure', '--policy', policy)); }
  return root;
}
function stage(root) { write(path.join(root, 'file'), String(++serial)); g(root, 'add', 'file'); }
function report(root, patch = {}) {
  const value = { schema_version: 1, task: 'contract', harness_version: '1.0.0', staged_tree: g(root, 'write-tree'),
    elapsed_seconds: 12, input_tokens: 20, output_tokens: 5, agents: ['implementer'], mode: 'full',
    formal: { status: 'not-used', backend: null }, ...patch };
  write(path.join(root, '.harness/.local/commit-report.json'), JSON.stringify(value));
}
function shell(root, entry, check = false) {
  const args = entry === 'init' ? [root, 'core', '--force'] : [root, ...(check ? ['--check'] : [])];
  return run(root, 'bash', [path.join(base, `scripts/${entry}-harness.sh`), ...args]);
}
function snapshot(file) {
  try {
    const s = fs.lstatSync(file);
    if (s.isSymbolicLink()) return { link: fs.readlinkSync(file), mode: s.mode };
    if (s.isDirectory()) return Object.fromEntries(fs.readdirSync(file).sort().map(n => [n, snapshot(path.join(file, n))]));
    return { bytes: fs.readFileSync(file).toString('base64'), mode: s.mode };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function config(root) {
  const common = path.resolve(root, g(root, 'rev-parse', '--git-common-dir'));
  const local = path.resolve(root, g(root, 'rev-parse', '--git-path', 'config.worktree'));
  return { common: snapshot(path.join(common, 'config')), worktree: snapshot(local) };
}
function probe(group, label, fn) {
  try { fn(); results.push({ group, label, result: 'PASS' }); }
  catch (e) { results.push({ group, label, result: e.code === 'ERR_ASSERTION' ? 'ASSERTION' : 'ERROR', detail: e.stack }); }
  const last = results.at(-1);
  console.log(`${last.result} ${group}: ${label}${last.detail ? '\n' + last.detail : ''}`);
}
function raw(root) {
  const object = setup(git(root, 'cat-file', 'commit', 'HEAD'), 'read commit').stdout;
  return object.subarray(object.indexOf(Buffer.from('\n\n')) + 2);
}
function parsed(root, bytes = raw(root)) {
  return setup(run(root, 'git', ['interpret-trailers', '--parse'], { input: bytes }), 'native trailer parse').stdout.toString();
}
function footer(root, task = 'contract') {
  const p = parsed(root), lines = p.split('\n').filter(Boolean), seen = new Set();
  for (const line of lines) {
    const key = line.split(':')[0];
    if (!owned.test(key)) continue;
    assert(!seen.has(key.toLowerCase()), `duplicate native owned key: ${line}`); seen.add(key.toLowerCase());
    assert(canonicalKeys.has(key), `noncanonical owned key: ${key}`);
  }
  assert.equal(lines.filter(l => /^Harness-Task: /.test(l)).join(''), `Harness-Task: ${task}`, p);
  assert.equal(lines.filter(l => /^Harness-Telemetry-Version: /.test(l)).length, 1, p);
  assert.equal((raw(root).toString().match(/^Harness-Telemetry-Version: /gm) || []).length, 1);
}
function withoutGenerated(bytes, control) {
  // Operate on bytes (latin1 is reversible), preserving CRLF/spaces. Only remove
  // the generated footer paragraph, never arbitrary body examples or raw tails.
  let s = bytes.toString('latin1'), marker = s.indexOf('\nHarness-Telemetry-Version:');
  assert(marker >= 0, 'generated footer missing from raw commit');
  const separators = [...s.slice(0, marker + 1).matchAll(/(?:\r?\n){2}/g)];
  const boundary = separators.at(-1); assert(boundary, 'footer separator missing');
  const start = boundary.index, blockStart = start + boundary[0].length;
  const after = /(?:\r?\n){2}/.exec(s.slice(marker + 1));
  const stop = after ? marker + 1 + after.index : s.length;
  const block = s.slice(blockStart, stop).split(/(?<=\n)/);
  const kept = block.filter(line => !owned.test(line.split(':')[0]));
  if (kept.length === 0) {
    const candidates = ['', '\n', '\r\n', '\n\n', '\r\n\r\n'].map(nl => s.slice(0, start) + nl + s.slice(stop));
    s = candidates.find(candidate => Buffer.from(candidate, 'latin1').equals(control)) || candidates[1];
  } else s = s.slice(0, blockStart) + kept.join('') + s.slice(stop);
  return Buffer.from(s, 'latin1');
}
function messageCommit(root, text, opts = {}) {
  const file = path.join(root, '.git/input-message'); write(file, text);
  const args = ['commit', '-q', ...(opts.args || ['-F', file])];
  return run(root, 'git', args, { env: opts.editor ? { GIT_EDITOR: opts.editor } : {} });
}
function editor(root, text, append = false) {
  const payload = path.join(root, '.git/editor-payload'); write(payload, text);
  const file = path.join(root, '.git/editor.sh');
  write(file, `#!/bin/sh\ncat '${payload}' ${append ? '>>' : '>'} "$1"\n`, 0o755); return file;
}
function compareMessage(text, cleanup, comment, policy, edit = false, replace = false) {
  const control = repo(), actual = repo(true, policy);
  for (const root of [control, actual]) {
    g(root, 'config', 'commit.cleanup', cleanup); g(root, 'config', 'core.commentChar', comment); stage(root);
  }
  report(actual);
  const options = root => ({ args: ['--cleanup=' + cleanup, ...(edit ? ['--edit'] : []), '-F', path.join(root, '.git/input-message')],
    editor: replace ? editor(root, text) : undefined });
  success(messageCommit(control, text, options(control)), 'Git control M1/M2');
  success(messageCommit(actual, text, options(actual)), 'telemetry M1/M2'); footer(actual);
  assert.deepEqual(withoutGenerated(raw(actual), raw(control)), raw(control), 'non-owned raw commit bytes differ from Git control');
  assert.equal(parsed(actual).includes('Signed-off-by: Person'), parsed(control).includes('Signed-off-by: Person'));
}
function aliasProbe(entry, relative, kind, dangling = false, check = false) {
  const root = repo(), external = path.join(temp, `sentinel-${++serial}`), dest = path.join(root, relative);
  const directory = kind === 'directory';
  if (directory) fs.mkdirSync(external); else write(external, 'SENTINEL bytes\n', 0o640);
  if (relative === '.harness/telemetry.json') write(external, JSON.stringify({ schema_version: 1, enabled: true, policy: 'advisory', fields: { elapsed_seconds: true, tokens: true, agents: true, mode: true, formal: true } }));
  if (directory && relative === '.harness') fs.cpSync(path.join(root, '.harness'), external, { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(path.dirname(dest), { recursive: true });
  const target = dangling ? external + '-absent' : external;
  if (kind === 'hard') fs.linkSync(external, dest);
  else fs.symlinkSync(kind === 'relative' ? path.relative(path.dirname(dest), target) : target, dest);
  const before = snapshot(external), link = snapshot(dest), cfg = config(root);
  const r = ['init', 'sync'].includes(entry) ? shell(root, entry, check) : cli(root, entry, ...(entry === 'report' ? ['contract'] : []));
  assert.deepEqual(snapshot(external), before, `${entry} mutated external bytes/mode/directory`);
  assert.equal(fs.existsSync(external + '-absent'), false, 'dangling target was created');
  if (kind !== 'hard') assert.deepEqual(snapshot(dest), link, 'managed link changed on refusal');
  assert.deepEqual(config(root), cfg, 'unsafe alias changed Git configuration');
  if (kind !== 'hard') assert.notEqual(r.status, 0, `unsafe ${entry} accepted: ${r.diagnostic}`);
}
function filesystem() {
  for (const entry of ['install', 'update', 'init', 'sync']) {
    probe('filesystem', `${entry} safe control`, () => {
      const root = repo(), cfg = config(root);
      success(entry === 'init' || entry === 'sync' ? shell(root, entry) : cli(root, entry), entry);
      if (entry === 'sync') { assert.deepEqual(config(root), cfg); assert.deepEqual(fs.readFileSync(path.join(root, '.harness/bin/roster-telemetry.cjs')), fs.readFileSync(source)); }
      else assert(json(cli(root, 'status')).active, 'safe entrypoint did not activate telemetry');
    });
    for (const relative of ['.harness/bin/roster-telemetry.cjs', '.harness/git-hooks/commit-msg', '.harness/bin', '.harness/git-hooks', '.harness']) {
      for (const dangling of [false, true]) probe('filesystem', `${entry} ${relative} ${dangling ? 'dangling' : 'existing'} link`,
        () => aliasProbe(entry, relative, ['.harness', '.harness/bin', '.harness/git-hooks'].includes(relative) ? 'directory' : 'file', dangling));
    }
    probe('filesystem', `${entry} runtime hard link`, () => aliasProbe(entry, '.harness/bin/roster-telemetry.cjs', 'hard'));
  }
  for (const relative of ['.harness/telemetry.json', '.harness/.local', '.git/info/exclude', '.git/info']) {
    probe('filesystem', `install direct ${relative}`, () => aliasProbe('install', relative, relative.endsWith('info') || relative.endsWith('.local') ? 'directory' : 'file'));
  }
  for (const relative of ['.harness/.local', '.harness/.local/commit-report.json']) for (const dangling of [false, true]) {
    probe('filesystem', `report ${relative} ${dangling ? 'dangling' : 'existing'}`, () => aliasProbe('report', relative, relative.endsWith('.local') ? 'directory' : 'file', dangling));
  }
  probe('filesystem', 'Git administrative exclude hard link', () => aliasProbe('install', '.git/info/exclude', 'hard'));
  probe('filesystem', 'actual hook receipt symlink rejected without target mutation', () => {
    const root = repo(true), outside = path.join(temp, `intent-${++serial}`); stage(root); report(root);
    const dest = path.join(root, '.harness/.local/commit-intent.json'); write(outside, '{}\n', 0o640); fs.symlinkSync(outside, dest);
    const before = snapshot(outside), link = snapshot(dest), r = git(root, 'commit', '-qm', 'unsafe receipt');
    assert.deepEqual(snapshot(outside), before); assert.deepEqual(snapshot(dest), link); assert.notEqual(r.status, 0);
  });
  probe('filesystem', 'managed wrapper hard link retains sentinel mode', () => {
    const root = repo(true), hook = path.join(root, '.harness/git-hooks/commit-msg'), sentinel = path.join(temp, `hook-${++serial}`);
    fs.linkSync(hook, sentinel); fs.chmodSync(sentinel, 0o640); const before = snapshot(sentinel);
    cli(root, 'install'); assert.deepEqual(snapshot(sentinel), before);
  });
  probe('filesystem', 'source runtime symlink referent immutable', () => {
    const root = repo(), link = path.join(root, '.harness/bin/roster-telemetry.cjs'), copy = path.join(temp, `source-${++serial}.js`);
    write(copy, fs.readFileSync(source, 'utf8') + '\n// outside source sentinel\n'); write(link, 'placeholder'); fs.unlinkSync(link); fs.symlinkSync(copy, link);
    const before = snapshot(copy); const r = shell(root, 'sync');
    assert.deepEqual(snapshot(copy), before); assert(fs.lstatSync(link).isSymbolicLink()); assert.notEqual(r.status, 0);
  });
}
function readonly() {
  probe('readonly', 'safe --check control', () => {
    const root = repo(); success(shell(root, 'sync'), 'sync'); success(shell(root, 'sync', true), 'check');
  });
  for (const kind of ['file', 'relative', 'directory']) probe('readonly', `copied ${kind} alias`, () => {
    // Resolve relative links from both real and copied paths by going via /tmp.
    const root = repo(); success(shell(root, 'sync'), 'sync setup');
    const relative = kind === 'directory' ? '.harness/bin' : '.harness/bin/roster-telemetry.cjs';
    const external = path.join(temp, `read-sentinel-${++serial}`), dest = path.join(root, relative);
    if (kind === 'directory') fs.mkdirSync(external); else write(external, 'READ ONLY\n', 0o640);
    fs.rmSync(dest, { recursive: true });
    const target = kind === 'relative' ? '../'.repeat(20) + external.slice(1) : external;
    fs.symlinkSync(target, dest);
    const before = snapshot(root), outside = snapshot(external), cfg = config(root);
    const r = shell(root, 'sync', true);
    assert.deepEqual(snapshot(external), outside); assert.deepEqual(snapshot(root), before); assert.deepEqual(config(root), cfg);
    assert.notEqual(r.status, 0, 'unsafe copied alias must be rejected');
  });
}
function trailers() {
  for (const policy of ['strict', 'advisory']) probe('trailers', `${policy} aliases/duplicates and field switches`, () => {
    const root = repo(true, policy); json(cli(root, 'configure', '--agents', 'false', '--tokens', 'false'));
    stage(root); report(root);
    success(messageCommit(root, 'subject\n\nDocumentation:\nHarness-Task: body-example\nEnd example.\n\nSigned-off-by: Person\nharness-task: stale\nHaRnEsS-TaSk: duplicate\nharness-agents: old-agent\nHARNESS-INPUT-TOKENS: 999\n'), 'alias commit');
    footer(root); const p = parsed(root);
    assert(!/Harness-(Agents|Input-Tokens|Output-Tokens):/i.test(p), p);
    assert(!/stale|duplicate/.test(p), p); assert(p.includes('Signed-off-by: Person'));
    assert(raw(root).includes(Buffer.from('Harness-Task: body-example\nEnd example.')));
  });
  probe('trailers', 'editor-folded mixed-case owned value refuses publication', () => {
    const root = repo(true); stage(root); report(root);
    const edit = editor(root, '\nhArNeSs-AgEnTs: implementer\n extra-agent\n', true);
    const r = messageCommit(root, 'subject\n', { args: ['--edit', '-m', 'subject'], editor: edit });
    assert.notEqual(r.status, 0); assert.notEqual(git(root, 'rev-parse', '--verify', 'HEAD').status, 0);
  });
}
function messages() {
  for (const policy of ['strict', 'advisory']) for (const comment of ['#', ';', 'auto']) {
    for (const cleanup of ['whitespace', 'verbatim', 'strip', 'scissors']) {
      probe('messages', `M1 ${policy}/${comment}/${cleanup}`, () => compareMessage('subject  \r\n\r\nBody with spaces  \r\nExample Harness-Task: body\r\n\r\nSigned-off-by: Person\r\n', cleanup, comment, policy, cleanup === 'scissors'));
    }
    probe('messages', `M2 ${policy}/${comment} edited scissors comments`, () => {
      const marker = comment === 'auto' ? '#' : comment;
      compareMessage(`subject\n\nBody.\n\n${marker} ------------------------ >8 ------------------------\n${marker} comments only\n`, 'scissors', comment, policy, true);
    });
    probe('messages', `M1 ${policy}/${comment} editor overwrites auto template`, () => compareMessage('subject from editor\n\nBody  \n', 'strip', comment, policy, true, true));
    probe('messages', `M1 ${policy}/${comment} explicit comment-prefixed -m`, () => {
      const root = repo(true, policy), control = repo();
      for (const r of [root, control]) { g(r, 'config', 'core.commentChar', comment); stage(r); }
      report(root); success(git(control, 'commit', '-qm', '# actual subject'), 'control');
      success(git(root, 'commit', '-qm', '# actual subject'), 'comment subject'); footer(root);
      assert.deepEqual(withoutGenerated(raw(root), raw(control)), raw(control));
    });
  }
  for (const policy of ['strict', 'advisory']) for (const text of ['', '# comment-only\n']) probe('messages', `M5 ${policy} ${JSON.stringify(text)}`, () => {
    const root = repo(true, policy), control = repo(); stage(root); stage(control); report(root);
    const c = messageCommit(control, text, { editor: editor(control, text), args: ['--edit', '-m', ''] });
    const r = messageCommit(root, text, { editor: editor(root, text), args: ['--edit', '-m', ''] });
    assert.notEqual(c.status, 0); assert.notEqual(r.status, 0); assert.notEqual(git(root, 'rev-parse', '--verify', 'HEAD').status, 0);
  });
  encoding(); // M3/M4/M7 are fixed conflicts, never reclassified as M1 successes.
}
function conflict(policy, type, edited = false, multi = false, cleanup = 'whitespace') {
  const root = repo(true, policy), control = repo();
  const text = type === 'H' ? 'subject\n\nBody.\n' : `subject\n\n${scissors}\nHarness-Task: supplied-raw\nnon-comment tail\n`;
  for (const r of [root, control]) {
    g(r, 'config', 'commit.cleanup', cleanup);
    if (type === 'H') g(r, 'config', multi ? 'core.commentString' : 'core.commentChar', multi ? 'Harness-' : 'H');
    stage(r);
  }
  report(root); const cfg = config(root);
  const options = r => edited ? { args: ['--edit', '-m', 'initial subject'], editor: editor(r, text) } : {};
  success(messageCommit(control, text, options(control)), 'ordinary Git conflict-layout control');
  const r = messageCommit(root, text, options(root));
  assert.deepEqual(config(root), cfg, 'encoding handling rewrote Git config');
  assert(/(?:encod|conflict|ambig|incompatib|cannot represent|unsupported)/i.test(r.diagnostic), 'missing explicit encoding-conflict diagnostic: ' + r.diagnostic);
  assert(/comment|scissors|cleanup|trailer/i.test(r.diagnostic), 'conflict diagnostic is not actionable');
  if (policy === 'strict') {
    assert.notEqual(r.status, 0); assert.notEqual(git(root, 'rev-parse', '--verify', 'HEAD').status, 0);
    if (!edited) assert(!/^Harness-Telemetry-Version:/m.test(fs.readFileSync(path.join(root, '.git/COMMIT_EDITMSG'), 'utf8')), 'conflict prepared generated telemetry');
  } else {
    success(r, 'advisory no-generation fallback'); assert.deepEqual(raw(root), raw(control));
    assert(!/^Harness-(Telemetry-Version|Metrics-Source):/m.test(raw(root).toString()), 'generated telemetry in fallback');
  }
}
function encoding() {
  for (const policy of ['strict', 'advisory']) probe('encoding', `M4 ${policy} per-field trailer alias`, () => {
    const root = repo(true, policy); g(root, 'config', 'trailer.harness-agents.key', 'Other-Agents');
    stage(root); report(root); const cfg = config(root), r = git(root, 'commit', '-qm', 'alias');
    if (policy === 'strict') assert.notEqual(r.status, 0);
    else { success(r, 'advisory per-field fallback'); assert(!/^Harness-Telemetry-Version:/m.test(raw(root).toString())); }
    assert(/encod|cannot round-trip/i.test(r.diagnostic), 'missing explicit encoding conflict: ' + r.diagnostic);
    assert.deepEqual(config(root), cfg);
  });
  for (const policy of ['strict', 'advisory']) for (const type of ['H', 'scissors']) for (const edit of [false, true]) {
    probe('encoding', `${edit ? 'M7' : type === 'H' ? 'M4' : 'M3'} ${policy} ${type}`, () => conflict(policy, type, edit));
  }
  for (const cleanup of ['verbatim', 'strip', 'scissors']) for (const policy of ['strict', 'advisory']) {
    probe('encoding', `M3 ${policy} post-scissors/${cleanup}`, () => conflict(policy, 'scissors', false, false, cleanup));
  }
  probe('encoding', 'multi-character comment support probe', () => {
    const root = repo(); stage(root); g(root, 'config', 'core.commentString', 'Harness-');
    success(messageCommit(root, 'subject\n\nHarness-comment\n', { args: ['--cleanup=strip', '-F', path.join(root, '.git/input-message')] }), 'commentString probe');
    if (raw(root).includes(Buffer.from('Harness-comment'))) { console.log('NOTE installed Git does not implement core.commentString; multi-character probe unavailable'); return; }
    for (const policy of ['strict', 'advisory']) conflict(policy, 'H', false, true);
  });
}
function commentHistory(amend) {
  probe(amend ? 'receipts' : 'reports', `semicolon history preserves ${amend ? 'amend task' : 'cumulative totals'}`, () => {
    const root = repo(true); g(root, 'config', 'core.commentChar', ';'); stage(root); report(root);
    success(messageCommit(root, 'subject\n\n; retained comment\n', { args: ['--cleanup=whitespace', '-F', path.join(root, '.git/input-message')] }), 'published comment history');
    assert(parsed(root).includes('Harness-Input-Tokens: 20\n')); const head = g(root, 'rev-parse', 'HEAD');
    if (!amend) stage(root);
    report(root, amend ? { task: 'different' } : { input_tokens: 19 });
    const r = git(root, 'commit', '-qm', 'contradiction', ...(amend ? ['--amend'] : []));
    assert.notEqual(r.status, 0, 'native historical metadata was ignored');
    assert.equal(g(root, 'rev-parse', 'HEAD'), head);
  });
}
function receipts() {
  commentHistory(true);
  probe('receipts', 'normal -C/-c and amend -m/-F/no-edit task identity', () => {
    const root = repo(true); stage(root); report(root); success(git(root, 'commit', '-qm', 'first'), 'initial commit');
    for (const flag of ['-C', '-c']) { stage(root); report(root, { task: 'reuse' + flag[1] }); success(git(root, 'commit', '-q', flag, 'HEAD'), flag); footer(root, 'reuse' + flag[1]); }
    let head = g(root, 'rev-parse', 'HEAD'); const file = path.join(root, '.git/amend-message'); write(file, 'replacement\n');
    for (const args of [['-m', 'replacement'], ['-F', file], ['--no-edit']]) {
      report(root, { task: 'different' }); assert.notEqual(git(root, 'commit', '-q', '--amend', ...args).status, 0);
      assert.equal(g(root, 'rev-parse', 'HEAD'), head); report(root, { task: 'reusec', input_tokens: 30 });
      success(git(root, 'commit', '-q', '--amend', ...args), 'legitimate amend'); footer(root, 'reusec');
      head = g(root, 'rev-parse', 'HEAD');
    }
  });
  probe('receipts', 'cancelled editor, stale reset/update-ref/worktree isolation', () => {
    const root = repo(true); stage(root); report(root); success(git(root, 'commit', '-qm', 'first'), 'first');
    const first = g(root, 'rev-parse', 'HEAD'); success(git(root, 'commit', '--allow-empty', '-qm', 'second'), 'second');
    const cancel = run(root, 'git', ['commit', '--allow-empty', '--edit', '-m', 'cancel'], { env: { GIT_EDITOR: 'false' } });
    assert.notEqual(cancel.status, 0); assert(fs.existsSync(path.join(root, '.harness/.local/commit-intent.json')));
    success(git(root, 'reset', '--hard', first), 'unrelated reset'); success(git(root, 'update-ref', 'refs/heads/unrelated', first), 'update-ref');
    success(git(root, 'worktree', 'add', '-qb', 'sibling', path.join(temp, `linked-${++serial}`)), 'worktree creation');
    write(path.join(root, '.harness/.local/commit-intent.json'), '{malformed'); stage(root); report(root);
    success(git(root, 'commit', '-qm', 'independent'), 'later independent commit');
  });
  probe('receipts', 'M6 disabled ignores malformed receipt and report byte-for-byte', () => {
    const root = repo(true); json(cli(root, 'configure', '--enabled', 'false'));
    for (const n of ['commit-intent', 'commit-report']) write(path.join(root, `.harness/.local/${n}.json`), 'malformed');
    const before = snapshot(path.join(root, '.harness/.local')); stage(root);
    success(git(root, 'commit', '-qm', 'disabled'), 'disabled commit'); assert.deepEqual(snapshot(path.join(root, '.harness/.local')), before);
    assert(!raw(root).includes(Buffer.from('Harness-')));
  });
}
function reports() {
  commentHistory(false);
  for (const policy of ['strict', 'advisory']) probe('reports', `${policy} null/zero/toggles/stale/cumulative`, () => {
    const root = repo(true, policy); stage(root); report(root, { input_tokens: null, output_tokens: null, elapsed_seconds: null, agents: null, mode: null, formal: { status: 'unavailable', backend: null } });
    let r = git(root, 'commit', '-qm', 'null');
    if (policy === 'strict') assert.notEqual(r.status, 0); else { success(r, 'advisory null'); assert(!/Harness-(Input-Tokens|Output-Tokens|Elapsed-Seconds|Agents|Mode|Formal):/.test(parsed(root))); }
    stage(root); // Advisory null succeeded above; genuine zero needs a new staged commit.
    report(root, { input_tokens: 0, output_tokens: 0, elapsed_seconds: 0 }); success(git(root, 'commit', '-qm', 'zero'), 'genuine zero');
    assert(parsed(root).includes('Harness-Input-Tokens: 0\n')); stage(root); report(root); stage(root);
    r = git(root, 'commit', '-qm', 'stale');
    if (policy === 'strict') assert.notEqual(r.status, 0); else { success(r, 'advisory stale'); assert(!/Harness-Telemetry-Version:/.test(parsed(root))); stage(root); }
    report(root, { input_tokens: 30 }); success(git(root, 'commit', '-qm', 'totals'), 'cumulative commit');
    assert(parsed(root).includes('Harness-Input-Tokens: 30\n')); stage(root); report(root, { input_tokens: 29 });
    r = git(root, 'commit', '-qm', 'decrease'); if (policy === 'strict') assert.notEqual(r.status, 0); else { success(r, 'advisory decrease omission'); assert(!/Harness-Telemetry-Version:/.test(parsed(root))); }
    json(cli(root, 'configure', '--tokens', 'false', '--elapsed_seconds', 'false', '--agents', 'false', '--mode', 'false', '--formal', 'false'));
    stage(root); report(root, { input_tokens: null, output_tokens: null, elapsed_seconds: null }); success(git(root, 'commit', '-qm', 'fields'), 'disabled strict requirements');
    assert(!/Harness-(Input-Tokens|Output-Tokens|Elapsed-Seconds|Agents|Mode|Formal):/i.test(parsed(root)));
  });
  for (const policy of ['strict', 'advisory']) for (const invalid of ['absent', 'harness']) probe('reports', `${policy} ${invalid} report`, () => {
    const root = repo(true, policy); stage(root); if (invalid === 'harness') report(root, { harness_version: '0.0.0' });
    const r = git(root, 'commit', '-qm', 'unavailable measurement');
    if (policy === 'strict') assert.notEqual(r.status, 0); else { success(r, 'advisory unavailable'); assert(!/Harness-/.test(parsed(root))); }
  });
  for (const policy of ['strict', 'advisory']) probe('reports', `M4 ${policy} incompatible trailer grammar`, () => {
    const root = repo(true, policy); stage(root); report(root); g(root, 'config', 'trailer.separators', '=');
    const r = git(root, 'commit', '-qm', 'subject');
    if (policy === 'strict') {
      assert.notEqual(r.status, 0); assert.notEqual(git(root, 'rev-parse', '--verify', 'HEAD').status, 0);
    } else {
      success(r, 'advisory M4 fallback');
      assert(!/^Harness-Telemetry-Version:/m.test(raw(root).toString()), 'incompatible grammar generated telemetry');
    }
    assert(/trailer|encod|conflict|metadata/i.test(r.diagnostic), r.diagnostic);
  });
  for (const policy of ['strict', 'advisory']) probe('reports', `M8 ${policy} editor changes prepared owned metadata`, () => {
    const root = repo(true, policy); stage(root); report(root);
    const edit = path.join(root, '.git/contradict-editor.sh');
    write(edit, '#!/bin/sh\nsed "s/Harness-Input-Tokens: 20/Harness-Input-Tokens: 999/" "$1" > "$1.new"\nmv "$1.new" "$1"\n', 0o755);
    const r = messageCommit(root, 'subject\n', { args: ['--edit', '-m', 'subject'], editor: edit });
    assert.notEqual(r.status, 0, 'prepared contradiction was published'); assert.notEqual(git(root, 'rev-parse', '--verify', 'HEAD').status, 0);
    assert(/trailer|metadata|contradic/i.test(r.diagnostic), r.diagnostic);
  });
}
function distribution() {
  probe('distribution', 'installed-only ESM repair/disable/update/status/fields and actual hooks', () => {
    const root = repo(); write(path.join(root, 'package.json'), '{"type":"module"}\n');
    write(path.join(root, '.harness/bin/neighbor.js'), 'export default 42;\n');
    fs.copyFileSync(source, path.join(root, '.harness/bin/roster-telemetry.cjs'));
    const before = snapshot(path.join(root, 'package.json')), neighbor = snapshot(path.join(root, '.harness/bin/neighbor.js'));
    success(installed(root, 'install'), 'installed install'); assert(json(installed(root, 'status')).active);
    assert.equal(json(installed(root, 'status')).version, setup(installed(root, 'version'), 'version').stdout.toString().trim());
    fs.chmodSync(path.join(root, '.harness/git-hooks/commit-msg'), 0o644); assert(!json(installed(root, 'status')).active);
    success(installed(root, 'install'), 'repair'); success(installed(root, 'configure', '--enabled', 'false'), 'disable');
    success(installed(root, 'update'), 'disabled update'); assert.equal(json(installed(root, 'status')).config.enabled, false);
    success(installed(root, 'configure', '--enabled', 'true', '--agents', 'false'), 'fields'); stage(root); report(root);
    success(git(root, 'commit', '-qm', 'ESM'), 'installed hooks'); footer(root); assert(!/Harness-Agents:/i.test(parsed(root)));
    assert.deepEqual(snapshot(path.join(root, 'package.json')), before); assert.deepEqual(snapshot(path.join(root, '.harness/bin/neighbor.js')), neighbor);
    const module = run(root, process.execPath, ['--input-type=module', '-e', 'import value from "./.harness/bin/neighbor.js"; if (value !== 42) process.exit(1);']);
    success(module, 'neighbor retains ESM semantics');
    const sibling = path.join(temp, `esm-linked-${++serial}`); success(git(root, 'worktree', 'add', '-qb', 'linked', sibling), 'linked worktree');
    write(path.join(sibling, '.harness/harness.json'), '{"version":"1.0.0"}'); success(cli(sibling, 'install'), 'sibling install');
    assert.equal(g(root, 'config', '--get', 'core.hooksPath'), path.join(root, '.harness/git-hooks'));
    assert.equal(g(sibling, 'config', '--get', 'core.hooksPath'), path.join(sibling, '.harness/git-hooks'));
  });
  probe('distribution', 'default init activates and repair preserves explicit disable', () => {
    const root = repo(); success(shell(root, 'init'), 'default init'); assert(json(installed(root, 'status')).active);
    success(installed(root, 'configure', '--enabled', 'false'), 'disable'); success(shell(root, 'init'), 'init repair');
    assert.equal(json(installed(root, 'status')).config.enabled, false);
    stage(root); success(git(root, 'commit', '-qm', 'disabled init repair'), 'disabled hooks'); assert(!/Harness-/.test(raw(root).toString()));
  });
  for (const active of [false, true]) probe('distribution', `${active ? 'already active' : 'inactive'} target hook is not silently adopted`, () => {
    const root = repo(active, 'advisory'), hook = path.join(root, '.harness/git-hooks/pre-commit');
    write(hook, '#!/bin/sh\nexit 42\n', 0o755);
    const before = snapshot(hook), cfg = config(root), r = cli(root, 'install');
    if (active) success(r, 'preserve already active hook');
    else assert.notEqual(r.status, 0, 'install silently activated an unrelated target hook');
    assert.deepEqual(snapshot(hook), before); assert.deepEqual(config(root), cfg);
  });
  for (const inherited of [false, true]) probe('distribution', `${inherited ? 'inherited' : 'native'} custom hooks preserved`, () => {
    const root = repo(inherited, 'advisory'); stage(root); success(git(root, 'commit', '-qm', 'base'), 'base');
    const directory = path.join(root, inherited ? '.harness/git-hooks' : '.git/hooks');
    write(path.join(directory, 'pre-commit'), '#!/bin/sh\nexit 42\n', 0o755);
    let consumer = root;
    if (inherited) {
      g(root, 'config', '--local', 'core.hooksPath', directory); consumer = path.join(temp, `custom-linked-${++serial}`);
      success(git(root, 'worktree', 'add', '-qb', 'custom', consumer), 'custom sibling');
      write(path.join(consumer, '.harness/harness.json'), '{"version":"1.0.0"}');
    }
    const before = snapshot(directory), cfg = config(consumer); assert.notEqual(cli(consumer, 'install').status, 0);
    assert.deepEqual(snapshot(directory), before); assert.deepEqual(config(consumer), cfg);
    stage(consumer); assert.notEqual(git(consumer, 'commit', '-qm', 'blocked').status, 0);
  });
}
function main() {
  const selected = process.argv.slice(2); if (!selected.length) selected.push(...names);
  if (selected.some(n => !names.includes(n))) throw new SetupError(`Cases: ${names.join(', ')}`);
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-contract-'));
  try {
    write(path.join(temp, 'global'), ''); fs.mkdirSync(path.join(temp, 'home')); fs.mkdirSync(path.join(temp, 'codex'));
    for (const tool of ['curl', 'wget', 'npm', 'npx', 'yarn', 'pnpm', 'corepack', 'ssh', 'scp', 'nc']) {
      write(path.join(temp, 'offline', tool), `#!/bin/sh\nprintf '%s\\n' "$0" >> '${path.join(temp, 'network-attempts')}'\necho 'Forbidden network/package tool invocation' >&2\nexit 97\n`, 0o755);
    }
    const original = snapshot(source), global = snapshot(path.join(temp, 'global'));
    console.log(`Node ${process.version}; ${setup(run(temp, 'git', ['--version']), 'Git prerequisite').stdout.toString().trim()}; fixtures ${temp}`);
    setup(run(temp, 'node', ['--version']), 'Node hook prerequisite');
    setup(run(temp, 'bash', ['--version']), 'bash prerequisite'); setup(run(temp, 'jq', ['--version']), 'jq prerequisite');
    // A missing dependency or subprocess capture is never counted as a pass.
    for (const file of ['scripts/roster-telemetry.js', 'scripts/init-harness.sh', 'scripts/sync-harness.sh']) fs.accessSync(path.join(base, file));
    const cases = { filesystem, readonly, trailers, messages, encoding, receipts, reports, distribution };
    for (const name of selected) cases[name]();
    probe('distribution', 'source/global immutable', () => {
      assert.deepEqual(snapshot(source), original); assert.deepEqual(snapshot(path.join(temp, 'global')), global);
      assert.equal(fs.existsSync(path.join(temp, 'network-attempts')), false, 'network/package executable invoked');
    });
    for (const group of [...new Set(results.map(r => r.group))]) {
      const rows = results.filter(r => r.group === group);
      console.log(`SUMMARY ${group}: ${['PASS', 'ASSERTION', 'ERROR'].map(k => `${rows.filter(r => r.result === k).length} ${k}`).join(', ')}`);
    }
    return results.some(r => r.result === 'ERROR') ? 2 : results.some(r => r.result === 'ASSERTION') ? 1 : 0;
  } catch (e) {
    console.error(`ERROR (inconclusive setup): ${e.stack}`);
    for (const name of selected) console.log(`SUMMARY ${name}: ERROR (setup prevented execution)`);
    return 2;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
try { process.exitCode = main(); } catch (e) { console.error(`ERROR (inconclusive): ${e.stack}`); process.exitCode = 2; }

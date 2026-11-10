#!/usr/bin/env node
'use strict';
// Project-local consistency checks, not provider authentication or a security boundary.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const VERSION = '1.0.0';
const RUNTIME = '.harness/bin/roster-telemetry.cjs';
const DEFAULTS = { schema_version: 1, enabled: true, policy: 'advisory', fields: { elapsed_seconds: true, tokens: true, agents: true, mode: true, formal: true } };
const OWNED_FIELD = /^Harness-(?:Telemetry-Version|Version|Task|Elapsed-Seconds|Input-Tokens|Output-Tokens|Agents|Mode|Formal|Metrics-Source)$/;
const NAMES = ['prepare-commit-msg', 'commit-msg', 'reference-transaction'];
const safe = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
function fail(message) { throw new Error(message); }
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function optional(root, ...args) { try { return git(root, ...args); } catch (e) { if (e.status === 1 || e.status === 128) return null; throw e; } }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + `.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function config(root) {
  const file = path.join(root, '.harness/telemetry.json');
  const c = fs.existsSync(file) ? read(file) : structuredClone(DEFAULTS);
  if (!c || c.schema_version !== 1 || typeof c.enabled !== 'boolean' || !['advisory', 'strict'].includes(c.policy) || !c.fields || Object.keys(c).sort().join() !== 'enabled,fields,policy,schema_version' || Object.keys(c.fields).sort().join() !== Object.keys(DEFAULTS.fields).sort().join() || Object.values(c.fields).some(v => typeof v !== 'boolean')) fail('Invalid telemetry configuration; repair explicitly, not by resetting preferences');
  return c;
}
function hookBytes(name) {
  const action = { 'prepare-commit-msg': 'prepare', 'commit-msg': 'validate', 'reference-transaction': 'transaction' }[name];
  const preflight = name === 'reference-transaction' ? `root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0\n[ -f "$root/${RUNTIME}" ] || exit 0` : 'root=$(git rev-parse --show-toplevel)';
  return `#!/bin/sh\n# roster-telemetry managed v1\nset -eu\n${preflight}\nexec node "$root/${RUNTIME}" ${action} "$@" --root "$root"\n`;
}
function managedHook(name, text) {
  if (text === hookBytes(name)) return true;
  if (name === 'reference-transaction') return false;
  const legacy = hookBytes(name).replace(RUNTIME, '.harness/bin/roster-telemetry.js');
  return text === legacy;
}
function status(root) {
  const c = config(root);
  const target = path.join(root, '.harness/git-hooks');
  const configured = optional(root, 'config', '--get', 'core.hooksPath');
  const hooksOk = NAMES.every(name => {
    try { const f = path.join(target, name); return fs.readFileSync(f, 'utf8') === hookBytes(name) && Boolean(fs.statSync(f).mode & 0o111); } catch { return false; }
  });
  const probe = spawnSync(process.execPath, [path.join(root, RUNTIME), 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const installedVersion = probe.status === 0 ? probe.stdout.trim() : null;
  return { version: VERSION, installed_version: installedVersion, config: c, hooks_path: configured, active: c.enabled && configured !== null && path.resolve(root, configured) === target && hooksOk && installedVersion === VERSION };
}
function rejectLinks(root) {
  for (const relative of ['.harness', '.harness/bin', RUNTIME, '.harness/git-hooks', ...NAMES.map(n => '.harness/git-hooks/' + n)]) {
    const file = path.join(root, relative);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail(`Refusing managed symlink: ${relative}`);
  }
}
function checkHookDirectory(directory, allowManaged) {
  for (const name of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
    if (name.endsWith('.sample')) continue;
    const file = path.join(directory, name);
    const stat = fs.statSync(file);
    const managed = allowManaged && NAMES.includes(name) && stat.isFile() && managedHook(name, fs.readFileSync(file, 'utf8'));
    if (!managed && (stat.mode & 0o111)) fail(`Hook conflict: existing ${file}; integrate manually`);
  }
}
function checkInstallation(root) {
  if (!fs.existsSync(path.join(root, '.harness/harness.json'))) fail('Missing .harness/harness.json');
  if (fs.realpathSync(git(root, 'rev-parse', '--show-toplevel')) !== root) fail('--root must be the Git worktree root');
  rejectLinks(root);
  const scoped = optional(root, 'config', '--local', '--bool', '--get', 'extensions.worktreeConfig') === 'true';
  if (!scoped && (optional(root, 'config', '--local', '--bool', '--get', 'core.bare') === 'true' || optional(root, 'config', '--local', '--get', 'core.worktree') !== null)) fail('Migrate core.bare/core.worktree before enabling worktreeConfig; no configuration changed');
  const target = path.join(root, '.harness/git-hooks');
  const configured = optional(root, 'config', '--get', 'core.hooksPath');
  const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir'));
  const native = configured === null || path.resolve(root, configured) === path.join(common, 'hooks');
  if (native) checkHookDirectory(path.join(common, 'hooks'), false);
  if (configured !== null && path.resolve(root, configured) !== target && !native) {
    const siblings = git(root, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9));
    const inherited = siblings.some(p => p !== root && path.resolve(root, configured) === path.join(p, '.harness/git-hooks') && NAMES.slice(0, 2).every(n => {
      try { return managedHook(n, fs.readFileSync(path.join(p, '.harness/git-hooks', n), 'utf8')); } catch { return false; }
    }));
    if (!inherited) fail(`Hook conflict: core.hooksPath=${configured}; integrate manually`);
    checkHookDirectory(path.resolve(root, configured), true);
  }
  for (const name of NAMES) {
    const file = path.join(target, name);
    if (fs.existsSync(file) && !managedHook(name, fs.readFileSync(file, 'utf8'))) fail(`Hook conflict: modified ${file}; integrate manually`);
    if (native && fs.existsSync(path.join(common, 'hooks', name))) fail(`Hook conflict: existing native ${name}; integrate manually`);
  }
  return target;
}
function install(root) {
  const c = config(root);
  if (!c.enabled) return status(root);
  const target = checkInstallation(root);
  fs.mkdirSync(path.join(root, '.harness/bin'), { recursive: true });
  const runtime = path.join(root, RUNTIME);
  if (path.resolve(__filename) !== runtime) fs.copyFileSync(__filename, runtime);
  fs.mkdirSync(target, { recursive: true });
  for (const name of NAMES) {
    const file = path.join(target, name);
    fs.writeFileSync(file, hookBytes(name), { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
  save(path.join(root, '.harness/telemetry.json'), c);
  const exclude = path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!text.split('\n').includes('/.harness/.local/')) fs.appendFileSync(exclude, '\n/.harness/.local/\n');
  git(root, 'config', '--local', 'extensions.worktreeConfig', 'true');
  git(root, 'config', '--worktree', 'core.hooksPath', target);
  const result = status(root);
  if (!result.active) fail('Hooks written but activation verification failed');
  return result;
}
// Only the final trailer paragraph is metadata. Preserve body examples and the
// suffix Git may strip (comments/scissors); insert metadata BEFORE that suffix.
function messageParts(message, comment = '#') {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  let end = lines.findIndex(l => l === `${comment} ------------------------ >8 ------------------------`);
  if (end < 0) end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || lines[end - 1].startsWith(comment))) end--;
  // A subject beginning with the comment character is still a subject for -m.
  if (end === 0 && lines.some(line => line.trim())) end = lines.length;
  let start = end;
  while (start > 0 && lines[start - 1].trim()) start--;
  const paragraph = lines.slice(start, end);
  let continuation = false;
  const trailers = start > 0 && paragraph.length > 0 && paragraph.every(line => {
    if (/^[A-Za-z0-9][A-Za-z0-9-]*:[ \t]*.*$/.test(line)) { continuation = true; return true; }
    return continuation && /^[ \t]+\S/.test(line);
  });
  return { lines, start: trailers ? start : end, end };
}
function fields(message, comment) {
  const parts = messageParts(message, comment);
  const out = {};
  let previousOwned = false;
  for (const line of parts.lines.slice(parts.start, parts.end)) {
    if (/^[ \t]/.test(line) && previousOwned) fail('Owned trailers cannot have folded continuation lines');
    const match = line.match(/^([^:]+):[ \t]*(.*)$/);
    previousOwned = Boolean(match && OWNED_FIELD.test(match[1]));
    if (!previousOwned) continue;
    if (match[1] in out) fail(`Duplicate ${match[1]}`);
    out[match[1]] = match[2].trim();
  }
  return out;
}
function replaceTrailers(message, expected, comment) {
  const parts = messageParts(message, comment);
  let owned = false;
  const retained = parts.lines.slice(parts.start, parts.end).filter(line => {
    const match = line.match(/^([^:]+):/);
    if (match) owned = OWNED_FIELD.test(match[1]);
    return !owned;
  });
  const body = parts.lines.slice(0, parts.start).join('\n').trimEnd();
  const footer = [...retained, ...Object.entries(expected).map(([key, value]) => `${key}: ${value}`)].join('\n');
  const suffix = parts.lines.slice(parts.end).join('\n');
  return body + (footer ? '\n\n' + footer : '') + (suffix.trim() ? '\n\n' + suffix : '\n');
}
function validateReport(root, value, c) {
  const required = ['schema_version', 'task', 'harness_version', 'staged_tree', 'elapsed_seconds', 'input_tokens', 'output_tokens', 'agents', 'mode', 'formal'];
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== required.sort().join() || value.schema_version !== 1 || !safe(value.task)) fail('Invalid report schema or task');
  const version = read(path.join(root, '.harness/harness.json')).version;
  if (value.harness_version !== version || !safe(version)) fail('Report harness version differs from current manifest');
  if (value.staged_tree !== git(root, 'write-tree')) fail('Stale report: staged_tree differs from index');
  for (const key of ['elapsed_seconds', 'input_tokens', 'output_tokens']) if (value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < 0)) fail(`Invalid ${key}`);
  if (value.agents !== null && (!Array.isArray(value.agents) || value.agents.length > 100 || value.agents.some(v => !safe(v)) || new Set(value.agents).size !== value.agents.length)) fail('Invalid agents');
  if (value.mode !== null && !['express', 'fast', 'full'].includes(value.mode)) fail('Invalid mode');
  const formal = value.formal;
  if (!formal || Object.keys(formal).sort().join() !== 'backend,status' || !['not-used', 'specified', 'verified', 'unavailable'].includes(formal.status) || ![null, 'rocq', 'quint'].includes(formal.backend) || (['specified', 'verified'].includes(formal.status) && !formal.backend) || (formal.status === 'not-used' && formal.backend !== null)) fail('Invalid formal status');
  if (c.policy === 'strict') {
    if (c.fields.elapsed_seconds && value.elapsed_seconds === null) fail('Elapsed measurement unavailable');
    if (c.fields.tokens && (value.input_tokens === null || value.output_tokens === null)) fail('Token measurements unavailable');
  }
  const head = optional(root, 'log', '-1', '--format=%B');
  if (head) {
    const old = fields(head);
    if (old['Harness-Task'] === value.task) for (const [key, field] of [['Harness-Elapsed-Seconds', 'elapsed_seconds'], ['Harness-Input-Tokens', 'input_tokens'], ['Harness-Output-Tokens', 'output_tokens']]) {
      if (old[key] !== undefined && value[field] !== null && value[field] < Number(old[key])) fail(`${field} must be cumulative and cannot decrease`);
    }
  }
  return value;
}
function block(value, c) {
  const out = { 'Harness-Telemetry-Version': VERSION, 'Harness-Version': value.harness_version, 'Harness-Task': value.task, 'Harness-Metrics-Source': 'agent-reported-cumulative' };
  if (c.fields.elapsed_seconds && value.elapsed_seconds !== null) out['Harness-Elapsed-Seconds'] = String(value.elapsed_seconds);
  if (c.fields.tokens) {
    if (value.input_tokens !== null) out['Harness-Input-Tokens'] = String(value.input_tokens);
    if (value.output_tokens !== null) out['Harness-Output-Tokens'] = String(value.output_tokens);
  }
  if (c.fields.agents && value.agents !== null && value.agents.length) out['Harness-Agents'] = value.agents.join(',');
  if (c.fields.mode && value.mode !== null) out['Harness-Mode'] = value.mode;
  if (c.fields.formal && value.formal.status !== 'unavailable') out['Harness-Formal'] = value.formal.status + (value.formal.backend ? ':' + value.formal.backend : '');
  return out;
}
function canonical(value) { return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))); }
function commentMarker(root, message = '') {
  const configured = optional(root, 'config', '--get', 'core.commentString') || optional(root, 'config', '--get', 'core.commentChar') || '#';
  if (configured !== 'auto') return configured;
  const scissors = message.match(/^(.+) ------------------------ >8 ------------------------$/m);
  if (scissors) return scissors[1];
  const last = message.trimEnd().split('\n').at(-1) || '';
  const candidates = '#;@!$%^&|:';
  if (candidates.includes(last[0]) && last.length > 1) return last[0];
  return [...candidates].find(c => !message.split('\n').some(line => line.startsWith(c))) || '#';
}
function invocation() {
  let start = null;
  try {
    const stat = fs.readFileSync(`/proc/${process.ppid}/stat`, 'utf8');
    start = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19];
  } catch { /* Non-procfs platforms retain the immediate parent PID binding. */ }
  return { pid: process.ppid, start };
}
function intentPath(root) { return path.join(root, '.harness/.local/commit-intent.json'); }
function hook(root, action, file, source) {
  const c = config(root);
  if (!c.enabled) return;
  if (!file) fail('Commit message path required');
  const message = fs.readFileSync(file, 'utf8');
  const comment = commentMarker(root, message);
  const hasContent = message.split('\n').some(line => line.trim() && !line.startsWith(comment));
  if (!message.trim() || (!hasContent && source !== 'message')) {
    fs.rmSync(intentPath(root), { force: true });
    return; // Never turn an empty/abandoned commit into a metadata-only commit.
  }
  try {
    const value = validateReport(root, read(path.join(root, '.harness/.local/commit-report.json')), c);
    const expected = block(value, c);
    if (action === 'prepare' || (!fs.existsSync(intentPath(root)) && Object.keys(fields(message, comment)).length === 0)) {
      fs.writeFileSync(file, replaceTrailers(message, expected, comment));
    } else if (canonical(fields(message, comment)) !== canonical(expected)) fail('Commit trailers do not match current report/config');
    save(intentPath(root), { parent: invocation(), head: optional(root, 'rev-parse', '--verify', 'HEAD') || '0'.repeat(value.staged_tree.length), tree: value.staged_tree, expected });
  } catch (error) {
    fs.rmSync(intentPath(root), { force: true });
    if (c.policy === 'strict') throw error;
    console.error(`roster-telemetry: advisory — ${error.message}; metrics unavailable`);
    fs.writeFileSync(file, replaceTrailers(message, {}, comment));
  }
}
// Git exposes message reuse, not amend intent, to prepare-commit-msg. Inspect
// the final commit's parent relation before its ref is published instead.
function transaction(root, event) {
  if (!['prepared', 'committed', 'aborted'].includes(event)) return;
  const file = intentPath(root);
  if (!fs.existsSync(file)) return;
  const c = config(root);
  if (!c.enabled) return;
  let intent;
  try { intent = read(file); } catch { return; }
  const parent = invocation();
  if (!intent || intent.parent?.pid !== parent.pid || intent.parent?.start !== parent.start) return;
  const refs = fs.readFileSync(0, 'utf8').trim().split('\n').map(line => line.split(' '));
  const current = optional(root, 'symbolic-ref', '-q', 'HEAD') || 'HEAD';
  const update = refs.find(([old, next, ref]) => old === intent.head && (ref === current || ref === 'HEAD') && /^[0-9a-f]+$/.test(next) && !/^0+$/.test(next));
  if (!update) return;
  if (event !== 'prepared') { fs.rmSync(file, { force: true }); return; }
  // Missing measurements remain advisory. Once metadata was prepared, neither
  // policy may publish a known contradiction discovered after Git cleanup.
  const [old, next] = update;
  if (git(root, 'show', '-s', '--format=%T', next) !== intent.tree) return;
  const message = git(root, 'show', '-s', '--format=%B', next);
  if (canonical(fields(message, commentMarker(root, message))) !== canonical(intent.expected)) fail('Final commit trailers changed during Git cleanup');
  const parents = git(root, 'show', '-s', '--format=%P', next).split(' ');
  if (!/^0+$/.test(old) && parents[0] !== old) {
    const previous = fields(git(root, 'show', '-s', '--format=%B', old));
    if (previous['Harness-Task'] && previous['Harness-Task'] !== intent.expected['Harness-Task']) fail('Amend must preserve Harness-Task');
  }
}
function configure(root, args) {
  const c = config(root);
  if (!args.length || args.length % 2) fail('configure requires --setting value pairs');
  for (let j = 0; j < args.length; j += 2) {
    const key = args[j].replace(/^--/, '');
    const value = args[j + 1];
    if (key === 'policy') {
      if (!['strict', 'advisory'].includes(value)) fail('Invalid policy');
      c.policy = value;
    } else {
      if (!['true', 'false'].includes(value) || (key !== 'enabled' && !Object.hasOwn(DEFAULTS.fields, key))) fail(`Invalid setting ${key}`);
      if (key === 'enabled') c.enabled = value === 'true'; else c.fields[key] = value === 'true';
    }
  }
  if (c.enabled) checkInstallation(root);
  save(path.join(root, '.harness/telemetry.json'), c);
  return c.enabled ? install(root) : status(root);
}
function report(root, task) {
  if (!safe(task)) fail('report requires a safe task identifier');
  const file = path.join(root, '.harness/.local/commit-report.json');
  if (fs.existsSync(file)) fail('Report exists; update it explicitly with cumulative task evidence');
  const value = { schema_version: 1, task, harness_version: read(path.join(root, '.harness/harness.json')).version, staged_tree: git(root, 'write-tree'), elapsed_seconds: null, input_tokens: null, output_tokens: null, agents: null, mode: null, formal: { status: 'unavailable', backend: null } };
  save(file, value);
  return value;
}
function main(argv) {
  const args = [...argv];
  const i = args.indexOf('--root');
  let root = i >= 0 ? args[i + 1] : null;
  if (i >= 0) args.splice(i, 2);
  const action = args.shift() || 'status';
  if (action === 'version') { console.log(VERSION); return; }
  root = fs.realpathSync(root || git(process.cwd(), 'rev-parse', '--show-toplevel'));
  if (action === 'prepare' || action === 'validate') { hook(root, action, args[0], args[1]); return; }
  if (action === 'transaction') { transaction(root, args[0]); return; }
  let result;
  if (action === 'install' || action === 'update') result = install(root);
  else if (action === 'status') result = status(root);
  else if (action === 'configure') result = configure(root, args);
  else if (action === 'report' && args.length === 1) result = report(root, args[0]);
  else fail(`Unknown action or arguments: ${action}`);
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`roster-telemetry: ${error.message}`); process.exitCode = 1; }
}
module.exports = { VERSION, DEFAULTS, validateReport, block, fields };

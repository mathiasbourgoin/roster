#!/usr/bin/env node
'use strict';
// Dependency-free, project-local telemetry. No network or provider authentication.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const VERSION = '1.0.0';
const DEFAULTS = { schema_version: 1, enabled: true, policy: 'advisory', fields: { elapsed_seconds: true, tokens: true, agents: true, mode: true, formal: true } };
const KEYS = ['Harness-Telemetry-Version', 'Harness-Version', 'Harness-Task', 'Harness-Elapsed-Seconds', 'Harness-Input-Tokens', 'Harness-Output-Tokens', 'Harness-Agents', 'Harness-Mode', 'Harness-Formal', 'Harness-Metrics-Source'];
const OWNED = /^(Harness-(?:Telemetry-Version|Version|Task|Elapsed-Seconds|Input-Tokens|Output-Tokens|Agents|Mode|Formal|Metrics-Source)):.*$/gm;
const safe = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
function fail(message) { throw new Error(message); }
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function optional(root, ...args) { try { return git(root, ...args); } catch (e) { if (e.status === 1 || e.status === 128) return null; throw e; } }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + `.tmp-${process.pid}`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
function config(root) {
  const file = path.join(root, '.harness/telemetry.json');
  const c = fs.existsSync(file) ? read(file) : structuredClone(DEFAULTS);
  if (c.schema_version !== 1 || typeof c.enabled !== 'boolean' || !['advisory', 'strict'].includes(c.policy) || !c.fields || Object.keys(c).sort().join() !== 'enabled,fields,policy,schema_version' || Object.keys(c.fields).sort().join() !== Object.keys(DEFAULTS.fields).sort().join() || Object.values(c.fields).some(v => typeof v !== 'boolean')) fail('Invalid telemetry configuration; repair explicitly, not by resetting preferences');
  return c;
}
function wrapper() { return '#!/bin/sh\n# roster-telemetry managed v1\nset -eu\nroot=$(git rev-parse --show-toplevel)\nexec node "$root/.harness/bin/roster-telemetry.js" HOOK "$@" --root "$root"\n'; }
function hookBytes(name) { return wrapper().replace('HOOK', name === 'prepare-commit-msg' ? 'prepare' : 'validate'); }
const NAMES = ['prepare-commit-msg', 'commit-msg'];
function status(root) {
  const c = config(root); const target = path.join(root, '.harness/git-hooks');
  const configured = optional(root, 'config', '--get', 'core.hooksPath');
  const hooksOk = NAMES.every(name => { try { const f = path.join(target, name); return fs.readFileSync(f, 'utf8') === hookBytes(name) && Boolean(fs.statSync(f).mode & 0o111); } catch { return false; } });
  const probe = spawnSync(process.execPath, [path.join(root, '.harness/bin/roster-telemetry.js'), 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const installedVersion = probe.status === 0 ? probe.stdout.trim() : null;
  return { version: VERSION, installed_version: installedVersion, config: c, hooks_path: configured, active: c.enabled && configured !== null && path.resolve(root, configured) === target && hooksOk && installedVersion === VERSION };
}
function moduleScope(root) {
  const directory = path.join(root, '.harness/bin');
  const file = path.join(directory, 'package.json');
  if (fs.existsSync(file)) { if (read(file).type !== 'commonjs') fail('Incompatible .harness/bin/package.json; integrate module scope manually'); return; }
  function inspect(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) inspect(candidate);
      else if (entry.name.endsWith('.js') && (candidate !== path.join(directory, 'roster-telemetry.js') || fs.readFileSync(candidate, 'utf8') !== fs.readFileSync(__filename, 'utf8'))) fail(`Refusing CommonJS scope over unrelated consumer script: ${candidate}`);
    }
  }
  inspect(directory);
  save(file, { type: 'commonjs' });
}
function install(root) {
  const c = config(root);
  if (!c.enabled) return status(root);
  if (!fs.existsSync(path.join(root, '.harness/harness.json'))) fail('Missing .harness/harness.json');
  if (fs.realpathSync(git(root, 'rev-parse', '--show-toplevel')) !== root) fail('--root must be the Git worktree root');
  const target = path.join(root, '.harness/git-hooks');
  const configured = optional(root, 'config', '--get', 'core.hooksPath');
  const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir'));
  const nativePath = configured && path.resolve(root, configured) === path.join(common, 'hooks');
  if (configured && !nativePath && path.resolve(root, configured) !== target) {
    const siblings = git(root, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9));
    const inherited = siblings.some(p => p !== root && path.resolve(root, configured) === path.join(p, '.harness/git-hooks') && NAMES.every(n => { try { return fs.readFileSync(path.join(p, '.harness/git-hooks', n), 'utf8') === hookBytes(n); } catch { return false; } }));
    if (!inherited) fail(`Hook conflict: core.hooksPath=${configured}; integrate manually`);
  }
  if (!configured || nativePath) {
    const directory = path.join(common, 'hooks');
    for (const name of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
      if (name.endsWith('.sample')) continue;
      const candidate = path.join(directory, name);
      if (fs.statSync(candidate).mode & 0o111) fail(`Hook conflict: existing ${candidate}; integrate manually`);
    }
  }
  for (const name of NAMES) {
    const old = path.join(common, 'hooks', name);
    if ((!configured || nativePath) && fs.existsSync(old)) fail(`Hook conflict: existing ${old}; integrate manually`);
    const dest = path.join(target, name);
    if (fs.existsSync(dest) && fs.readFileSync(dest, 'utf8') !== hookBytes(name)) fail(`Hook conflict: modified ${dest}; integrate manually`);
  }
  moduleScope(root);
  fs.mkdirSync(path.join(root, '.harness/bin'), { recursive: true });
  const runtime = path.join(root, '.harness/bin/roster-telemetry.js');
  if (path.resolve(__filename) !== runtime) fs.copyFileSync(__filename, runtime);
  fs.mkdirSync(target, { recursive: true });
  for (const name of NAMES) { const f = path.join(target, name); fs.writeFileSync(f, hookBytes(name), { mode: 0o755 }); fs.chmodSync(f, 0o755); }
  save(path.join(root, '.harness/telemetry.json'), c);
  // Ignore all local evidence, without editing the project's tracked .gitignore.
  const exclude = path.resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (!text.split('\n').includes('/.harness/.local/')) fs.appendFileSync(exclude, '\n/.harness/.local/\n');
  git(root, 'config', '--local', 'extensions.worktreeConfig', 'true');
  git(root, 'config', '--worktree', 'core.hooksPath', target);
  const result = status(root); if (!result.active) fail('Hooks written but activation verification failed'); return result;
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
  const f = value.formal;
  if (!f || Object.keys(f).sort().join() !== 'backend,status' || !['not-used', 'specified', 'verified', 'unavailable'].includes(f.status) || ![null, 'rocq', 'quint'].includes(f.backend) || (['specified', 'verified'].includes(f.status) && !f.backend) || (f.status === 'not-used' && f.backend !== null)) fail('Invalid formal status');
  if (c.policy === 'strict') {
    if (c.fields.elapsed_seconds && value.elapsed_seconds === null) fail('Elapsed measurement unavailable');
    if (c.fields.tokens && (value.input_tokens === null || value.output_tokens === null)) fail('Token measurements unavailable');
  }
  const head = optional(root, 'log', '-1', '--format=%B');
  if (head) { const old = fields(head); if (old['Harness-Task'] === value.task) for (const [key, field] of [['Harness-Elapsed-Seconds', 'elapsed_seconds'], ['Harness-Input-Tokens', 'input_tokens'], ['Harness-Output-Tokens', 'output_tokens']]) if (old[key] !== undefined && value[field] !== null && value[field] < Number(old[key])) fail(`${field} must be cumulative and cannot decrease`); }
  return value;
}
function fields(message) { const out = {}; for (const match of message.matchAll(new RegExp(OWNED.source, 'gm'))) { const key = match[1]; if (key in out) fail(`Duplicate ${key}`); out[key] = match[0].slice(key.length + 1).trim(); } return out; }
function block(value, c) {
  const out = { 'Harness-Telemetry-Version': VERSION, 'Harness-Version': value.harness_version, 'Harness-Task': value.task, 'Harness-Metrics-Source': 'agent-reported-cumulative' };
  if (c.fields.elapsed_seconds && value.elapsed_seconds !== null) out['Harness-Elapsed-Seconds'] = String(value.elapsed_seconds);
  if (c.fields.tokens) { if (value.input_tokens !== null) out['Harness-Input-Tokens'] = String(value.input_tokens); if (value.output_tokens !== null) out['Harness-Output-Tokens'] = String(value.output_tokens); }
  if (c.fields.agents && value.agents !== null && value.agents.length) out['Harness-Agents'] = value.agents.join(',');
  if (c.fields.mode && value.mode !== null) out['Harness-Mode'] = value.mode;
  if (c.fields.formal && value.formal.status !== 'unavailable') out['Harness-Formal'] = value.formal.status + (value.formal.backend ? ':' + value.formal.backend : '');
  return out;
}
function canonical(value) { return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))); }
function hook(root, action, file, source) {
  const c = config(root); if (!c.enabled) return;
  if (!file) fail('Commit message path required');
  const message = fs.readFileSync(file, 'utf8');
  try {
    const value = validateReport(root, read(path.join(root, '.harness/.local/commit-report.json')), c);
    if (action === 'prepare' && source === 'commit') { const head = optional(root, 'log', '-1', '--format=%B'); const task = head && fields(head)['Harness-Task']; if (task && task !== value.task) fail('Amend must preserve Harness-Task'); }
    const expected = block(value, c);
    if (action === 'prepare') fs.writeFileSync(file, message.replace(OWNED, '').trimEnd() + '\n\n' + Object.entries(expected).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');
    else if (canonical(fields(message)) !== canonical(expected)) fail('Commit trailers do not match current report/config');
  } catch (e) {
    if (c.policy === 'strict') throw e;
    console.error(`roster-telemetry: advisory — ${e.message}; metrics unavailable`);
    fs.writeFileSync(file, message.replace(OWNED, '').trimEnd() + '\n');
  }
}
function main(argv) {
  const args = [...argv]; const i = args.indexOf('--root'); let root = i >= 0 ? args[i + 1] : null; if (i >= 0) args.splice(i, 2);
  const action = args.shift() || 'status';
  if (action === 'version') { console.log(VERSION); return; }
  root = fs.realpathSync(root || git(process.cwd(), 'rev-parse', '--show-toplevel'));
  if (action === 'prepare' || action === 'validate') { hook(root, action, args[0], args[1]); return; }
  let result;
  if (action === 'install' || action === 'update') result = install(root);
  else if (action === 'status') result = status(root);
  else if (action === 'configure') {
    const c = config(root);
    if (!args.length || args.length % 2) fail('configure requires --setting value pairs');
    for (let j = 0; j < args.length; j += 2) {
      const key = args[j].replace(/^--/, ''); const value = args[j + 1];
      if (key === 'policy') { if (!['strict', 'advisory'].includes(value)) fail('Invalid policy'); c.policy = value; }
      else { if (!['true', 'false'].includes(value) || (key !== 'enabled' && !(key in DEFAULTS.fields))) fail(`Invalid setting ${key}`); if (key === 'enabled') c.enabled = value === 'true'; else c.fields[key] = value === 'true'; }
    }
    save(path.join(root, '.harness/telemetry.json'), c); result = c.enabled ? install(root) : status(root);
  } else if (action === 'report') {
    // Template uses explicit unknowns. The caller supplies measured totals, not guesses.
    if (args.length !== 1 || !safe(args[0])) fail('report requires a safe task identifier');
    const file = path.join(root, '.harness/.local/commit-report.json');
    if (fs.existsSync(file)) fail('Report exists; update it explicitly with cumulative task evidence');
    result = { schema_version: 1, task: args[0], harness_version: read(path.join(root, '.harness/harness.json')).version, staged_tree: git(root, 'write-tree'), elapsed_seconds: null, input_tokens: null, output_tokens: null, agents: null, mode: null, formal: { status: 'unavailable', backend: null } };
    save(file, result);
  } else fail(`Unknown action ${action}`);
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(`roster-telemetry: ${e.message}`); process.exitCode = 1; } }
module.exports = { VERSION, DEFAULTS, validateReport, block, fields };

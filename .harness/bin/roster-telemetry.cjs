#!/usr/bin/env node
'use strict';
// Project-local consistency checks, not provider authentication or a security boundary.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const VERSION = '1.0.1';
const RUNTIME = '.harness/bin/roster-telemetry.cjs';
const DEFAULTS = { schema_version: 1, enabled: true, policy: 'advisory', fields: { elapsed_seconds: true, tokens: true, agents: true, mode: true, formal: true } };
const OWNED_FIELD = /^Harness-(?:Telemetry-Version|Version|Task|Elapsed-Seconds|Input-Tokens|Output-Tokens|Agents|Mode|Formal|Metrics-Source)$/i;
const NAMES = ['prepare-commit-msg', 'commit-msg', 'reference-transaction'];
const safe = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
function fail(message) { throw new Error(message); }
function git(root, ...args) { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function optional(root, ...args) { try { return git(root, ...args); } catch (e) { if (e.status === 1 || e.status === 128) return null; throw e; } }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(file, value) {
  guardPath(file);
  guardPath(file + `.tmp-${process.pid}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + `.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}
function config(root) {
  const file = path.join(root, '.harness/telemetry.json');
  const c = fs.lstatSync(file, { throwIfNoEntry: false }) ? read(file) : structuredClone(DEFAULTS);
  if (!c || c.schema_version !== 1 || typeof c.enabled !== 'boolean' || !['advisory', 'strict'].includes(c.policy) || !c.fields || Object.keys(c).sort().join() !== 'enabled,fields,policy,schema_version' || Object.keys(c.fields).sort().join() !== Object.keys(DEFAULTS.fields).sort().join() || Object.values(c.fields).some(v => typeof v !== 'boolean')) fail('Invalid telemetry configuration; repair explicitly, not by resetting preferences');
  return c;
}
function hookBytes(name) {
  const action = { 'prepare-commit-msg': 'prepare', 'commit-msg': 'validate', 'reference-transaction': 'transaction' }[name];
  const preflight = name === 'reference-transaction' ? `root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0\n[ -f "$root/${RUNTIME}" ] || exit 0` : `root=$(git rev-parse --show-toplevel)
if [ ! -f "$root/${RUNTIME}" ]; then
  if [ -f "$root/.harness/telemetry.json" ]; then
    node -e 'const c=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.exit(c.enabled===false?0:1)' "$root/.harness/telemetry.json" && exit 0
  elif [ -z "$(git ls-files -- ${RUNTIME} .harness/telemetry.json)" ] && ! git cat-file -e HEAD:${RUNTIME} 2>/dev/null && ! git cat-file -e HEAD:.harness/telemetry.json 2>/dev/null; then
    exit 0
  fi
  echo 'roster-telemetry: required runtime missing; restore ${RUNTIME} or explicitly disable telemetry' >&2
  exit 1
fi`;
  return `#!/bin/sh\n# roster-telemetry managed v1\nset -eu\n${preflight}\nexport ROSTER_TELEMETRY_HOOK=1\nexec node "$root/${RUNTIME}" ${action} "$@" --root "$root"\n`;
}
function managedHook(name, text) {
  if (text === hookBytes(name)) return true;
  const action = { 'prepare-commit-msg': 'prepare', 'commit-msg': 'validate', 'reference-transaction': 'transaction' }[name];
  const preflight = name === 'reference-transaction' ? `root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0\n[ -f "$root/${RUNTIME}" ] || exit 0` : 'root=$(git rev-parse --show-toplevel)';
  const old = `#!/bin/sh\n# roster-telemetry managed v1\nset -eu\n${preflight}\nexec node "$root/${RUNTIME}" ${action} "$@" --root "$root"\n`;
  return text === old || (name !== 'reference-transaction' && text === old.replace(RUNTIME, '.harness/bin/roster-telemetry.js'));
}
function status(root) {
  const c = config(root);
  const target = path.join(root, '.harness/git-hooks');
  const configured = optional(root, 'config', '--get', 'core.hooksPath');
  const hooksOk = NAMES.every(name => {
    try { const f = path.join(target, name); return fs.readFileSync(f, 'utf8') === hookBytes(name) && Boolean(fs.statSync(f).mode & 0o111); } catch { return false; }
  });
  let probe = {};
  try { preflight(root); probe = spawnSync(process.execPath, [path.join(root, RUNTIME), 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* Unsafe installations remain inactive. */ }
  const installedVersion = probe.status === 0 ? probe.stdout.trim() : null;
  const conflict = encodingConflict(root, '', commentMarker(root), c);
  return { encoding_available: !conflict, encoding_conflict: conflict, version: VERSION, installed_version: installedVersion, config: c, hooks_path: configured, active: c.enabled && configured !== null && path.resolve(root, configured) === target && hooksOk && installedVersion === VERSION };
}
// The selected root is intentionally resolved; managed descendants never are.
function resolveRoot(file) {
  const absolute = path.resolve(file);
  if (fs.lstatSync(absolute, { throwIfNoEntry: false })) return fs.realpathSync(absolute);
  return path.join(resolveRoot(path.dirname(absolute)), path.basename(absolute));
}
function guardPath(file, boundary = path.parse(path.resolve(file)).root) {
  const absolute = path.resolve(file);
  const normalized = path.relative(boundary, absolute);
  if (normalized === '..' || normalized.startsWith('..' + path.sep) || path.isAbsolute(normalized)) fail('Managed path outside boundary');
  // Inspect components before resolving '..': a traversed symlink must not disappear.
  const raw = path.isAbsolute(file) ? file : process.cwd() + path.sep + file;
  const relative = raw.slice(boundary === path.parse(raw).root ? boundary.length : boundary.length + 1);
  let current = boundary;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) fail(`Refusing managed symlink: ${current}`);
    if (stat?.isFile() && stat.nlink > 1) fail(`Refusing managed hard link: ${current}`);
    if (stat && current !== absolute && !stat.isDirectory()) fail(`Managed ancestor is not a directory: ${current}`);
  }
}
function projectionPaths(root) {
  const file = root + '/.harness/harness.json';
  const runtimes = fs.existsSync(file) ? read(file).runtimes || [] : [];
  const codexHome = process.env.CODEX_HOME || process.env.HOME + '/.codex';
  const resolve = value => value === '~/.codex' || value.startsWith('~/.codex/') ? codexHome + value.slice(8) :
    value.startsWith('~/') ? process.env.HOME + '/' + value.slice(2) : path.isAbsolute(value) ? value : root + '/' + value;
  const skills = base => ['SKILL.md', '.roster-managed'].map(n => base + '/roster-telemetry/' + n);
  // Init replaces the manifest with these local defaults; sync also honors selected entrypoints.
  const out = [root + '/.claude/commands/roster-telemetry.md', root + '/.claude/rules/commit-telemetry.md',
    ...skills(root + '/.agents/skills'), ...skills(root + '/.opencode/skills')];
  for (const [name, fallback] of [['codex', '.agents/skills/'], ['codex-global', codexHome + '/skills'], ['opencode', '.opencode']]) {
    if (!runtimes.some(r => r.name === name && r.enabled === true)) continue;
    const base = resolve(runtimes.find(r => r.name === name)?.entrypoint ?? fallback);
    out.push(...skills(base + (name === 'opencode' ? '/skills' : '')));
    if (name === 'opencode') out.push(base + '/commands/roster-telemetry.md');
  }
  return out;
}
function preflight(root) {
  for (const relative of ['.harness/harness.json', '.harness/bin/package.json', RUNTIME, '.harness/bin/roster-telemetry.js',
    '.harness/skills/roster-telemetry.md', '.harness/rules/commit-telemetry.md',
    '.harness/telemetry.json', '.harness/.local/commit-report.json', '.harness/.local/commit-intent.json',
    ...NAMES.map(n => '.harness/git-hooks/' + n)]) {
    guardPath(path.join(root, relative), root);
    guardPath(path.join(root, relative + `.tmp-${process.pid}`), root);
  }
  for (const destination of projectionPaths(root)) guardPath(destination);
}
function adminPreflight(root) {
  for (const name of ['info/exclude', 'config', 'config.worktree']) {
    const destination = path.resolve(root, git(root, 'rev-parse', '--git-path', name));
    // Git may resolve an administrative directory, never the direct write target.
    const common = fs.realpathSync(path.resolve(root, git(root, 'rev-parse', '--git-common-dir')));
    const worktree = fs.realpathSync(path.resolve(root, git(root, 'rev-parse', '--git-dir')));
    const boundary = destination.startsWith(worktree + path.sep) ? worktree : common;
    guardPath(destination, boundary);
  }
}
function discardIntent(root) { const file = intentPath(root); guardPath(file); fs.rmSync(file, { force: true }); }
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
  preflight(root);
  adminPreflight(root);
  const scoped = optional(root, 'config', '--local', '--bool', '--get', 'extensions.worktreeConfig') === 'true';
  if (!scoped && (optional(root, 'config', '--local', '--bool', '--get', 'core.bare') === 'true' || optional(root, 'config', '--local', '--get', 'core.worktree') !== null)) fail('Migrate core.bare/core.worktree before enabling worktreeConfig; no configuration changed');
  const target = path.join(root, '.harness/git-hooks');
  const configured = optional(root, 'config', '--get', 'core.hooksPath');
  const common = path.resolve(root, git(root, 'rev-parse', '--git-common-dir'));
  const native = configured === null || path.resolve(root, configured) === path.join(common, 'hooks');
  if (configured === null || path.resolve(root, configured) !== target) checkHookDirectory(target, true);
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
  preflight(root);
  adminPreflight(root);
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
// Keep original line bytes; parsing views alone remove line terminators.
function messageParts(message, comment = '#', root) {
  const raw = message.match(/[^\n]*\n|[^\n]+$/g) || [];
  const lines = raw.map(l => l.replace(/\r?\n$/, ''));
  let end = lines.findIndex(l => l === `${comment} ------------------------ >8 ------------------------`);
  if (end < 0) end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || lines[end - 1].startsWith(comment))) end--;
  if (end === 0 && lines.some(line => line.trim())) end = lines.length;
  let start = end;
  while (start > 0 && lines[start - 1].trim()) start--;
  let continuation = false;
  const grammar = lines.slice(start, end).every(line => {
    if (/^[A-Za-z0-9][A-Za-z0-9-]*:[ \t]*.*$/.test(line)) { continuation = true; return true; }
    return continuation && /^[ \t]+\S/.test(line);
  });
  const trailers = start > 0 && end > start && (root ? Boolean(trailerParse(root, message).trim()) : grammar);
  const separators = root ? optional(root, 'config', '--get', 'trailer.separators') || ':' : ':';
  return { raw, lines, separators, start: trailers ? start : end, end };
}
function trailerMatch(line, separators) {
  const index = [...line].findIndex(c => separators.includes(c));
  if (index < 1) return null;
  const key = line.slice(0, index).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(key)) return null;
  return [line, key, line.slice(index + 1).trim()];
}
function ownedKey(key) {
  const names = ['Telemetry-Version', 'Version', 'Task', 'Elapsed-Seconds', 'Input-Tokens', 'Output-Tokens', 'Agents', 'Mode', 'Formal', 'Metrics-Source'];
  return names.map(n => 'Harness-' + n).find(n => n.toLowerCase() === key.toLowerCase());
}
function fields(message, comment, root) {
  const parts = messageParts(message, comment, root);
  const out = {};
  let previousOwned = false;
  for (const line of parts.lines.slice(parts.start, parts.end)) {
    if (/^[ \t]/.test(line) && previousOwned) fail('Owned trailers cannot have folded continuation lines');
    const match = trailerMatch(line, parts.separators);
    previousOwned = Boolean(match && OWNED_FIELD.test(match[1]));
    if (!previousOwned) continue;
    const key = ownedKey(match[1]);
    if (key in out) fail(`Duplicate ${key}`);
    out[key] = match[2].trim();
  }
  if (root && Object.keys(out).length) {
    const native = trailerParse(root, message);
    const parsed = {};
    for (const line of native.split('\n')) {
      const match = line.match(/^([^:]+):[ \t]*(.*)$/), key = match && ownedKey(match[1]);
      if (!key) continue;
      if (key in parsed) fail(`Duplicate ${key}`);
      parsed[key] = match[2].trim();
    }
    return parsed;
  }
  return out;
}
function replaceTrailers(message, expected, comment, root) {
  const parts = messageParts(message, comment, root);
  let owned = false;
  const retained = parts.raw.slice(parts.start, parts.end).filter(line => {
    const match = trailerMatch(line, parts.separators);
    if (/^[ \t]+\S/.test(line) && owned) fail('Owned trailers cannot have folded continuation lines');
    owned = Boolean(match && OWNED_FIELD.test(match[1]));
    return !owned;
  }).join('');
  let prefix = parts.raw.slice(0, parts.start).join('');
  const suffix = parts.raw.slice(parts.end).join('');
  const footer = Object.entries(expected).map(([key, value]) => `${key}: ${value}\n`).join('');
  if (footer && parts.start === parts.end) prefix += (prefix.endsWith('\n') ? '\n' : '\n\n');
  return prefix + retained + (footer && retained && !retained.endsWith('\n') ? '\n' : '') + footer + suffix;
}
function trailerParse(root, message) {
  return execFileSync('git', ['-C', root, 'interpret-trailers', '--parse'], { input: message, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function encodingConflict(root, message, comment, c = DEFAULTS) {
  if ('Harness-'.startsWith(comment)) return 'comment marker collides with Harness- trailers; select a compatible core.commentChar/commentString';
  const marker = `${comment} ------------------------ >8 ------------------------`;
  const lines = message.split(/\r?\n/), cut = lines.indexOf(marker);
  if (cut >= 0 && lines.slice(cut + 1).some(l => l.trim() && !l.startsWith(comment))) return 'ambiguous scissors tail; remove non-comment text after the scissors marker';
  // These are parser fixtures, never emitted measurements or participants.
  const expected = block({ harness_version: '1.0.0', task: 'encoding-probe', elapsed_seconds: 0,
    input_tokens: 0, output_tokens: 0, agents: ['probe'], mode: 'full', formal: { status: 'not-used', backend: null } }, c);
  const sample = 'subject\n\n' + Object.entries(expected).map(([k, v]) => `${k}: ${v}\n`).join('');
  try { if (canonical(fields(sample, comment, root)) === canonical(expected)) return null; }
  catch { /* A per-field alias or duplicate can also prevent canonical encoding. */ }
  return 'trailer configuration cannot round-trip canonical metadata; select compatible trailer settings';
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
    const old = fields(head, commentMarker(root, head), root);
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
  const candidates = '#;@!$%^&|:';
  const lines = message.split(/\r?\n/).filter(line => line.trim());
  // An empty automatic template uses '#'; '$ subject' is ordinary authored text.
  if (lines.length && lines.every(line => line.startsWith('#'))) return '#';
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
function currentIntent(root) {
  try {
    const value = read(intentPath(root)), parent = invocation();
    if (value?.parent?.pid === parent.pid && value.parent.start === parent.start &&
      /^[0-9a-f]+$/.test(value.head) && /^[0-9a-f]+$/.test(value.tree) &&
      value.expected && typeof value.expected === 'object' && !Array.isArray(value.expected) &&
      Object.entries(value.expected).every(([k, v]) => OWNED_FIELD.test(k) && typeof v === 'string') &&
      value.footer === Object.entries(value.expected).map(([k, v]) => `${k}: ${v}\n`).join('') &&
      (value.markers == null || (Array.isArray(value.markers) && value.markers.length === 2 && value.markers.every(m => typeof m === 'string' && m.endsWith('\n'))))) return { ...value, ownAt: null };
  } catch { /* Malformed or abandoned state is not a receipt for this operation. */ }
  return null;
}
function editorInput(message, intent) {
  if (!intent?.markers) return [message, intent];
  const [open, close] = intent.markers, a = message.indexOf(open), b = message.indexOf(close);
  if (a < 0 && b < 0) return [message, { ...intent, lostFooter: intent.footer, footer: null }];
  if (a < 0 || b < a || message.indexOf(open, a + 1) >= 0 || message.indexOf(close, b + 1) >= 0) fail('Prepared metadata envelope is partial or duplicated');
  const inside = message.slice(a + open.length, b), at = inside.indexOf(intent.footer);
  if (at < 0 || inside.indexOf(intent.footer, at + 1) >= 0) fail('Prepared metadata contradiction: generated footer changed');
  return [message.slice(0, a) + inside + message.slice(b + close.length), { ...intent, ownAt: a + at }];
}
function preparedFooter(message, intent) {
  if (!intent?.footer) return null;
  if (intent.ownAt != null && message.slice(intent.ownAt, intent.ownAt + intent.footer.length) === intent.footer) return intent.ownAt;
  const at = message.indexOf(intent.footer);
  if (at >= 0 && (at === 0 || message[at - 1] === '\n') && message.indexOf(intent.footer, at + 1) < 0) return at;
  const lines = new Set(message.split(/\r?\n/));
  if (intent.footer.trimEnd().split('\n').some(line => lines.has(line))) fail('Prepared metadata contradiction: generated footer is partial or changed');
  return null; // A whole-buffer editor replacement can contain entirely new authored text.
}
function fallback(root, c, message, file, comment, error, intent, cleanup = false) {
  if (intent?.lostFooter && message.includes(intent.lostFooter)) fail('Prepared metadata provenance removed; cannot safely discard generated values');
  const at = preparedFooter(message, intent);
  discardIntent(root);
  if (c.policy === 'strict') throw error;
  console.error(`roster-telemetry: advisory — ${error.message}; metrics unavailable`);
  // Raw user text in a no-generation fallback is not generated telemetry.
  if (at !== null) fs.writeFileSync(file, message.slice(0, at) + message.slice(at + intent.footer.length));
  else if (cleanup) fs.writeFileSync(file, replaceTrailers(message, {}, comment, root));
}
function hook(root, action, file, source) {
  const c = config(root);
  if (!c.enabled) return;
  if (!file) fail('Commit message path required');
  guardPath(intentPath(root));
  const [message, intent] = editorInput(fs.readFileSync(file, 'utf8'), action === 'validate' ? currentIntent(root) : null);
  const comment = commentMarker(root, message);
  const editing = action === 'prepare' && process.env.ROSTER_TELEMETRY_HOOK === '1' && process.env.GIT_EDITOR !== ':';
  const conflict = encodingConflict(root, message, comment, c);
  if (conflict) return fallback(root, c, message, file, comment, new Error(`Encoding conflict: ${conflict}`), intent);
  const hasContent = message.split(/\r?\n/).some(line => line.trim() && !line.startsWith(comment));
  const explicit = source === 'message' && process.env.GIT_EDITOR === ':';
  if (!message.trim() || (!hasContent && !explicit && !intent?.commentSubject)) {
    discardIntent(root);
    if (action === 'validate' && c.policy === 'strict') fail('No reliably publishable subject; write a real subject before telemetry preparation');
    return; // Empty prepare buffers must remain available to the editor.
  }
  let value;
  try { value = validateReport(root, read(path.join(root, '.harness/.local/commit-report.json')), c); }
  catch (error) {
    if (intent) fail(`Prepared metadata contradiction: ${error.message}`);
    return fallback(root, c, message, file, comment, error, null, true);
  }
  const expected = block(value, c), footer = Object.entries(expected).map(([k, v]) => `${k}: ${v}\n`).join('');
  const id = editing ? randomBytes(12).toString('hex') : null;
  const markers = id ? ['start', 'end'].map(n => `${comment} roster-telemetry:${id}:${n}\n`) : null;
  const actual = action === 'validate' ? fields(message, comment, root) : {};
  if (intent && canonical(intent.expected) !== canonical(expected)) fail('Prepared metadata report/config changed');
  if (!intent && Object.keys(actual).length && canonical(actual) !== canonical(expected)) return fallback(root, c, message, file, comment, new Error('Commit trailers do not match current report/config'), null, true);
  if (intent && Object.keys(actual).length) {
    if (canonical(actual) !== canonical(expected) || canonical(intent.expected) !== canonical(expected)) fail('Prepared commit trailers do not match current report/config');
    fs.writeFileSync(file, message);
  } else {
    if (preparedFooter(message, intent) !== null) fail('Prepared metadata displaced from actual trailers');
    let output = replaceTrailers(message, expected, comment, root);
    if (markers) { const at = output.lastIndexOf(footer); output = output.slice(0, at) + markers[0] + footer + markers[1] + output.slice(at + footer.length); }
    fs.writeFileSync(file, output);
  }
  save(intentPath(root), { parent: invocation(), head: optional(root, 'rev-parse', '--verify', 'HEAD') || '0'.repeat(value.staged_tree.length), tree: value.staged_tree, expected, footer, markers, comment, commentSubject: explicit || Boolean(intent?.commentSubject) });
}
// Git exposes message reuse, not amend intent, to prepare-commit-msg. Inspect
// the final commit's parent relation before its ref is published instead.
function transaction(root, event) {
  if (!['prepared', 'committed', 'aborted'].includes(event)) return;
  const file = intentPath(root);
  if (!fs.existsSync(file)) return;
  const c = config(root);
  if (!c.enabled) return;
  const intent = currentIntent(root);
  if (!intent) return;
  const refs = fs.readFileSync(0, 'utf8').trim().split('\n').map(line => line.split(' '));
  const current = optional(root, 'symbolic-ref', '-q', 'HEAD') || 'HEAD';
  const update = refs.find(([old, next, ref]) => old === intent.head && (ref === current || ref === 'HEAD') && /^[0-9a-f]+$/.test(next) && !/^0+$/.test(next));
  if (!update) return;
  if (event !== 'prepared') { discardIntent(root); return; }
  // Missing measurements remain advisory. Once metadata was prepared, neither
  // policy may publish a known contradiction discovered after Git cleanup.
  const [old, next] = update;
  if (git(root, 'show', '-s', '--format=%T', next) !== intent.tree) return;
  const message = git(root, 'show', '-s', '--format=%B', next);
  if (intent.markers?.some(m => message.includes(m.trimEnd()))) fail('Prepared metadata requires final commit-msg validation');
  if (canonical(fields(message, commentMarker(root, message), root)) !== canonical(intent.expected)) fail('Final commit trailers changed during Git cleanup');
  const parents = git(root, 'show', '-s', '--format=%P', next).split(' ');
  if (!/^0+$/.test(old) && parents[0] !== old) {
    const previousMessage = git(root, 'show', '-s', '--format=%B', old);
    const previous = fields(previousMessage, commentMarker(root, previousMessage), root);
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
  guardPath(path.join(root, '.harness/.local/commit-report.json'));
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
  root = resolveRoot(root || git(process.cwd(), 'rev-parse', '--show-toplevel'));
  if (action === 'preflight') { preflight(root); return; }
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

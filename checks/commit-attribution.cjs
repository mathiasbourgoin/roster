#!/usr/bin/env node
'use strict';
// Authentic installed-hook regression. Exit 0: pass, 1: assertion, >=2: tool/error.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = process.argv[2] || path.resolve(__dirname, '../scripts/roster-telemetry.js');
const credit = 'Developed-with: Roster <https://github.com/mathiasbourgoin/roster>';
let failed = false;
function main() {
  if (!fs.existsSync(source)) throw new Error('Supply an existing trusted telemetry source');
  for (const mode of ['append', 'require']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-attribution-subject-'));
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_EDITOR: 'true',
      GIT_AUTHOR_NAME: 'Synthetic', GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid' };
    function run(cmd, args) {
      const result = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8' });
      if (result.error) throw result.error;
      return result;
    }
    function success(cmd, args) {
      const result = run(cmd, args);
      if (result.status !== 0) throw new Error(`${cmd} failed (${result.status}): ${result.stderr}`);
      return result.stdout;
    }
    try {
      success('git', ['init', '-q']);
      fs.mkdirSync(path.join(root, '.harness'));
      fs.writeFileSync(path.join(root, '.harness/harness.json'), '{"version":"1.0.0"}');
      success(process.execPath, [source, 'configure', '--enabled', 'false', '--attribution', mode, '--root', root]);
      fs.writeFileSync(path.join(root, 'file'), 'synthetic'); success('git', ['add', 'file']);
      success('git', ['commit', '-qm', `test: valid subject\n\n${credit}`]);
      if (!success('git', ['log', '-1', '--format=%(trailers:only)']).includes(credit))
        throw new Error('Positive control did not record native attribution');
      fs.writeFileSync(path.join(root, 'file'), 'synthetic changed'); success('git', ['add', 'file']);
      fs.writeFileSync(path.join(root, '.git/message'), `# only an editor comment\n\n${credit}\n`);
      const candidate = run('git', ['commit', '-q', '--cleanup=strip', '-F', '.git/message']);
      if (candidate.status !== 0) {
        if (!/attribution|Developed-with/i.test(candidate.stderr)) throw new Error(`Unexpected refusal: ${candidate.stderr}`);
        console.log(`${mode}: invalid subject/footer refused`);
      } else {
        if (!success('git', ['log', '-1', '--format=%(trailers:only)']).includes(credit)) {
          failed = true;
          console.error(`${mode}: ASSERTION — commit accepted but credit became subject and native footer is empty`);
        }
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
}
try { main(); process.exitCode = failed ? 1 : 0; }
catch (error) { console.error(error.stack || String(error)); process.exitCode = 2; }

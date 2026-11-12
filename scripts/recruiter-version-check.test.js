'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const checker = process.env.ROSTER_TEST_VERSION_CHECK || path.resolve(__dirname, '../recruiter/ops/version-check.sh');

function check(t, { runtime = 'claude', channel, local = '2.7.0', remote = '2.8.0', enabled = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-version-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = { claude: '.claude', opencode: '.opencode', codex: '.agents/skills/recruit' }[runtime];
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, '.roster-version'), local + '\n');
  if (channel !== undefined) fs.writeFileSync(path.join(root, dir, '.roster-channel'), channel + '\n');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.roster'), { recursive: true });
  fs.writeFileSync(path.join(home, '.roster/config'), `update_check=${enabled}\nauto_upgrade=false\n`);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const calls = path.join(root, 'curl-calls');
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nprintf "%s\\n" "$@" >> "$ROSTER_TEST_CALLS"\nprintf "%s\\n" "$ROSTER_TEST_REMOTE"\n', { mode: 0o755 });
  const run = spawnSync('bash', [checker], { cwd: root, encoding: 'utf8', env: {
    ...process.env, HOME: home, PATH: bin + path.delimiter + process.env.PATH,
    ROSTER_TEST_CALLS: calls, ROSTER_TEST_REMOTE: remote,
  } });
  assert.equal(run.status, 0, run.stderr);
  return { output: run.stdout.trim(), calls: fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '' };
}

test('legacy installation without a channel marker checks stable main', t => {
  const result = check(t);
  assert.equal(result.output, 'ROSTER_UPGRADE_AVAILABLE 2.7.0 2.8.0 false claude');
  assert.match(result.calls, /\/main\/VERSION/);
});

for (const runtime of ['claude', 'opencode', 'codex']) {
  test(`${runtime} next installation checks next and accepts development versions`, t => {
    const result = check(t, { runtime, channel: 'next', remote: '3.0.0-dev' });
    assert.equal(result.output, `ROSTER_UPGRADE_AVAILABLE 2.7.0 3.0.0-dev false ${runtime}`);
    assert.match(result.calls, /\/next\/VERSION/);
    assert.doesNotMatch(result.calls, /\/main\/VERSION/);
  });
}

test('unchanged next development version does not offer an update', t => {
  const result = check(t, { channel: 'next', local: '3.0.0-dev', remote: '3.0.0-dev' });
  assert.equal(result.output, '');
  assert.match(result.calls, /\/next\/VERSION/);
});

test('stable channel does not advertise a prerelease', t => {
  assert.equal(check(t, { channel: 'stable', remote: '3.0.0-dev' }).output, '');
});

for (const channel of ['branch:review-candidate', 'unrecognized']) {
  test(`${channel} marker never silently switches to main`, t => {
    const result = check(t, { channel });
    assert.equal(result.output, '');
    assert.equal(result.calls, '');
  });
}

test('disabled checks do not contact the remote', t => {
  const result = check(t, { channel: 'next', enabled: false });
  assert.equal(result.output, '');
  assert.equal(result.calls, '');
});

for (const remote of ['v3.0.0-dev', '3.0-dev', '3.0.0-dev!']) {
  test(`malformed remote ${remote} is not an update`, t => {
    assert.equal(check(t, { channel: 'next', remote }).output, '');
  });
}

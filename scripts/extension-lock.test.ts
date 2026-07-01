// Deterministic fault-injection tests for the R3 registry lock redesign:
// atomic exclusive-create with owner metadata, atomic rename-based reclaim
// (TOCTOU closed), token-verified ownership, and named injectable timing
// constants (env-driven — no multi-second real sleeps). Public surface only
// (module exports + env injection).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import { install, list } from "./roster-extension.js";
import { makeExtension, makeProject, write } from "./extension-fixture.js";

const STALE_ENV = "ROSTER_EXTENSION_LOCK_STALE_MS";
const BUDGET_ENV = "ROSTER_EXTENSION_LOCK_RETRY_BUDGET_MS";
const POLL_ENV = "ROSTER_EXTENSION_LOCK_POLL_MS";

async function withLockEnv<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const saved = new Map(Object.entries(env).map(([key]) => [key, process.env[key]] as const));
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  try {
    return await body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function lockPack(name: string): ReturnType<typeof makeExtension> {
  return makeExtension({
    plugin: { name, version: "1.0.0" },
    skills: [{ dir: `${name}-skill`, name: `${name}-skill` }],
  });
}

describe("roster-extension registry lock (R3 redesign)", () => {
  it("reclaims a stale lock via injected staleness threshold", async () => {
    const extensionRoot = await lockPack("stale-pack");
    const projectRoot = await makeProject();
    await write(
      path.join(projectRoot, ".harness/extensions.lock/owner.json"),
      JSON.stringify({ pid: 2147483647, acquired_at: Date.now() - 500 }),
    );

    const installed = await withLockEnv(
      { [STALE_ENV]: "50", [BUDGET_ENV]: "2000", [POLL_ENV]: "5" },
      () => install(extensionRoot, { target: projectRoot, dryRun: false }),
    );

    assert.equal(installed.name, "stale-pack");
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.lock")));
  });

  it("respects a live holder and times out after the retry budget", async () => {
    const extensionRoot = await lockPack("live-pack");
    const projectRoot = await makeProject();
    const ownerPath = path.join(projectRoot, ".harness/extensions.lock/owner.json");
    const ownerBody = JSON.stringify({ pid: process.pid, acquired_at: Date.now(), token: "live-holder" });
    await write(ownerPath, ownerBody);

    await withLockEnv({ [STALE_ENV]: "50", [BUDGET_ENV]: "150", [POLL_ENV]: "10" }, async () => {
      await assert.rejects(
        install(extensionRoot, { target: projectRoot, dryRun: false }),
        /timed out waiting for extension registry lock/,
      );
    });
    // The live lock was neither stolen nor mutated by the loser, and nothing
    // was installed behind the holder's back.
    assert.equal(await fs.readFile(ownerPath, "utf8"), ownerBody);
    assert.equal((await list(projectRoot)).length, 0);
  });

  it("survives a concurrent reclaim race: both contenders complete, one lock survives at a time", async () => {
    const firstRoot = await lockPack("race-one");
    const secondRoot = await lockPack("race-two");
    const projectRoot = await makeProject();
    await write(
      path.join(projectRoot, ".harness/extensions.lock/owner.json"),
      JSON.stringify({ pid: 2147483647, acquired_at: Date.now() - 500 }),
    );

    const results = await withLockEnv({ [STALE_ENV]: "50", [BUDGET_ENV]: "5000", [POLL_ENV]: "5" }, () =>
      Promise.allSettled([
        install(firstRoot, { target: projectRoot, dryRun: false }),
        install(secondRoot, { target: projectRoot, dryRun: false }),
      ]),
    );

    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "fulfilled"]);
    assert.deepEqual((await list(projectRoot)).map((entry) => entry.name).sort(), ["race-one", "race-two"]);
    await assert.rejects(fs.stat(path.join(projectRoot, ".harness/extensions.lock")));
  });

  it("recovers from a holder that crashed between mkdir and the owner write", async () => {
    const extensionRoot = await lockPack("crashed-pack");
    const projectRoot = await makeProject();
    // Bare lock directory, no owner.json: age is taken from the directory mtime.
    await fs.mkdir(path.join(projectRoot, ".harness/extensions.lock"), { recursive: true });

    const installed = await withLockEnv(
      { [STALE_ENV]: "50", [BUDGET_ENV]: "2000", [POLL_ENV]: "10" },
      () => install(extensionRoot, { target: projectRoot, dryRun: false }),
    );

    assert.equal(installed.name, "crashed-pack");
  });

  it("rejects a configuration whose retry budget does not exceed the staleness threshold", async () => {
    const extensionRoot = await lockPack("misconfig-pack");
    const projectRoot = await makeProject();

    await withLockEnv({ [STALE_ENV]: "1000", [BUDGET_ENV]: "500" }, async () => {
      await assert.rejects(
        install(extensionRoot, { target: projectRoot, dryRun: false }),
        /retry budget \(500ms\) must exceed the staleness threshold \(1000ms\)/,
      );
    });
  });
});

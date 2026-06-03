// End-to-end: spawn a reference project, run the real black-box S4 (cumulative)
// suite + invariant against it over HTTP. Proves (1) the conformance runner and
// invariant check work end-to-end, and (2) NON-VACUITY: a correct impl passes
// everything, a buggy impl is caught. This is "mutation-test-the-tests" applied
// to the eval harness itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runSuite } from "../lib/conformance-runner.mjs";
import { waitForReady } from "../lib/http.mjs";
import { tests as s4tests } from "../problems/ledger-service/conformance/s4.mjs";
import { check as invariantCheck } from "../problems/ledger-service/invariant/s4-invariant.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));

function startServer(serverPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const timer = setTimeout(() => reject(new Error("server start timeout")), 5000);
    proc.stdout.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/LISTENING (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, port: Number(m[1]) });
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function evaluate(serverPath) {
  const { proc, port } = await startServer(serverPath);
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForReady(base);
    const results = await runSuite(s4tests(base, "e2e"));
    const invariant = await invariantCheck(base, "e2e");
    return { results, invariant };
  } finally {
    proc.kill();
  }
}

test("correct reference passes the full S4 suite and holds the invariant", async () => {
  const { results, invariant } = await evaluate(path.join(dir, "fixtures/ref-ledger/server.mjs"));
  const failed = results.filter((r) => !r.pass);
  assert.equal(failed.length, 0, "unexpected conformance failures: " + JSON.stringify(failed));
  assert.ok(invariant.ok, "unexpected invariant violations: " + JSON.stringify(invariant.violations));
});

test("buggy reference is CAUGHT (conformance fails and/or invariant violated)", async () => {
  const { results, invariant } = await evaluate(path.join(dir, "fixtures/ref-ledger-buggy/server.mjs"));
  const conformanceCaught = results.some((r) => !r.pass);
  const invariantCaught = !invariant.ok;
  assert.ok(
    conformanceCaught,
    "scorer should have failed overdraft conformance tests on the buggy impl"
  );
  assert.ok(
    invariantCaught,
    "invariant check should have found a negative balance on the buggy impl"
  );
});

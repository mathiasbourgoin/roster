// Runs a stage's black-box conformance suite against a running project.
// A test "passes" iff its async run() does not throw. No knowledge of the
// project's internals — this is the disjoint oracle.

export async function runSuite(suiteTests) {
  const results = [];
  for (const t of suiteTests) {
    try {
      await t.run();
      results.push({ name: t.name, pass: true, error: null });
    } catch (e) {
      results.push({ name: t.name, pass: false, error: String((e && e.message) || e) });
    }
  }
  return results;
}

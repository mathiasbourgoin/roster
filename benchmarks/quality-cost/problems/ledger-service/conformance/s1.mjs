// S1 conformance — black-box, talks only over HTTP.
// Account ids are namespaced with a per-RUN `nonce` so that when a later stage's
// cumulative suite re-runs these tests against a project that PERSISTS state to
// disk, the re-created ids do not collide with a prior run (fixes review C1).
// Test NAMES stay stable (independent of nonce) so cross-stage regression
// detection still works.
import { req, assert } from "../../../lib/http.mjs";

export const stage = "S1";

export const tests = (base, nonce = "t") => {
  const id = (s) => `${nonce}-${s}`;
  return [
    {
      name: "S1.create-account-201",
      run: async () => {
        const r = await req(base, "POST", "/accounts", { id: id("s1-create") });
        assert(r.status === 201, `expected 201, got ${r.status}`);
        assert(r.json && r.json.balance === 0, `expected balance 0, got ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S1.new-account-balance-zero",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s1-zero") });
        const r = await req(base, "GET", `/accounts/${id("s1-zero")}`);
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.json && r.json.balance === 0, `expected balance 0, got ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S1.missing-account-404",
      run: async () => {
        const r = await req(base, "GET", `/accounts/${id("s1-nope")}`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
      },
    },
    {
      name: "S1.create-missing-id-400",
      run: async () => {
        const r = await req(base, "POST", "/accounts", {});
        assert(r.status === 400, `expected 400, got ${r.status}`);
      },
    },
  ];
};

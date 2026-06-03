// S2 conformance — CUMULATIVE: includes all S1 tests plus deposits.
import { req, assert } from "../../../lib/http.mjs";
import { tests as s1tests } from "./s1.mjs";

export const stage = "S2";

const s2only = (base, nonce) => {
  const id = (s) => `${nonce}-${s}`;
  return [
    {
      name: "S2.deposit-increases-balance",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s2-dep") });
        const r = await req(base, "POST", `/accounts/${id("s2-dep")}/deposit`, { amount: 100 });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.json && r.json.balance === 100, `expected 100, got ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S2.deposits-sum",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s2-sum") });
        await req(base, "POST", `/accounts/${id("s2-sum")}/deposit`, { amount: 100 });
        await req(base, "POST", `/accounts/${id("s2-sum")}/deposit`, { amount: 50 });
        const r = await req(base, "GET", `/accounts/${id("s2-sum")}`);
        assert(r.json && r.json.balance === 150, `expected 150, got ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S2.deposit-nonpositive-422-unchanged",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s2-bad") });
        await req(base, "POST", `/accounts/${id("s2-bad")}/deposit`, { amount: 100 });
        const bad = await req(base, "POST", `/accounts/${id("s2-bad")}/deposit`, { amount: 0 });
        assert(bad.status === 422, `expected 422, got ${bad.status}`);
        const r = await req(base, "GET", `/accounts/${id("s2-bad")}`);
        assert(r.json && r.json.balance === 100, `balance changed: ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S2.deposit-missing-account-404",
      run: async () => {
        const r = await req(base, "POST", `/accounts/${id("s2-ghost")}/deposit`, { amount: 10 });
        assert(r.status === 404, `expected 404, got ${r.status}`);
      },
    },
  ];
};

export const tests = (base, nonce = "t") => [...s1tests(base, nonce), ...s2only(base, nonce)];

// S4 conformance — CUMULATIVE: includes S1 + S2 + S3 plus transfers.
// The deep money-conservation property (incl. a concurrent burst) is checked
// separately by invariant/s4-invariant.mjs.
import { req, assert } from "../../../lib/http.mjs";
import { tests as s3tests } from "./s3.mjs";

export const stage = "S4";

const s4only = (base, nonce) => {
  const id = (s) => `${nonce}-${s}`;
  return [
    {
      name: "S4.transfer-moves-funds",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s4-from") });
        await req(base, "POST", "/accounts", { id: id("s4-to") });
        await req(base, "POST", `/accounts/${id("s4-from")}/deposit`, { amount: 100 });
        const r = await req(base, "POST", "/transfer", { from: id("s4-from"), to: id("s4-to"), amount: 40 });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        const from = await req(base, "GET", `/accounts/${id("s4-from")}`);
        const to = await req(base, "GET", `/accounts/${id("s4-to")}`);
        assert(from.json.balance === 60, `from expected 60, got ${from.json.balance}`);
        assert(to.json.balance === 40, `to expected 40, got ${to.json.balance}`);
      },
    },
    {
      name: "S4.transfer-overdraft-422-atomic",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s4-of") });
        await req(base, "POST", "/accounts", { id: id("s4-ot") });
        await req(base, "POST", `/accounts/${id("s4-of")}/deposit`, { amount: 30 });
        const bad = await req(base, "POST", "/transfer", { from: id("s4-of"), to: id("s4-ot"), amount: 100 });
        assert(bad.status === 422, `expected 422, got ${bad.status}`);
        const from = await req(base, "GET", `/accounts/${id("s4-of")}`);
        const to = await req(base, "GET", `/accounts/${id("s4-ot")}`);
        assert(from.json.balance === 30, `from must be unchanged 30, got ${from.json.balance}`);
        assert(to.json.balance === 0, `to must be unchanged 0, got ${to.json.balance}`);
      },
    },
    {
      name: "S4.transfer-missing-account-404",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s4-real") });
        await req(base, "POST", `/accounts/${id("s4-real")}/deposit`, { amount: 10 });
        const r = await req(base, "POST", "/transfer", { from: id("s4-real"), to: id("s4-ghost"), amount: 5 });
        assert(r.status === 404, `expected 404, got ${r.status}`);
      },
    },
  ];
};

export const tests = (base, nonce = "t") => [...s3tests(base, nonce), ...s4only(base, nonce)];

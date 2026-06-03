// S3 conformance — CUMULATIVE: includes S1 + S2 plus withdrawals.
import { req, assert } from "../../../lib/http.mjs";
import { tests as s2tests } from "./s2.mjs";

export const stage = "S3";

const s3only = (base, nonce) => {
  const id = (s) => `${nonce}-${s}`;
  return [
    {
      name: "S3.withdraw-decreases-balance",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s3-wd") });
        await req(base, "POST", `/accounts/${id("s3-wd")}/deposit`, { amount: 100 });
        const r = await req(base, "POST", `/accounts/${id("s3-wd")}/withdraw`, { amount: 30 });
        assert(r.status === 200, `expected 200, got ${r.status}`);
        assert(r.json && r.json.balance === 70, `expected 70, got ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S3.overdraft-422-balance-unchanged",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s3-od") });
        await req(base, "POST", `/accounts/${id("s3-od")}/deposit`, { amount: 50 });
        const bad = await req(base, "POST", `/accounts/${id("s3-od")}/withdraw`, { amount: 100 });
        assert(bad.status === 422, `expected 422 (no overdraft), got ${bad.status}`);
        const r = await req(base, "GET", `/accounts/${id("s3-od")}`);
        assert(r.json && r.json.balance === 50, `balance must be unchanged 50, got ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "S3.withdraw-nonpositive-422",
      run: async () => {
        await req(base, "POST", "/accounts", { id: id("s3-np") });
        await req(base, "POST", `/accounts/${id("s3-np")}/deposit`, { amount: 10 });
        const bad = await req(base, "POST", `/accounts/${id("s3-np")}/withdraw`, { amount: -5 });
        assert(bad.status === 422, `expected 422, got ${bad.status}`);
      },
    },
  ];
};

export const tests = (base, nonce = "t") => [...s2tests(base, nonce), ...s3only(base, nonce)];

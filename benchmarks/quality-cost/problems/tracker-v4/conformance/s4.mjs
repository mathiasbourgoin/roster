// S4 conformance — CUMULATIVE: S1+S2+S3 + versioning + idempotent creates + optimistic concurrency.
// The cumulative re-run of S1-S3 is the cross-stage regression check: a refactor that broke earlier
// contracts surfaces here. (S1-S3 tests check field subsets, so the new `version` field is fine.)
import { req, assert } from "../../../lib/http.mjs";
import { tests as s3 } from "./s3.mjs";

export const stage = "S4";

const only = (base, nonce) => [
  {
    name: "V.create-version-1",
    run: async () => {
      const r = await req(base, "POST", "/tasks", { title: `${nonce}-v1` });
      assert(r.json.version === 1, `expected version 1, got ${JSON.stringify(r.json)}`);
    },
  },
  {
    name: "V.get-includes-version",
    run: async () => {
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-v2` });
      const r = await req(base, "GET", `/tasks/${c.json.id}`);
      assert(r.json.version === 1, `expected version 1, got ${JSON.stringify(r.json)}`);
    },
  },
  {
    name: "V.status-bumps-version",
    run: async () => {
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-v3` });
      await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "in_progress" });
      const r = await req(base, "GET", `/tasks/${c.json.id}`);
      assert(r.json.version === 2, `expected version 2 after a change, got ${r.json.version}`);
    },
  },
  {
    name: "V.idempotent-create-same-key",
    run: async () => {
      const key = `${nonce}-idem`;
      const a = await req(base, "POST", "/tasks", { title: `${nonce}-i` }, { "Idempotency-Key": key });
      const before = (await req(base, "GET", "/tasks?limit=1000000&offset=0")).json.total;
      const b = await req(base, "POST", "/tasks", { title: `${nonce}-i` }, { "Idempotency-Key": key });
      const after = (await req(base, "GET", "/tasks?limit=1000000&offset=0")).json.total;
      assert(a.json.id === b.json.id, `same key returned different ids: ${a.json.id} vs ${b.json.id}`);
      assert(after === before, `idempotent replay created a duplicate: total ${before} -> ${after}`);
    },
  },
  {
    name: "V.stale-expectedVersion-409",
    run: async () => {
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-v4` });
      await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "in_progress" }); // version 2
      const r = await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "done", expectedVersion: 1 });
      assert(r.status === 409, `expected 409 for stale version, got ${r.status}`);
      const g = await req(base, "GET", `/tasks/${c.json.id}`);
      assert(g.json.status === "in_progress" && g.json.version === 2, `stale change leaked ${JSON.stringify(g.json)}`);
    },
  },
  {
    name: "V.correct-expectedVersion-ok",
    run: async () => {
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-v5` });
      await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "in_progress" }); // version 2
      const r = await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "done", expectedVersion: 2 });
      assert(r.status === 200, `expected 200 for matching version, got ${r.status}`);
    },
  },
  {
    name: "V.backward-compat-status-no-version",
    run: async () => {
      // omitting expectedVersion must still work exactly as in S2
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-v6` });
      const r = await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "in_progress" });
      assert(r.status === 200, `backward-compat status change broke: ${r.status}`);
    },
  },
];

export const tests = (base, nonce = "t") => [...s3(base, nonce), ...only(base, nonce)];

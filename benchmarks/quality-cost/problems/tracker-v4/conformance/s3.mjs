// S3 conformance — CUMULATIVE: S1 + S2 + list/filter/pagination.
// Assertions are robust to store accumulation: they check pagination MATH relative to the live
// total and filter correctness (every returned item matches), not absolute global counts.
import { req, assert } from "../../../lib/http.mjs";
import { tests as s2 } from "./s2.mjs";

export const stage = "S3";

function qs(o) {
  const p = Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return p ? `?${p}` : "";
}

const only = (base, nonce) => [
  {
    name: "L.list-shape",
    run: async () => {
      const r = await req(base, "GET", "/tasks" + qs({ limit: 100000, offset: 0 }));
      assert(r.status === 200 && Array.isArray(r.json.items) && typeof r.json.total === "number",
        `bad shape ${JSON.stringify(r.json).slice(0, 120)}`);
    },
  },
  {
    name: "L.pagination-math",
    run: async () => {
      for (const t of ["p1", "p2", "p3"]) await req(base, "POST", "/tasks", { title: `${nonce}-${t}` });
      const all = await req(base, "GET", "/tasks" + qs({ limit: 1000000, offset: 0 }));
      const T = all.json.total;
      assert(all.json.items.length === T, `large limit should return all: ${all.json.items.length} vs total ${T}`);
      const p = await req(base, "GET", "/tasks" + qs({ limit: 2, offset: 0 }));
      assert(p.json.items.length === Math.min(2, T), `limit=2 returned ${p.json.items.length}`);
      const end = await req(base, "GET", "/tasks" + qs({ limit: 10, offset: T }));
      assert(end.json.items.length === 0, `offset==total should be empty, got ${end.json.items.length}`);
      const past = await req(base, "GET", "/tasks" + qs({ limit: 10, offset: T + 50 }));
      assert(past.json.items.length === 0, `offset past end should be empty, got ${past.json.items.length}`);
    },
  },
  {
    name: "L.filter-correct",
    run: async () => {
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-f` });
      await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "in_progress" });
      const r = await req(base, "GET", "/tasks" + qs({ status: "in_progress", limit: 1000000, offset: 0 }));
      assert(r.status === 200, `${r.status}`);
      assert(r.json.items.every((x) => x.status === "in_progress"), `filter leaked a non-in_progress item`);
      assert(r.json.items.some((x) => x.id === c.json.id), `our in_progress task is missing`);
      assert(r.json.total === r.json.items.length, `filtered total ${r.json.total} != items ${r.json.items.length}`);
    },
  },
  {
    name: "L.ordering-stable",
    run: async () => {
      const ids = [];
      for (const t of ["o1", "o2", "o3"]) {
        const r = await req(base, "POST", "/tasks", { title: `${nonce}-${t}` });
        ids.push(r.json.id);
      }
      const all = await req(base, "GET", "/tasks" + qs({ limit: 1000000, offset: 0 }));
      const seq = all.json.items.map((x) => x.id);
      const pos = ids.map((id) => seq.indexOf(id));
      assert(pos[0] >= 0 && pos[0] < pos[1] && pos[1] < pos[2], `creation order not preserved: ${pos}`);
    },
  },
];

export const tests = (base, nonce = "t") => [...s2(base, nonce), ...only(base, nonce)];

// S2 conformance — CUMULATIVE: S1 + status state machine.
import { req, assert } from "../../../lib/http.mjs";
import { tests as s1 } from "./s1.mjs";

export const stage = "S2";

async function mk(base, nonce, t) {
  const r = await req(base, "POST", "/tasks", { title: `${nonce}-${t}` });
  return r.json.id;
}

const only = (base, nonce) => [
  {
    name: "S.open-to-inprogress",
    run: async () => {
      const id = await mk(base, nonce, "s1");
      const r = await req(base, "POST", `/tasks/${id}/status`, { status: "in_progress" });
      assert(r.status === 200 && r.json.status === "in_progress", `${r.status} ${JSON.stringify(r.json)}`);
    },
  },
  {
    name: "S.inprogress-to-done",
    run: async () => {
      const id = await mk(base, nonce, "s2");
      await req(base, "POST", `/tasks/${id}/status`, { status: "in_progress" });
      const r = await req(base, "POST", `/tasks/${id}/status`, { status: "done" });
      assert(r.status === 200 && r.json.status === "done", `${r.status}`);
    },
  },
  {
    name: "S.open-to-cancelled",
    run: async () => {
      const id = await mk(base, nonce, "s3");
      const r = await req(base, "POST", `/tasks/${id}/status`, { status: "cancelled" });
      assert(r.status === 200, `${r.status}`);
    },
  },
  {
    name: "S.invalid-open-to-done-409",
    run: async () => {
      const id = await mk(base, nonce, "s4");
      const r = await req(base, "POST", `/tasks/${id}/status`, { status: "done" });
      assert(r.status === 409, `expected 409, got ${r.status}`);
    },
  },
  {
    name: "S.terminal-done-409",
    run: async () => {
      const id = await mk(base, nonce, "s5");
      await req(base, "POST", `/tasks/${id}/status`, { status: "in_progress" });
      await req(base, "POST", `/tasks/${id}/status`, { status: "done" });
      const r = await req(base, "POST", `/tasks/${id}/status`, { status: "in_progress" });
      assert(r.status === 409, `expected 409 from terminal, got ${r.status}`);
    },
  },
  {
    name: "S.unknown-status-422",
    run: async () => {
      const id = await mk(base, nonce, "s6");
      const r = await req(base, "POST", `/tasks/${id}/status`, { status: "frobnicate" });
      assert(r.status === 422, `expected 422, got ${r.status}`);
    },
  },
  {
    name: "S.status-missing-task-404",
    run: async () => {
      const r = await req(base, "POST", `/tasks/${nonce}-nope/status`, { status: "in_progress" });
      assert(r.status === 404, `expected 404, got ${r.status}`);
    },
  },
];

export const tests = (base, nonce = "t") => [...s1(base, nonce), ...only(base, nonce)];

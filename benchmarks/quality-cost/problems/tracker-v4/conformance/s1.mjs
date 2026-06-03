// S1 conformance for tracker-v4. Server-generated ids; nonce only namespaces titles.
import { req, assert } from "../../../lib/http.mjs";

export const stage = "S1";

export const tests = (base, nonce = "t") => [
  {
    name: "K.create-201",
    run: async () => {
      const r = await req(base, "POST", "/tasks", { title: `${nonce}-a` });
      assert(r.status === 201, `expected 201, got ${r.status}`);
      assert(r.json && r.json.id && r.json.title === `${nonce}-a` && r.json.status === "open",
        `bad body ${JSON.stringify(r.json)}`);
    },
  },
  {
    name: "K.create-empty-title-400",
    run: async () => {
      const r = await req(base, "POST", "/tasks", { title: "" });
      assert(r.status === 400, `expected 400, got ${r.status}`);
    },
  },
  {
    name: "K.get-task",
    run: async () => {
      const c = await req(base, "POST", "/tasks", { title: `${nonce}-g` });
      const r = await req(base, "GET", `/tasks/${c.json.id}`);
      assert(r.status === 200 && r.json.title === `${nonce}-g` && r.json.status === "open",
        `bad body ${JSON.stringify(r.json)}`);
    },
  },
  {
    name: "K.get-missing-404",
    run: async () => {
      const r = await req(base, "GET", `/tasks/${nonce}-nope`);
      assert(r.status === 404, `expected 404, got ${r.status}`);
    },
  },
];

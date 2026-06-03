// S1 conformance for ticketing-v2 — black-box, nonce-namespaced event ids.
import { req, assert } from "../../../lib/http.mjs";

export const stage = "S1";

async function newEvent(base, id, capacity) {
  return req(base, "POST", "/events", { id, capacity });
}
async function hold(base, eid, seats) {
  return req(base, "POST", `/events/${eid}/hold`, { seats });
}

export const tests = (base, nonce = "t") => {
  const id = (s) => `${nonce}-${s}`;
  return [
    {
      name: "T.create-event-201",
      run: async () => {
        const r = await newEvent(base, id("ev-create"), 100);
        assert(r.status === 201, `expected 201, got ${r.status}`);
        assert(r.json && r.json.available === 100 && r.json.held === 0 && r.json.confirmed === 0,
          `bad body ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "T.create-bad-capacity-400",
      run: async () => {
        const r = await newEvent(base, id("ev-badcap"), 0);
        assert(r.status === 400, `expected 400, got ${r.status}`);
      },
    },
    {
      name: "T.create-duplicate-409",
      run: async () => {
        await newEvent(base, id("ev-dup"), 10);
        const r = await newEvent(base, id("ev-dup"), 10);
        assert(r.status === 409, `expected 409, got ${r.status}`);
      },
    },
    {
      name: "T.get-missing-404",
      run: async () => {
        const r = await req(base, "GET", `/events/${id("ev-nope")}`);
        assert(r.status === 404, `expected 404, got ${r.status}`);
      },
    },
    {
      name: "T.hold-reduces-available",
      run: async () => {
        const e = id("ev-hold");
        await newEvent(base, e, 100);
        const h = await hold(base, e, 30);
        assert(h.status === 201 && h.json.state === "held", `bad hold ${h.status} ${JSON.stringify(h.json)}`);
        const g = await req(base, "GET", `/events/${e}`);
        assert(g.json.held === 30 && g.json.available === 70, `bad accounting ${JSON.stringify(g.json)}`);
      },
    },
    {
      name: "T.hold-insufficient-409",
      run: async () => {
        const e = id("ev-insuf");
        await newEvent(base, e, 10);
        const h = await hold(base, e, 11);
        assert(h.status === 409, `expected 409, got ${h.status}`);
        const g = await req(base, "GET", `/events/${e}`);
        assert(g.json.held === 0 && g.json.available === 10, `state changed ${JSON.stringify(g.json)}`);
      },
    },
    {
      name: "T.hold-nonpositive-422",
      run: async () => {
        const e = id("ev-np");
        await newEvent(base, e, 10);
        const h = await hold(base, e, 0);
        assert(h.status === 422, `expected 422, got ${h.status}`);
      },
    },
    {
      name: "T.confirm-moves-held-to-confirmed",
      run: async () => {
        const e = id("ev-conf");
        await newEvent(base, e, 100);
        const h = await hold(base, e, 40);
        const c = await req(base, "POST", `/holds/${h.json.holdId}/confirm`);
        assert(c.status === 200 && c.json.state === "confirmed", `bad confirm ${c.status} ${JSON.stringify(c.json)}`);
        const g = await req(base, "GET", `/events/${e}`);
        assert(g.json.held === 0 && g.json.confirmed === 40 && g.json.available === 60,
          `bad accounting ${JSON.stringify(g.json)}`);
      },
    },
    {
      name: "T.confirm-idempotent-no-doublecount",
      run: async () => {
        const e = id("ev-confidem");
        await newEvent(base, e, 100);
        const h = await hold(base, e, 25);
        await req(base, "POST", `/holds/${h.json.holdId}/confirm`);
        const c2 = await req(base, "POST", `/holds/${h.json.holdId}/confirm`);
        assert(c2.status === 200, `expected idempotent 200, got ${c2.status}`);
        const g = await req(base, "GET", `/events/${e}`);
        assert(g.json.confirmed === 25 && g.json.available === 75,
          `double-counted ${JSON.stringify(g.json)}`);
      },
    },
    {
      name: "T.cancel-releases-seats",
      run: async () => {
        const e = id("ev-cancel");
        await newEvent(base, e, 100);
        const h = await hold(base, e, 50);
        const c = await req(base, "POST", `/holds/${h.json.holdId}/cancel`);
        assert(c.status === 200 && c.json.state === "cancelled", `bad cancel ${c.status} ${JSON.stringify(c.json)}`);
        const g = await req(base, "GET", `/events/${e}`);
        assert(g.json.held === 0 && g.json.available === 100, `not released ${JSON.stringify(g.json)}`);
      },
    },
    {
      name: "T.cancel-idempotent-no-doublerelease",
      run: async () => {
        const e = id("ev-cancelidem");
        await newEvent(base, e, 100);
        const h1 = await hold(base, e, 60);
        const h2 = await hold(base, e, 20);
        await req(base, "POST", `/holds/${h1.json.holdId}/cancel`);
        const c2 = await req(base, "POST", `/holds/${h1.json.holdId}/cancel`);
        assert(c2.status === 200, `expected idempotent 200, got ${c2.status}`);
        const g = await req(base, "GET", `/events/${e}`);
        // only h2 (20) still held; available = 80
        assert(g.json.held === 20 && g.json.available === 80, `bad release ${JSON.stringify(g.json)}`);
      },
    },
    {
      name: "T.cancel-after-confirm-409",
      run: async () => {
        const e = id("ev-cac");
        await newEvent(base, e, 100);
        const h = await hold(base, e, 10);
        await req(base, "POST", `/holds/${h.json.holdId}/confirm`);
        const x = await req(base, "POST", `/holds/${h.json.holdId}/cancel`);
        assert(x.status === 409, `expected 409, got ${x.status}`);
      },
    },
    {
      name: "T.confirm-after-cancel-409",
      run: async () => {
        const e = id("ev-cfc");
        await newEvent(base, e, 100);
        const h = await hold(base, e, 10);
        await req(base, "POST", `/holds/${h.json.holdId}/cancel`);
        const x = await req(base, "POST", `/holds/${h.json.holdId}/confirm`);
        assert(x.status === 409, `expected 409, got ${x.status}`);
      },
    },
    {
      name: "T.unknown-hold-404",
      run: async () => {
        const c = await req(base, "POST", `/holds/${id("no-such-hold")}/confirm`);
        assert(c.status === 404, `expected 404, got ${c.status}`);
      },
    },
    {
      name: "T.fill-exactly-then-reject",
      run: async () => {
        const e = id("ev-fill");
        await newEvent(base, e, 10);
        const a = await hold(base, e, 7);
        const b = await hold(base, e, 3);
        assert(a.status === 201 && b.status === 201, `fills failed ${a.status}/${b.status}`);
        const over = await hold(base, e, 1);
        assert(over.status === 409, `expected 409 when full, got ${over.status}`);
        const g = await req(base, "GET", `/events/${e}`);
        assert(g.json.available === 0 && g.json.held === 10, `bad full state ${JSON.stringify(g.json)}`);
      },
    },
  ];
};

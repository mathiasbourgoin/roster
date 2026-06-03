// S1 conformance for reservations-v3 — black-box, nonce-namespaced room ids.
import { req, assert } from "../../../lib/http.mjs";

export const stage = "S1";

async function room(base, id) {
  return req(base, "POST", "/rooms", { id });
}
async function reserve(base, rid, start, end, holder = "h") {
  return req(base, "POST", `/rooms/${rid}/reserve`, { start, end, holder });
}

export const tests = (base, nonce = "t") => {
  const id = (s) => `${nonce}-${s}`;
  return [
    {
      name: "R.create-room-201",
      run: async () => {
        const r = await room(base, id("rm-create"));
        assert(r.status === 201, `expected 201, got ${r.status}`);
      },
    },
    {
      name: "R.create-duplicate-409",
      run: async () => {
        await room(base, id("rm-dup"));
        const r = await room(base, id("rm-dup"));
        assert(r.status === 409, `expected 409, got ${r.status}`);
      },
    },
    {
      name: "R.reserve-ok-201",
      run: async () => {
        const rm = id("rm-ok");
        await room(base, rm);
        const r = await reserve(base, rm, 10, 20);
        assert(r.status === 201 && r.json.state === "active", `bad reserve ${r.status} ${JSON.stringify(r.json)}`);
      },
    },
    {
      name: "R.adjacent-after-ok",
      run: async () => {
        const rm = id("rm-adjA");
        await room(base, rm);
        const a = await reserve(base, rm, 10, 20);
        const b = await reserve(base, rm, 20, 30); // touches at 20 -> NOT overlap
        assert(a.status === 201 && b.status === 201, `adjacency rejected: ${a.status}/${b.status}`);
      },
    },
    {
      name: "R.adjacent-before-ok",
      run: async () => {
        const rm = id("rm-adjB");
        await room(base, rm);
        const a = await reserve(base, rm, 20, 30);
        const b = await reserve(base, rm, 10, 20); // touches at 20 -> NOT overlap
        assert(a.status === 201 && b.status === 201, `adjacency rejected: ${a.status}/${b.status}`);
      },
    },
    {
      name: "R.partial-overlap-409",
      run: async () => {
        const rm = id("rm-partial");
        await room(base, rm);
        await reserve(base, rm, 10, 20);
        const b = await reserve(base, rm, 15, 25);
        assert(b.status === 409, `expected 409, got ${b.status}`);
      },
    },
    {
      name: "R.contained-overlap-409",
      run: async () => {
        const rm = id("rm-contained");
        await room(base, rm);
        await reserve(base, rm, 10, 30);
        const b = await reserve(base, rm, 15, 20); // inside
        assert(b.status === 409, `expected 409, got ${b.status}`);
      },
    },
    {
      name: "R.enclosing-overlap-409",
      run: async () => {
        const rm = id("rm-enclosing");
        await room(base, rm);
        await reserve(base, rm, 15, 20);
        const b = await reserve(base, rm, 10, 30); // encloses
        assert(b.status === 409, `expected 409, got ${b.status}`);
      },
    },
    {
      name: "R.identical-overlap-409",
      run: async () => {
        const rm = id("rm-identical");
        await room(base, rm);
        await reserve(base, rm, 10, 20);
        const b = await reserve(base, rm, 10, 20);
        assert(b.status === 409, `expected 409, got ${b.status}`);
      },
    },
    {
      name: "R.start-ge-end-422",
      run: async () => {
        const rm = id("rm-bad");
        await room(base, rm);
        const r = await reserve(base, rm, 20, 20);
        assert(r.status === 422, `expected 422, got ${r.status}`);
      },
    },
    {
      name: "R.non-integer-422",
      run: async () => {
        const rm = id("rm-nonint");
        await room(base, rm);
        const r = await reserve(base, rm, 10.5, 20);
        assert(r.status === 422, `expected 422, got ${r.status}`);
      },
    },
    {
      name: "R.reserve-missing-room-404",
      run: async () => {
        const r = await reserve(base, id("rm-ghost"), 10, 20);
        assert(r.status === 404, `expected 404, got ${r.status}`);
      },
    },
    {
      name: "R.cancel-frees-interval",
      run: async () => {
        const rm = id("rm-free");
        await room(base, rm);
        const a = await reserve(base, rm, 10, 20);
        const c = await req(base, "POST", `/reservations/${a.json.reservationId}/cancel`);
        assert(c.status === 200, `cancel ${c.status}`);
        const b = await reserve(base, rm, 10, 20); // freed -> should succeed
        assert(b.status === 201, `expected re-reserve 201, got ${b.status}`);
      },
    },
    {
      name: "R.cancel-idempotent",
      run: async () => {
        const rm = id("rm-cidem");
        await room(base, rm);
        const a = await reserve(base, rm, 10, 20);
        await req(base, "POST", `/reservations/${a.json.reservationId}/cancel`);
        const c2 = await req(base, "POST", `/reservations/${a.json.reservationId}/cancel`);
        assert(c2.status === 200, `expected idempotent 200, got ${c2.status}`);
      },
    },
    {
      name: "R.different-rooms-independent",
      run: async () => {
        const r1 = id("rm-indep1"), r2 = id("rm-indep2");
        await room(base, r1);
        await room(base, r2);
        const a = await reserve(base, r1, 10, 20);
        const b = await reserve(base, r2, 10, 20); // different room -> ok
        assert(a.status === 201 && b.status === 201, `rooms not independent: ${a.status}/${b.status}`);
      },
    },
    {
      name: "R.cancel-unknown-404",
      run: async () => {
        const c = await req(base, "POST", `/reservations/${id("no-such-resv")}/cancel`);
        assert(c.status === 404, `expected 404, got ${c.status}`);
      },
    },
  ];
};

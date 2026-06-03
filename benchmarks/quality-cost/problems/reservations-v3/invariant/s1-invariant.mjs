// Differential check of `no-overlap` for reservations-v3. Black-box, nonce-namespaced.
// Recomputes pairwise overlap among ACTIVE reservations from GET — independent of impl.
import { req } from "../../../lib/http.mjs";

export const id = "no-overlap";

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end; // half-open
}

async function activeReservations(base, rm) {
  const r = await req(base, "GET", `/rooms/${rm}/reservations`);
  const list = (r.json && r.json.reservations) || [];
  return list.filter((x) => x.state === "active");
}

function checkNoOverlap(active, violations, label) {
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (overlaps(active[i], active[j])) {
        violations.push(`${label}: overlap [${active[i].start},${active[i].end}) & [${active[j].start},${active[j].end})`);
      }
    }
  }
}

export async function check(base, nonce = "t") {
  const violations = [];
  const mk = (s) => `${nonce}-${s}`;

  // (a) mix of reserves (some should be rejected) + a cancel, then recompute.
  const rm = mk("inv-mix");
  await req(base, "POST", "/rooms", { id: rm });
  const attempts = [
    [0, 10], [10, 20], [20, 30], // adjacency chain -> all allowed
    [5, 15],   // overlaps -> rejected
    [25, 28],  // fits inside [20,30)? overlaps [20,30) -> rejected
    [30, 40],  // adjacent to 30 -> allowed
  ];
  const ids = [];
  for (const [s, e] of attempts) {
    const r = await req(base, "POST", `/rooms/${rm}/reserve`, { start: s, end: e, holder: "h" });
    if (r.status === 201) ids.push(r.json.reservationId);
  }
  if (ids[0]) await req(base, "POST", `/reservations/${ids[0]}/cancel`);
  checkNoOverlap(await activeReservations(base, rm), violations, "mix");

  // (b) concurrent burst of mutually-overlapping reserves on one room: at most one may be active.
  const rm2 = mk("inv-burst");
  await req(base, "POST", "/rooms", { id: rm2 });
  const burst = [];
  for (let k = 0; k < 30; k++) {
    // all overlap the window [100,200)
    burst.push(req(base, "POST", `/rooms/${rm2}/reserve`, { start: 100 + k, end: 200 - k, holder: "h" }));
  }
  await Promise.all(burst);
  const active2 = await activeReservations(base, rm2);
  checkNoOverlap(active2, violations, "burst");

  return { ok: violations.length === 0, violations };
}

// Differential check of `capacity-safety` for ticketing-v2. Black-box, nonce-namespaced.
// Three probes: (a) a mixed sequence then accounting consistency; (b) a CONCURRENT oversell
// burst — many simultaneous holds that together exceed capacity must never oversell;
// (c) concurrent idempotent confirms of one hold must count once.
import { req } from "../../../lib/http.mjs";

export const id = "capacity-safety";

async function ev(base, eid) {
  const r = await req(base, "GET", `/events/${eid}`);
  return r.json || {};
}

export async function check(base, nonce = "t") {
  const violations = [];
  const mk = (s) => `${nonce}-${s}`;

  // (a) mixed sequence
  const e1 = mk("inv-mix");
  await req(base, "POST", "/events", { id: e1, capacity: 50 });
  const h = [];
  for (const seats of [10, 5, 20, 8]) {
    const r = await req(base, "POST", `/events/${e1}/hold`, { seats });
    if (r.status === 201) h.push(r.json.holdId);
  }
  if (h[0]) await req(base, "POST", `/holds/${h[0]}/confirm`);
  if (h[1]) await req(base, "POST", `/holds/${h[1]}/cancel`);
  const s1 = await ev(base, e1);
  if (!(s1.held >= 0 && s1.confirmed >= 0)) violations.push(`negatives ${JSON.stringify(s1)}`);
  if (s1.available !== s1.capacity - s1.held - s1.confirmed)
    violations.push(`available mismatch ${JSON.stringify(s1)}`);
  if (s1.held + s1.confirmed > s1.capacity) violations.push(`over capacity ${JSON.stringify(s1)}`);

  // (b) concurrent oversell burst: capacity 50, fire 120 concurrent holds of 1 seat.
  const e2 = mk("inv-burst");
  await req(base, "POST", "/events", { id: e2, capacity: 50 });
  const burst = [];
  for (let k = 0; k < 120; k++) burst.push(req(base, "POST", `/events/${e2}/hold`, { seats: 1 }));
  const results = await Promise.all(burst);
  const accepted = results.filter((r) => r.status === 201).length;
  if (accepted > 50) violations.push(`oversold: ${accepted} holds accepted for capacity 50`);
  const s2 = await ev(base, e2);
  if (s2.held > 50) violations.push(`held ${s2.held} > capacity 50 after burst`);
  if (s2.available < 0) violations.push(`negative available ${s2.available} after burst`);
  if (s2.held + s2.confirmed > s2.capacity) violations.push(`over capacity after burst ${JSON.stringify(s2)}`);

  // (c) concurrent idempotent confirms of one hold must count once.
  const e3 = mk("inv-idem");
  await req(base, "POST", "/events", { id: e3, capacity: 100 });
  const hr = await req(base, "POST", `/events/${e3}/hold`, { seats: 10 });
  if (hr.status === 201) {
    const confirms = [];
    for (let k = 0; k < 12; k++) confirms.push(req(base, "POST", `/holds/${hr.json.holdId}/confirm`));
    await Promise.all(confirms);
    const s3 = await ev(base, e3);
    if (s3.confirmed !== 10) violations.push(`idempotency under concurrency: confirmed=${s3.confirmed}, expected 10`);
    if (s3.available !== 90) violations.push(`idem accounting: available=${s3.available}, expected 90`);
  }

  return { ok: violations.length === 0, violations };
}

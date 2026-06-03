// Differential check for tracker-v4: version monotonicity + idempotency under a concurrent burst.
import { req } from "../../../lib/http.mjs";

export const id = "version-monotonic-and-idempotent";

async function total(base) {
  const r = await req(base, "GET", "/tasks?limit=1000000&offset=0");
  return r.json ? r.json.total : NaN;
}

export async function check(base, nonce = "t") {
  const v = [];

  // monotonicity: version starts 1, +1 per successful status change, never skips/decreases.
  const c = await req(base, "POST", "/tasks", { title: `${nonce}-mono` });
  if (!c.json || c.json.version !== 1) v.push(`create version ${c.json && c.json.version} != 1`);
  await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "in_progress" });
  let g = await req(base, "GET", `/tasks/${c.json.id}`);
  if (g.json.version !== 2) v.push(`after 1 change version ${g.json.version} != 2`);
  await req(base, "POST", `/tasks/${c.json.id}/status`, { status: "done" });
  g = await req(base, "GET", `/tasks/${c.json.id}`);
  if (g.json.version !== 3) v.push(`after 2 changes version ${g.json.version} != 3`);

  // idempotency under concurrency: 15 concurrent creates with one key -> exactly one task.
  const key = `${nonce}-burstkey`;
  const before = await total(base);
  const burst = [];
  for (let k = 0; k < 15; k++)
    burst.push(req(base, "POST", "/tasks", { title: `${nonce}-burst` }, { "Idempotency-Key": key }));
  const results = await Promise.all(burst);
  const after = await total(base);
  const ids = new Set(results.filter((r) => r.json && r.json.id).map((r) => r.json.id));
  if (after - before !== 1) v.push(`idempotent burst created ${after - before} tasks, expected 1`);
  if (ids.size !== 1) v.push(`idempotent burst returned ${ids.size} distinct ids, expected 1`);

  return { ok: v.length === 0, violations: v };
}

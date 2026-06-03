// Differential check of the named invariant `balance-conservation`. Black-box.
// Seeds nonce-namespaced accounts, records total, fires sequential transfers
// (some that MUST be rejected) AND a CONCURRENT burst of overlapping transfers
// (best-effort atomicity stress), then asserts total money is conserved and no
// balance is negative. Independent of how the project implements transfers.
//
// Note (review M3): on a single-threaded server the concurrent burst is a weak
// atomicity probe; it catches lost-update/non-atomic bugs that have an await gap
// between read and write, but cannot prove strict serializability. The claim is
// "sequential conservation + rejection-atomicity + concurrent-burst conservation",
// not "provably serializable".
import { req } from "../../../lib/http.mjs";

export const id = "balance-conservation";

async function sumBalances(base, ids) {
  let total = 0;
  for (const id of ids) {
    const r = await req(base, "GET", `/accounts/${id}`);
    total += r.json ? r.json.balance : 0;
  }
  return total;
}

export async function check(base, nonce = "t") {
  const violations = [];
  const mk = (s) => `${nonce}-${s}`;
  const ids = [mk("inv-a"), mk("inv-b"), mk("inv-c")];
  for (const i of ids) await req(base, "POST", "/accounts", { id: i });
  await req(base, "POST", `/accounts/${ids[0]}/deposit`, { amount: 100 });
  await req(base, "POST", `/accounts/${ids[1]}/deposit`, { amount: 50 });

  const total0 = await sumBalances(base, ids);

  // Sequential mix incl. an overdraft that must be rejected with no partial effect.
  const ops = [
    { from: ids[0], to: ids[1], amount: 30 },
    { from: ids[1], to: ids[2], amount: 1000 }, // overdraft -> must be rejected
    { from: ids[0], to: ids[2], amount: 20 },
    { from: ids[2], to: ids[0], amount: 5 },
  ];
  for (const op of ops) await req(base, "POST", "/transfer", op);

  // Concurrent burst of small overlapping transfers (atomicity stress).
  const burst = [];
  for (let k = 0; k < 24; k++) {
    burst.push(req(base, "POST", "/transfer", { from: ids[k % 3], to: ids[(k + 1) % 3], amount: 1 }));
  }
  await Promise.all(burst);

  const total1 = await sumBalances(base, ids);
  if (total1 !== total0) {
    violations.push(`conservation: total changed ${total0} -> ${total1}`);
  }
  for (const i of ids) {
    const r = await req(base, "GET", `/accounts/${i}`);
    const bal = r.json ? r.json.balance : 0;
    if (bal < 0) violations.push(`negative balance: ${i} = ${bal}`);
  }
  return { ok: violations.length === 0, violations };
}

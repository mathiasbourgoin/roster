// CORRECT reference ledger — a scorer fixture, NOT the canonical answer.
// Exists only to exercise the eval harness end-to-end. In-memory, atomic transfers.
import http from "node:http";

const accounts = new Map();

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(obj === undefined ? "" : JSON.stringify(obj));
}
async function readBody(req) {
  let b = "";
  for await (const c of req) b += c;
  if (!b) return {};
  try {
    return JSON.parse(b);
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://x");
  const parts = pathname.split("/").filter(Boolean);
  const body = req.method === "POST" ? await readBody(req) : {};

  // POST /accounts {id}
  if (req.method === "POST" && parts.length === 1 && parts[0] === "accounts") {
    const id = body.id;
    if (typeof id !== "string" || !id) return send(res, 400, { error: "id required" });
    if (accounts.has(id)) return send(res, 409, { error: "exists" });
    accounts.set(id, 0);
    return send(res, 201, { id, balance: 0 });
  }
  // GET /accounts/:id
  if (req.method === "GET" && parts.length === 2 && parts[0] === "accounts") {
    const id = parts[1];
    if (!accounts.has(id)) return send(res, 404, { error: "not found" });
    return send(res, 200, { id, balance: accounts.get(id) });
  }
  // POST /accounts/:id/deposit {amount}
  if (req.method === "POST" && parts.length === 3 && parts[0] === "accounts" && parts[2] === "deposit") {
    const id = parts[1];
    const amt = body.amount;
    if (!accounts.has(id)) return send(res, 404, { error: "not found" });
    if (typeof amt !== "number" || !(amt > 0)) return send(res, 422, { error: "amount must be > 0" });
    accounts.set(id, accounts.get(id) + amt);
    return send(res, 200, { id, balance: accounts.get(id) });
  }
  // POST /accounts/:id/withdraw {amount}
  if (req.method === "POST" && parts.length === 3 && parts[0] === "accounts" && parts[2] === "withdraw") {
    const id = parts[1];
    const amt = body.amount;
    if (!accounts.has(id)) return send(res, 404, { error: "not found" });
    if (typeof amt !== "number" || !(amt > 0)) return send(res, 422, { error: "amount must be > 0" });
    if (accounts.get(id) < amt) return send(res, 422, { error: "insufficient funds" });
    accounts.set(id, accounts.get(id) - amt);
    return send(res, 200, { id, balance: accounts.get(id) });
  }
  // POST /transfer {from,to,amount} — atomic
  if (req.method === "POST" && parts.length === 1 && parts[0] === "transfer") {
    const { from, to, amount } = body;
    if (!accounts.has(from) || !accounts.has(to)) return send(res, 404, { error: "account not found" });
    if (typeof amount !== "number" || !(amount > 0)) return send(res, 422, { error: "amount must be > 0" });
    if (from === to) return send(res, 422, { error: "same account" });
    if (accounts.get(from) < amount) return send(res, 422, { error: "insufficient funds" });
    accounts.set(from, accounts.get(from) - amount);
    accounts.set(to, accounts.get(to) + amount);
    return send(res, 200, {
      from: { id: from, balance: accounts.get(from) },
      to: { id: to, balance: accounts.get(to) },
    });
  }
  return send(res, 404, { error: "unknown route" });
});

server.listen(Number(process.env.PORT || 0), "127.0.0.1", () => {
  console.log("LISTENING " + server.address().port);
});

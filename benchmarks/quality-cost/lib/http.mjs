// Minimal stack-agnostic HTTP helpers for black-box conformance testing.
// The eval harness is Node, but it tests a project written in ANY stack, purely
// over the HTTP/JSON contract — it never reads the project's source.

export async function req(base, method, path, body, extraHeaders = {}) {
  const headers = {
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...extraHeaders,
  };
  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text };
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Ready when the server returns ANY HTTP response (even 404); a connection
// error means not-up-yet. No /health endpoint is mandated by the contract.
export async function waitForReady(base, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(base + "/", { method: "GET" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`server at ${base} not ready within ${timeoutMs}ms`);
}

"use strict";

// Read model of the advisory requests annex: due-ness, ordering, text block and prompt
// projection. It never throws for an invalid annex and never influences claim/next.
const requests = () => require("./roster-roadmap-requests.cjs");
const core = () => require("./roster-roadmap.cjs");
const RANK = { now: 0, later: 1, unscheduled: 2 };
const LIMIT = 512 * 1024;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const INVISIBLE = new RegExp("[\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2069\\ufeff]", "g");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clean = value => String(value ?? "").replace(CONTROL, " ").replace(INVISIBLE, "");
function cut(value, max) { const text = clean(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }
function zeroCounts() { return { open: 0, now: 0, later: 0, unscheduled: 0, answered: 0, withdrawn: 0, archived: 0 }; }
function empty(status, reason = null) {
  return { status, reason, revision: status === "absent" ? 0 : null, journal: null, counts: zeroCounts(), items: [], truncated: false };
}

function taskState(ctx, id) {
  if (id === null) return { state: null, task: null };
  const tasks = Array.isArray(ctx.contract.tasks) ? ctx.contract.tasks : [];
  const task = tasks.find(other => other.id === id);
  if (!task) return { state: "unknown", task: null };
  if (!ctx.state.acceptance) return { state: "draft", task };
  return { state: Object.hasOwn(ctx.state.tasks, id) ? ctx.state.tasks[id].status : "unknown", task };
}
function dueFor(ctx, request, bound) {
  if (request.status !== "open") return null;
  if (request.need === "blocking") return "now";
  if (bound.state === null || bound.state === "unknown") return "unscheduled";
  if (request.need === "later") return "later";
  if (bound.state === "done") return "unscheduled";
  if (bound.state === "active" || bound.state === "blocked") return "now";
  if (bound.state === "queued") return core().canClaimBasic(ctx, bound.task) === null ? "now" : "later";
  return "later";
}
function decorate(ctx, request, supersededBy) {
  const bound = taskState(ctx, request.task_id);
  const closedAt = request.answer?.at ?? request.withdrawal?.at ?? null;
  return { ...request, due: dueFor(ctx, request, bound), task_state: bound.state, closed_at: closedAt, superseded_by: supersededBy.get(request.id) ?? null };
}
function visible(item) { return item.status === "open" || item.task_state !== "done"; }
function order(items) {
  const open = items.filter(item => item.status === "open").sort((a, b) => RANK[a.due] - RANK[b.due] || cmp(a.created_at, b.created_at) || cmp(a.id, b.id));
  const closed = items.filter(item => item.status !== "open").sort((a, b) => cmp(b.closed_at, a.closed_at) || cmp(a.id, b.id));
  return [...open, ...closed];
}
function fit(items) {
  const sizes = items.map(item => Buffer.byteLength(JSON.stringify(item), "utf8") + 1);
  let total = sizes.reduce((sum, size) => sum + size, 0), keep = items.length;
  while (total > LIMIT && keep > 0 && items[keep - 1].status !== "open") total -= sizes[--keep];
  return items.slice(0, keep);
}
function build(ctx, read) {
  if (read.status === "invalid") return empty("invalid", clean(read.reason));
  if (read.status === "absent") return empty("absent");
  const { annex } = read;
  const supersededBy = new Map(annex.requests.filter(request => request.supersedes !== null).map(request => [request.supersedes, request.id]));
  const all = annex.requests.map(request => decorate(ctx, request, supersededBy));
  const items = fit(order(all.filter(visible)));
  const counts = zeroCounts();
  for (const item of all) {
    if (item.status === "open") { counts.open++; counts[item.due]++; } else counts[item.status]++;
  }
  counts.archived = all.filter(item => item.status !== "open").length - items.filter(item => item.status !== "open").length;
  return { status: "valid", reason: null, revision: annex.revision, journal: annex.journal, counts, items, truncated: items.length < all.filter(visible).length };
}
function observe(ctx) {
  try { return build(ctx, requests().readAnnex(ctx)); } catch (error) { return empty("invalid", clean(error.message)); }
}

function prefix(block) {
  if (block.status !== "valid" || block.counts.now === 0) return "";
  const labels = new Map();
  for (const item of block.items) if (item.due === "now") labels.set(clean(item.to.label), (labels.get(clean(item.to.label)) || 0) + 1);
  const parts = [...labels].map(([label, count]) => `${label} (${count})`);
  return `Waiting on ${parts.join(", ")}: ${block.counts.now} request(s) due now. `;
}
function versionInputs(block) {
  return [block.status, block.revision, block.items.filter(item => item.status === "open").map(item => [item.id, item.due])];
}
function idsFor(block, taskId) {
  return block.items.filter(item => item.status === "open" && item.task_id === taskId).map(item => item.id);
}
function line(item) {
  const id = clean(item.id);
  if (item.status === "answered") return `  [answered ${clean(item.answer.at)}] ${id} ← ${clean(item.answer.by)}: ${cut(item.answer.text, 160)}`;
  if (item.status === "withdrawn") return `  [withdrawn ${clean(item.withdrawal.at)}] ${id}: ${cut(item.withdrawal.reason, 160)}`;
  const task = item.task_id === null ? "unbound" : `task ${clean(item.task_id)}`;
  return `  [${item.due}] ${id} → ${clean(item.to.label)} (${clean(item.kind)}; ${task}): ${cut(item.text, 160)}`;
}
function textRows(block) {
  if (block.status === "invalid") return [`Waiting on: requests annex invalid — ${cut(block.reason, 200)}`];
  return block.items.length ? ["Waiting on:", ...block.items.map(line)] : [];
}

function trim(value) { return value.length > 300 ? `${value.slice(0, 300)}…[truncated]` : value; }
function promptItem(item) {
  const brief = { id: item.id, to: item.to, kind: item.kind, task_id: item.task_id, need: item.need, due: item.due, status: item.status, text: trim(item.text), refs_count: item.refs.length };
  return item.status === "answered" ? { ...brief, answer: { ...item.answer, text: trim(item.answer.text) } } : brief;
}
function forPrompt(ctx, taskId) {
  const block = observe(ctx);
  if (block.status === "invalid") return { status: "invalid", reason: block.reason };
  const keep = item => (taskId ? item.task_id === taskId && item.status !== "withdrawn"
    : item.status === "open" || (item.status === "answered" && item.task_id !== null && item.task_state !== "done"));
  return { status: block.status, revision: block.revision, journal: block.journal, items: block.items.filter(keep).map(promptItem) };
}

module.exports = { observe, prefix, versionInputs, idsFor, textRows, forPrompt };

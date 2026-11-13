"use strict";
// Bounded continuation prompt for the coordinator or one mission. Read-only projection.
const { integer, fail } = require("./roster-roadmap-validate.cjs");
const { missions } = require("./roster-roadmap-missions.cjs");
const core = () => require("./roster-roadmap.cjs");
const MISSION_CONTINUATION = "Perform only this bounded mission using its assigned identity and authorized native tools. Respect child Roster gates. Return a structured candidate receipt with actual checks and evidence to the coordinator, then stop at that bounded handoff. The coordinator alone records state and selects further work. Local completion leaves the global goal open. A stopped process requires explicit runtime-supported resume.";
const GLOBAL_CONTINUATION = "Local task completion is not global completion. Use authorized native runtime tools; respect child Roster gates. Verify, record the structured receipt, refresh next/prompt and continue while authorized progress exists, including through the final global verification and acceptance. If blocked, work another admissible branch or apply a declared recovery. When progress needs the operator, open a request (request-open) instead of pausing silently and continue other admissible work; relay the answer with request-answer; never put secrets in requests. Stop only after the global outcome is accepted, an explicit owner pause, or a declared stop/no admissible authorized progress remains. An ended process needs explicit runtime-supported resume; this tool does not keep it alive.";
function missionView(ctx, task) {
  const support = core().viewSupport, current = ctx.state.tasks[task.id];
  return {
    id: task.id, objective: task.objective, intake: task.intake, inputs: task.inputs, outputs: task.outputs,
    dependencies: task.depends_on.map(id => ({ id, status: ctx.state.tasks[id].status })), allowed_files: task.allowed_files,
    dod: task.dod, success: task.success, checks: task.checks, topology: task.topology,
    selected_route: current.assignment?.route || support.routeFor(ctx, task), assignment: current.assignment,
    policy: task.policy, workflow: task.workflow, progress: support.taskProgress(ctx, task),
    ...(task.derived ? { derived: require("./roster-roadmap-derived.cjs").derivedBlock(ctx, task) } : {}),
  };
}
function prompt(ctx, options) {
  const support = core().viewSupport, nextAction = support.next(ctx);
  const task = options.task ? core().taskById(ctx, options.task) : nextAction.task;
  const active = missions(ctx).filter(t => ctx.state.tasks[t.id].status === "active").map(t => ({ id: t.id, assignee: ctx.state.tasks[t.id].assignment.assignee, route: ctx.state.tasks[t.id].assignment.route }));
  const view = {
    goal: ctx.contract.goal, global_success: ctx.contract.success,
    current_state: { revision: ctx.state.revision, status: options.task ? ctx.state.tasks[task.id].status : nextAction.status, counts: support.status(ctx).counts, active },
    mission: task ? missionView(ctx, task) : null,
    next_action: options.task ? missionAction(ctx, task) : nextAction.next_action,
    operator_requests: require("./roster-roadmap-requests-view.cjs").forPrompt(ctx, options.task),
    references: { contract: "roadmap.json", capabilities: "capabilities.json", state: "state.json", notes: "notes/", candidates: "receipts/" },
    continuation: options.task ? MISSION_CONTINUATION : GLOBAL_CONTINUATION,
    assurance: "Identity labels, evidence references and reported writes are local assertions; no authentication, shell execution or filesystem sandbox is provided.",
  };
  const output = JSON.stringify(view, null, 2);
  const limit = options["max-chars"] === undefined ? 12000 : Number(options["max-chars"]);
  integer(limit, "--max-chars", 1, 1000000);
  if (output.length > limit) fail(`mandatory context overflow: ${output.length} characters exceeds ${limit}; close or withdraw operator requests, narrow the mission with --task, or explicitly increase --max-chars; never silently drop constraints`);
  return { prompt: output, characters: output.length, max_chars: limit };
}
function missionAction(ctx, task) {
  const current = ctx.state.tasks[task.id];
  if (current.status === "active") return `Execute only assigned task ${task.id}, verify its exit criteria and return its candidate receipt to the coordinator.`;
  if (current.status === "done") return `Task ${task.id} already has an accepted receipt; return that outcome to the coordinator without executing it again.`;
  if (current.status === "blocked") return `Return task ${task.id}'s blocking reason and receipt evidence to the coordinator for authorized reconciliation.`;
  return `Task ${task.id} has no active assignment; request its claim/assignment from the coordinator before executing and returning a receipt.`;
}
module.exports = { prompt, missionAction };

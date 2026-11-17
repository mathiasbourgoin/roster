"use strict";
// Leaf module: the mission set of a roadmap board. Missions are the contract tasks followed by
// derived correction missions (state.derived) in creation order. A derived mission resolves to a
// synthesized task object that inherits its scope from its parent contract task.
// Completion predicates are contract-only plus "no derived mission queued or active".
// It requires nothing from the roadmap core and tolerates draft or invalid contracts.
function contractTasks(ctx) { return Array.isArray(ctx.contract?.tasks) ? ctx.contract.tasks : []; }
function derivedEntries(ctx) {
  const derived = ctx.state?.derived;
  if (!derived || typeof derived !== "object" || Array.isArray(derived)) return [];
  return Object.entries(derived).sort((a, b) => a[1].revision - b[1].revision);
}
function synthesize(ctx, id, definition) {
  const parent = contractTasks(ctx).find(task => task.id === definition.parent);
  if (!parent) return null;
  return {
    id, intake: parent.intake, objective: definition.objective, depends_on: [],
    inputs: parent.inputs, outputs: parent.outputs, allowed_files: parent.allowed_files,
    dod: parent.dod, success: parent.success, checks: parent.checks, topology: definition.topology,
    policy: { max_attempts: definition.max_attempts, on_failure: "retry", stop_if: parent.policy?.stop_if, recovery: parent.policy?.recovery, failure: parent.policy?.failure },
    workflow: { recommendation: "none", reason: "Derived correction mission", steps: [] },
    derived: { parent: definition.parent, cause: definition.cause, revision: definition.revision },
  };
}
function derivedMissions(ctx) {
  return derivedEntries(ctx).map(([id, definition]) => synthesize(ctx, id, definition)).filter(Boolean);
}
function missions(ctx) { return [...contractTasks(ctx), ...derivedMissions(ctx)]; }
function missionById(ctx, id) { return missions(ctx).find(task => task.id === id) || null; }
function openDerivedIds(ctx, tasks = ctx.state.tasks) {
  return derivedEntries(ctx).map(([id]) => id).filter(id => ["queued", "active"].includes(tasks[id]?.status));
}
// Completion: every contract task done and no derived mission queued or active.
function completionReady(ctx, tasks = ctx.state.tasks) {
  return contractTasks(ctx).every(task => tasks[task.id]?.status === "done") && openDerivedIds(ctx, tasks).length === 0;
}
module.exports = { contractTasks, derivedEntries, derivedMissions, missions, missionById, openDerivedIds, completionReady };

"use strict";
// Leaf module: the mission set of a roadmap board. Missions are the contract tasks followed by
// derived missions in creation order. No derived missions exist yet, so the set is the contract
// tasks. Completion predicates stay contract-only and must not use these helpers.
// It requires nothing from the roadmap core and tolerates draft or invalid contracts.
function contractTasks(ctx) { return Array.isArray(ctx.contract?.tasks) ? ctx.contract.tasks : []; }
function missions(ctx) { return contractTasks(ctx); }
function missionById(ctx, id) { return missions(ctx).find(task => task.id === id) || null; }
module.exports = { contractTasks, missions, missionById };

# Estimate and revisit roadmap durations

When preparing or revisiting a roadmap, the planner estimates each mission's duration and
the final integrated verification separately. Use optimistic, likely and pessimistic minutes
with a reason and evidence. Record unknowns rather than manufacturing a zero or delivery date.
Owner deadlines are constraints; they are not evidence that the work fits the requested time.

The optional board-local `estimates.json` is independent of the accepted task contract and
execution state. Revising a duration does not amend goals/models, bypass review, reset retries
or mark work complete. The human status/JSON monitoring view can present both task ETA and
global ETA with their uncertainty, per-task remaining estimates and forecast revision.

Read the exact shapes in [the estimates schema](../schema/roadmap-estimates-schema.md).
Prepare an update file using the current accepted contract digest and execution revision;
include planner identity, capture timestamp, rationale, evidence and the complete current task
estimates. Then invoke the installed toolkit:

```bash
node .harness/bin/roster-roadmap.cjs estimate roadmaps/release --revision 0 --update /tmp/estimate-update.json
```

`--revision` is the forecast revision, initially zero; it is not the board execution revision.
Every update preserves prior forecast records. Refresh after a changed understanding of scope,
dependencies, verification burden or an observed overrun; do not rewrite durations on each poll.
Backdated captures are rejected before writing, preserving readable prior forecast history.
Missing estimates remain unknown in older boards and do not create a new planning approval gate.

For an active mission, timestamped claim events anchor elapsed time. An older board may lack
claim timestamps; capture explicit remaining minutes with that current assignment's attempt ID
and observation time. That estimate expires for another attempt. When an active task exceeds
its pessimistic range the ETA becomes unknown/reestimate-needed, with the original estimate
preserved. Reporting overdue work should prompt diagnosis, not a silently advancing deadline.

Forecasts use the dependency graph and available capacity, parallel authorization and write
scope limits. Their task ordering is deterministic rather than an optimal scheduling promise.
Queued tasks assume dispatch now, no retries and unchanged capabilities; dates are conditional.
Actual native tool availability, human delays, paused work and future failures can change them.
An active assignment with changed capability evidence or an unavailable/unauthorized assigned
route has unknown ETA until reconciled. Unaccepted drafts also have unknown ETA.
An unresolved blocker prevents a confident board ETA while its reason remains visible.

The global forecast additionally needs an explicit estimate for integrated verification.
All task receipts can be complete while global verification remains unknown or unfinished.
Only the separate accepted global receipt establishes completed outcome; dates or percentages
never substitute for it. There is no global-check start event, so the verification forecast
assumes dispatch after tasks finish rather than pretending to measure its live progress.

Monitoring is read-only: forecast generation does not launch tools, run checks, send messages,
activate hooks or mutate execution/estimate resources. Planner updates use the board lock and
optimistic forecast revisions; competing or stale updates refuse with their evidence intact.
Identity/evidence labels remain local assertions, not authentication or a time guarantee.

Installed schema reference: `.harness/roadmap/estimates-schema.md` (source-relative links above apply in a Roster checkout).

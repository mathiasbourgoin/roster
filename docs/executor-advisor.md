# Executor and adviser protocol

Use `/roster-executor` to delegate a bounded implementation or research contribution to an
available economy-tier worker. Use `/roster-advisor` to ask an available stronger adviser for
targeted direction when that advice can materially improve a task. These are optional, portable
roles; they do not add a provider adapter, hook, workflow engine, or pipeline gate.

## Inputs and precedence

Treat user `model`, `profile`, `route`, and `objective` choices as runtime hints, not a new
command-line interface or guarantee. Route values are `auto`, `sequential`, `subagent`, and
`multisession`; objective values are `cost`, `duration`, and `balanced`. `auto` means discover a
suitable currently available choice. A skill's configured tunables supply defaults. For example,
`.harness/harness.json` stores tunables in each matching `layers.skills` entry:
`{"name":"roster-executor","tunables":{"model":"auto","profile":"auto","route":"auto","objective":"cost","wait_seconds":60}}`.
`profile` means an observed runtime-supported configuration, not a magic provider preset. Resolve
inputs by precedence: owner constraints and an accepted assignment, explicit user choices,
per-skill tunables, then defaults. If explicit choices conflict, report the conflict and ask for
a corrected invocation; never silently choose one. Do not add parser or contract fields.

An exact requested model must not be silently substituted. If it is unavailable, report that
fact and stop the requested delegation. A `model:auto` choice may use another eligible model,
but report the choice and its evidence. Do not claim a model is universally strongest: adviser
selection is relative to the task and currently observed evidence.

## Discoverability and authority

Keep the current agent's model identity separate from the requested child model, configured
model, and child model observed after execution. Attach a source to each fact and use `unknown`
when identity is absent or unverified. A model listing does not prove a worker can be created.
Inspect local model/depth/slot controls separately from cross-session discovery, messaging,
creation, control, and return capabilities. Treat each as unknown unless current metadata or an
authorized tool confirms it. Existing-session messaging/control does not require session-create
permission; creating a new session does. Do not read unrelated conversations or launch a session
merely to fill a catalog.

`sequential` means same-agent work; `subagent` means a local delegated worker; `multisession`
means coordination across separate sessions. Each needs a supported route and relevant
authorization. A new session needs create permission; an existing session needs only the
authorized discovery, messaging, control, and return capabilities actually used. Distinguish
`auto` from an explicit route. With no usable route, proceed sequentially only when owner
constraints allow it and disclose that no worker/adviser was consulted. An advisor cannot consult
itself; a sequential advisor invocation reports that no independent adviser was available. If
delegation is required and unavailable, return blocked with the missing capability.

## Dispatch and return

Reuse `.harness/roadmap/resource-routing.md` (source: `docs/resource-routing.md`) when topology
or resource comparison is relevant; do not create a new analyzer schema or record speculative
measurements. Accepted assignments remain authoritative. Any model change requires the existing
revised-and-accepted contract process. The adviser provides optional advice, not an independent
review, approval, or GO/NO-GO decision.

Give each call one compact mission containing a stable task/mission and attempt/contribution
identity, goal, bounded scope, permitted writes, current state, relevant inputs, exact checks and
expected evidence, durable destination in existing plan/notes, and return envelope with next
action. Include context inline if the recipient cannot read the shared workspace. Return outcome,
evidence/check results, changed paths, decisions, pending questions, requested child model/source
versus observed actual model/source (or `unknown`), separately from caller identity and configured
model/source. Keep detailed prompts, catalogs, and transcripts out of shared artifacts. The
coordinator verifies the return and alone updates shared resource-analysis memory.

Consult selectively: after orientation and before consequential design, when blocked or
considering a strategy change, or before complex completion. Do not spend a consultation on
trivial work without a concrete decision question. Delegated workers and advisers are leaves;
they do not spawn or delegate further. A leaf records
partial edits/checks, sends a focused question to its parent, and yields; the parent relays the
same attempt to an available adviser and returns the answer to that worker. Do not assume a
finished or idle worker frees a slot: verify capacity, do permitted independent work, or report
the precise blocker. An unavailable or failed optional consultation returns `unavailable` or
`incomplete` with its evidence; it never invents advice. If advice was required by the owner,
report the precise blocker instead. Bound each wait to the per-skill `wait_seconds` default (60),
further limited by the parent's remaining task bound. A timeout ends waiting; it does not kill or
reset work. Before resuming, reconcile recipient, attempt, workspace, and receipt; never add a
second writer or replacement before reconciling the existing work. Preserve all quality gates
and ownership.

`/roster-run` may suggest these roles for suitable tasks. `/roster-roadmap` may use them only
within an accepted mission assignment, and `/roster-implement` may use a worker for a bounded
contribution while retaining coordinator responsibility. Express Lite's no-spawn/minimal-check
path is unchanged.

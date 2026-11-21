# Compare resource assignments by cost and elapsed time

Use `roster-analyze.cjs` to compare explicit model/session candidates for a task or a roadmap.
It is an offline, deterministic advisor: it reads snapshots and attempt receipts, produces JSON,
and makes no model calls. Run it from any runtime, including Codex, Claude, OpenCode and Pi.
It does not discover sessions, retrieve current prices, dispatch work or modify accepted topology.

## Try the comparison

From a Roster checkout, with Node 18 or newer:

```sh
node scripts/roster-analyze.cjs analyze --input examples/resource-analysis/input.json
node scripts/roster-analyze.cjs analyze --input examples/resource-analysis/input.json --objective duration
node scripts/roster-analyze.cjs analyze --input examples/resource-analysis/input.json --objective balanced --cost-weight 0.8
node scripts/roster-analyze.cjs analyze --input examples/resource-analysis/input.json --format compact
```

The example is entirely synthetic: model names, prices, availability, quotas and success estimates
are demonstrations, not a live resource catalog. Its `as_of` deliberately matches its snapshots.
For real use, supply a current UTC `as_of` and dated resource observations. Refresh snapshots
through your environment's supported tools; do not refresh a timestamp without refreshing its evidence.

`recommended` follows the requested objective. `proposals` compares cost, duration and balanced
choices. `pareto` contains up to 20 tradeoffs: a displayed plan cannot be improved in both cost
and duration by another enumerated plan. `pareto_omitted` reports truncation.
Each task candidate exposes exclusion reasons, warnings, sample counts and per-metric provenance.

`--format compact` returns the same chosen plan with its objective, exact parsed-input digest
(including attached memory and CLI policy overrides), totals, selected runtime/model/session,
sample counts, prior-based metrics, resource expiry, warnings and global assumptions. It omits
candidate tables, frontier and historical records. Alternatives contain only comparable totals.
Selected metric provenance is grouped by source, with each source capped at 256 UTF-16 units
and an explicit `truncated` flag; retain full reports for complete references. Global warnings
and per-task unpriced-option counts include eligible alternatives outside the selected plan:
a cheapest-known-price proposal does not establish that an unpriced option costs more.
Exit semantics are unchanged; a no-recommendation result stays explicit. Use compact output in
planner context and give a worker only its own row. See [the shared routing protocol](resource-routing.md)
for the roadmap/run/plan/implement integration and explicit result-recording procedure.

Exit codes: **0** means a recommendation exists, **2** means insufficient data/resources,
infeasible capacity or a search limit, and **1** means invalid input or an IO/setup error.
Successful output is JSON only; errors are JSON on stderr. Nothing is executed by a recommendation.

## Describe the resources and tasks

The version-1 JSON input contains `schema_version`, `as_of`, `currency`, `policy`, `resources`,
`tasks` and `memory`. Unknown fields fail validation. The complete structural TypeScript contract
is [types.ts](../scripts/resource-analysis/types.ts), and the runnable example supplies every required field.

| Input | Meaning |
|---|---|
| `policy.objective` | `cost`, `duration` or `balanced` |
| `policy.cost_weight` | Balanced preference: 1 favors cost, 0 favors time |
| `policy.min_success_rate` | Required empirical/prior success fraction; unknown or zero cannot qualify |
| `policy.history_max_age_days` | Maximum age of observations used for estimates |
| `policy.max_incremental_cost` | Optional planning envelope; null/omitted means none. Not a billing control |
| Resource identity | Stable `id`, `runtime`, exact `model`, `profile`, optional `session` |
| Resource evidence | `source`, `observed_at`, `expires_at`, `available`, `routes`, `capabilities` |
| `execution_pool` | Shared bottleneck with one task at a time; assign the same pool to a shared session/slot/accelerator |
| `quota_pool` | Shared quota across models/sessions; the remaining capacity must agree for every member |
| `quota_remaining_attempts` | Explicit estimated attempt equivalents, or null if unknown; never a raw provider percentage |
| Task classification | `project`, `languages` and `task_types`; the latter two are distinct-string sets and may be empty if unclassified |
| Task structure | `requires`, `depends_on`, explicit `candidates` |
| Candidate | `resource_id`, existing topology `route`, `estimate`, additional `overhead` |

Supported runtime/route labels match roadmap topology. A resource must support the route and
all required capabilities. Snapshot expiry, future observations, exhausted estimated capacity,
unavailability or a different currency exclude it. This is not an authorization check: the
caller must still satisfy the environment's session, workflow and delegation rules.

Get the suggested version-1 task vocabulary with:

```sh
node scripts/roster-analyze.cjs taxonomy
```

Task types are extensible strings; no field requires every type to be supplied. Several types
and languages can describe one task. Only classify what is known. Give different resource IDs
to materially different configurations, including reasoning settings or delegation arrangements.
Token estimates and receipts belong to the selected resource's billing model. Represent children
using different billing models as separate tasks, or supply their separately estimated expense
as explicit additional `overhead.incremental_cost`. Never merge heterogeneous token counts and
reprice them at the supervisor's rate. Duration can cover the whole mission; if children are
separate dependency tasks, avoid including their duration again in the parent estimate.

## Separate prices, subscriptions and actual expenses

For API access, `rates.input`, `rates.output` and `rates.cache_read` are currency units per
million tokens, tied to the resource's dated source. Cached input is a subset of `input_tokens`.
Unknown cache usage or a missing applicable rate leaves cost unknown. No cache-write/reasoning
surcharge is inferred: represent output/reasoning usage consistently with the billing source;
include other known expenses in explicit overhead, or leave the estimate unknown.

For subscriptions and local execution, `incremental_cost` is an explicit per-attempt estimate,
possibly zero or null. Subscription fees already paid are excluded from incremental spend.
A zero does not mean unlimited quota. This version does not optimize a separate quota-preservation
objective, estimate renewal waits, or convert quota percentages to tokens. Unknown quotas remain
visible warnings and cannot establish that capacity is sufficient.

All costs must use the input currency; no exchange rates are guessed. An unknown cost remains
null: duration proposals can use it, while cost/balanced proposals and the Pareto frontier cannot.
If a planning envelope is supplied, unknown-cost plans cannot establish compliance and are excluded.

## Keep an explicit attempt memory

Keep real catalog and memory files in your private/local state directory, outside the public
repository. Receipts contain aggregate measurements and evidence references, not prompts,
responses or secrets. The tool installs no collection hooks.

```sh
node scripts/roster-analyze.cjs record --memory /absolute/private/memory.jsonl --observation examples/resource-analysis/observation.json
node scripts/roster-analyze.cjs memory --memory /absolute/private/memory.jsonl
node scripts/roster-analyze.cjs analyze --input examples/resource-analysis/input.json --memory /absolute/private/memory.jsonl
```

The memory parent directory must already exist. `record` validates a whole observation and uses
its stable `id` for idempotence. Repeating identical content writes nothing; changing an existing
ID fails. Each successful append preserves the previous byte prefix. An exclusive `.lock` rejects
concurrent writers; a crash can leave this lock behind. Verify no writer is active before manually
removing it. Writes use the existing fsynced temporary-file/atomic-rename artifact helper. This is
not an immutable or authenticated audit store; a process with file access can change its contents.

`actual_cost` records what was observed, separately from forecast cost. `memory` groups attempts
by resource identity, project, language/type sets, route, cost mode and currency. For each metric
it reports the total and number of known samples; all-unknown totals are null. Outcome counts
for quality use only caller-marked verified successes/failures. Verification/source fields are
claims supplied by the caller, not independent attestations by this tool.

Use one receipt per measured resource attempt. Keep usage from differently billed child models
separate, and avoid counting child expense both as a separate task and as parent overhead.
The tool does not reconcile nested totals automatically. Record a failed attempt as well as a
successful one. A partial final line, duplicate IDs, invalid record or oversized file fails without repair.
Existing window-based `cost.jsonl` snapshots are not imported as exact task/session observations.

## Understand the estimates and comparison limits

History matches the exact resource ID/runtime/model/profile/cost mode/route, project, language
set and task-type set. Stale, future, cancelled, unknown and unverified outcomes do not train
estimates. There is no automatic transfer between unrelated projects or language combinations.
If every matched attempt supplies a metric, use its arithmetic mean, including failed attempts;
otherwise use the explicit candidate prior for that metric. Quality uses the observed fraction
of verified successes when any are matched, and the explicit prior otherwise. A small sample
is not a calibrated probability; sample counts and warnings remain part of the output.

API usage is repriced at current supplied rates, rather than assuming historical charges still
apply. Candidate overhead adds context-transfer tokens, elapsed time and other incremental expense
to each estimated attempt. It is additional to any overhead already present in historical totals;
use zero explicitly when no additional overhead is expected.

For comparison, conditional cost/time to success are mean attempt cost/time divided by the
success fraction. This assumes identical independent retries with unchanged cost and duration;
it does not guarantee completion, account for retry caps, or authorize retries. Different failure
causes and correlated failures can invalidate that approximation. Unknown quality or duration
cannot support a plan. These are point estimates, not confidence intervals or a promised ETA.

The search enumerates supplied candidate assignments, then schedules each in input-stable
topological order, one task per execution pool, respecting dependencies and estimated shared
quota usage. It does not search every schedule or synthesize task decompositions. Cost means
total additional expense; duration means conditional makespan, not summed worker time.
Balanced scores normalize cost/time across all feasible priced assignments and apply the chosen
weight; adding candidates can change that normalization. Ties use time for cost, cost for
duration/balanced, then enumeration order.

Limits: 128 resources, 32 tasks, 16 candidates per task, 10,000 observations, 16 MiB per artifact,
50,000 assignment combinations. Exceeding the search limit returns no recommendation rather
than a partial result labeled optimal. Split the analysis or narrow justified candidates.

## Develop and integrate

```sh
npm ci
npm run build:ts
npm run build:analysis
npm run test:analysis
```

The checked-in CJS bundle includes only Node built-ins and the existing bounded artifact IO.
It runs standalone under ESM/CommonJS consumers without `node_modules`; the intermediate tsc CLI
is not the runtime entry point. `npm run check:analysis` verifies bundle reproducibility.
Integrations can call the pure `analyze` export; Roster planning prompts use its compact CLI
recommendations when preparing `roster-run` plans or `roster-roadmap` proposals. Applying a changed topology still follows
the existing revised-and-accepted contract process in [model routing](model-routing.md).
Resource discovery/refresh uses the runtime's currently exposed authorized tools; this
analysis command itself remains offline and supplies no provider/session discovery adapter.

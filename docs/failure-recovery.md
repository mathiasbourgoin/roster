# Manual recovery after consecutive failures

After **three consecutive unsuccessful missions**, diagnose the repeated failure
and record a changed strategy with a check that can distinguish the diagnosis
before another retry. The recovery tool is manually invoked and local only: it
does not install hooks, send messages, create reminders, run workers or alter
models/prices.

For an accepted roadmap task:

```sh
node scripts/roster-recovery.cjs status --board roster/demo --task implement-api
node scripts/roster-recovery.cjs check --board roster/demo --task implement-api
```

For a standalone child pipeline, inspect each relevant phase separately:

```sh
node scripts/roster-recovery.cjs check --ledger briefs/demo-state.json --phase review
node scripts/roster-recovery.cjs check --ledger briefs/demo-state.json --phase qa
```

Installed consumers use `.harness/bin/roster-recovery.cjs` with the same
arguments. Its `.cjs` extension and Node built-ins support consumers using
`"type":"module"`; keep its `roster-roadmap.cjs` companion in the same directory.

Status/check report the original observations and all saved reframes. A matching
success resets the current failure streak. Reading again, claiming, releasing, or
seeing another phase does not add a failure. Roadmap failures are distinct blocked
receipt attempt IDs for the accepted task contract. Pipeline failures are emitted
`NO-GO` events for the selected review/QA phase in its canonical task ledger.

When `reframe_needed` is true, prepare a decision JSON file containing the current
`identity`, `source_count`, `source_digest` and `failure_ids` copied from status,
plus all six substantive fields:

```json
{
  "identity": { "kind": "pipeline", "source": "/project/briefs/demo-state.json", "task_id": "demo", "phase": "review", "mode": "full" },
  "source_count": 3,
  "source_digest": "<copy exact current digest>",
  "failure_ids": ["event:0", "event:1", "event:2"],
  "actor": "owner",
  "basis": "Inspected the three failure reports and the fixture setup",
  "diagnosis": "The shared fixture preserves stale state between cases",
  "changed_strategy": "Reproduce with an isolated fixture before changing the implementation",
  "next_discriminating_check": "Run the isolated regression against the unchanged implementation",
  "evidence": ["reports/failure.txt", "tests/fixture.js"]
}
```

Record it with the same source arguments:

```sh
node scripts/roster-recovery.cjs reframe --ledger briefs/demo-state.json --phase review --decision decision.json
```

Fresh status supplies actual digests and observation IDs; the placeholders above
are illustrative. A stale decision or edited/deleted anchored history is rejected.
Reframe writes only `<board>/recovery-<task>.json` or
`<ledger>.recovery-<phase>.json`. It appends records and preserves the original
failure evidence. An identical decision cannot repeatedly reset the same failures.

`status` exits 0 for valid data, including `needs-reframe`. `check` exits 2 when
`reframe_needed` is true and 0 otherwise; malformed inputs/setup errors exit 1.
The exported `main(argv)` returns structured data without setting process status.
Inspect `reframe_needed` to enforce the recovery requirement. `within-budget` and
`recovery_allows_retry` concern only this requirement: neither means that review
or QA passed. For roadmap tasks, `retry_allowed` additionally accounts for the
original attempt budget, current core claim checks and required reconciliation.
Reframe does not stop or release an old worker. Reconcile active/blocked work using
the roadmap core before another claim. A reframe may document an exhausted task
but cannot grant a fourth attempt when max_attempts was three, override a block
policy, or bypass acceptance and child review/QA gates.

For pipeline ledgers, `retry_allowed` is null. Run the existing review/QA
convergence checks and respect their tighter bounds before route-back. Their
two-strike novel-finding rule and five-round caps are different mechanisms and
remain unchanged. A success changes the failure streak, not consumed budgets.

The pipeline ledger has a canonical task slug and phase but no immutable mission
definition digest or authenticated physical attempt ID. Preserve the task's actual
context and check its brief/spec externally; do not rename a mission or copy a
ledger to evade a threshold. The tool detects inconsistency against saved source
prefixes, but does not authenticate actors or distinguish a manually appended
duplicate ledger event from another legitimate verdict. Local file access can
rewrite local assertions. See [the artifact schema](../schema/recovery-schema.md)
for precise fingerprints, exports and filesystem guarantees.

Installed schema reference: `.harness/roadmap/recovery-schema.md` (source-relative links above apply in a Roster checkout).

# Model routing for bounded Roster missions

Choose the available model and expertise most likely to satisfy the task, its quality gates,
owner constraints and independence requirements. Use cost and time to distinguish comparably
capable choices. Launch, fallback and budget authority comes from the accepted contract
and the runtime's existing controls and permissions.

Read `.harness/roadmap/model-routing.md` once during planning or relevant replanning;
the source equivalent is `docs/model-routing.md`. Give workers only their compact routing
decision alongside goal, scope and checks. Keep comparisons and detailed evidence on disk.

## Select among available choices

1. Preserve explicit owner model requirements/exclusions, accepted contracts and existing
   budgets. If a required model is unavailable, report the conflict and use only an already
   authorized alternative.
2. Observe native runtime controls and available models through metadata or bounded read-only
   checks. Classify selection as controllable, inherited, unavailable or unknown. A model name
   in a prompt is a request, not evidence that the runtime executed it; never invent flags.
3. Use a deterministic command directly when it performs the work. Prefer same-agent
   sequential execution when delegation adds no value, while preserving required independent
   verification: self-review cannot establish independence.
4. Compare complexity, ambiguity, context needs, consequences and available checks. Favor
   the strongest fit for the mission's goal and evidence. Use lower cost or latency when
   candidates meet the same quality bar. Record uncertainty and retain the authorized
   configured model when evidence for a change is unavailable.

Three relative tiers guide mission selection; they are not verified prices or vendor rankings:

| Tier | Suitable work when capability is supported |
|---|---|
| `economy` | Bounded extraction, classification or routine transformations with clear checks. |
| `standard` | Ordinary implementation, integration and analysis requiring judgment. |
| `strong` | Difficult decisions, deep diagnosis or demanding adversarial analysis with a specific justification. |

Task size alone does not establish capability. Use `unknown` for an unclassified inherited
model and `not-applicable` for a direct command without an agent. Explicit owner model choices
win over a cheaper recommendation; record that requirement as the exception.

Token volume is not total monetary cost: rates, cached/input/output tokens and attempts can
differ. Record unobserved cost as unknown. Do not introduce fixed catalogs, stale prices or
savings claims without supporting measurements; no pricing lookup is required merely to fill a record.

## Compact decision and execution record

Keep one record per mission/role in roadmap `notes/model-routing.md` or the task plan, and
copy its essential decision into every self-contained sub-brief. Record rationale, cost
observations and actual runtime identity in those notes. Keep the validated roadmap
default and specialist ladder in the accepted task topology.

```text
mission / runtime: <task and role / intended runtime>
requested_model / tier: <available identifier or inherited/unknown> / <relative tier or unknown>
runtime_control / evidence: <native control, inherited or unknown> / <observations and owner constraints>
selection_reason / cost: <capability/cost justification or uncertainty> / <observed comparison or unknown>
costly_exception: <none, evidenced capability need, or explicit owner requirement>
observed_actual_model: <runtime-reported identifier after execution, otherwise unknown>
failure_trigger: <observable capacity shortfall after diagnosis>
bounds: <existing attempt/time/cost/token permissions; unknown values stay unknown>
authorized_fallback: <permitted alternative and trigger, or none>
```

A table may organize these records. Keep the requested model and append the actual runtime
observation; never report an unfulfilled request as executed. For strong or otherwise known
costly choices, explain why a less costly eligible candidate is insufficient or cite the
owner requirement. Pass children their decision, not the full policy or comparison history.

## Diagnose before escalating

Use actual failure evidence to distinguish causes:

| Cause | First response |
|---|---|
| Environment/tool/provider failure | Restore the prerequisite or use an authorized equivalent. |
| Missing, stale or excessive context | Refresh relevant inputs or narrow the mission without dropping constraints. |
| Ambiguous/contradictory specification | Resolve through the existing intake/planning route. |
| Ordinary red test or implementation defect | Follow TDD and the bounded correction loop; do not automatically promote. |
| Evidenced model or specialist capacity shortfall | Explain the unresolved demand and consider a better-fit authorized specialist, model and discriminating check. |

Record diagnosis, changed strategy and the discriminating check. Never repeat an unchanged
costly attempt or increase attempts merely to keep moving. Escalation still requires supported
controls, owner model constraints, existing permissions/bounds and unchanged independence.
If none permits progress, report the precise blocking decision; record unavailable switches honestly.

After **three consecutive unsuccessful missions**, record a diagnosed reframe before another
unchanged retry. Use the manually invoked recovery tool, which reads the original evidence:

```sh
node .harness/bin/roster-recovery.cjs check --board <board> --task <task-id>
node .harness/bin/roster-recovery.cjs check --ledger briefs/<task>-state.json --phase review
node .harness/bin/roster-recovery.cjs check --ledger briefs/<task>-state.json --phase qa
```

Select the applicable board/task or canonical pipeline phase source. Source checkout paths
use `scripts/roster-recovery.cjs`. `check` exits 2 when reframe is needed, 1 on invalid/setup
input and 0 when this recovery requirement permits continuing. A zero exit is not GO or a
general retry authorization. A valid decision binds actor, basis, diagnosis, changed strategy,
next discriminating check and evidence to the current identity and exact source prefix;
record it with `reframe` and the same source arguments plus `--decision <file>`. Follow
[the recovery procedure](failure-recovery.md) (installed sibling: `failure-recovery.md`).

Roadmaps count distinct blocked receipt attempts for the accepted task contract. Pipeline
review/QA count consecutive same-phase NO-GO events independently; a review GO does not
clear QA failures. The pipeline ledger lacks an immutable mission digest, so retain its
canonical task/phase and actual brief/spec context. A reframe preserves original evidence,
prior records and consumed bounds; it never authorizes a model change, refunds a budget,
waives acceptance or overrides the two-strike review rule or either five-round cap. Reconcile
an old active worker through the roadmap core before another claim. These local artifact
commands work across Codex, Claude, OpenCode and Pi without hooks or runtime control.

## Accepted roadmaps and older plans

Propose the default model, evidence for its native runtime control, ordered model alternatives
and increasingly relevant specialists for each task. Describe the evidence and threshold
that justify each step. Ask the operator to validate or amend the proposal in roadmap intake
and include the adopted policy in `goal.md` and `topology.escalation`. Record validation for
the opted-in tasks in the digest-bound acceptance decision's `routing_review`.

The coordinator can select the next eligible specialist or an accepted model alternative
with a fresh `claim --routing-decision`. An availability fallback requires evidence for
the earlier unavailable choices. A specialist trigger requires blocked receipt history and
an applicable diagnosis. Follow any required reframe, verify authorized runtime controls,
and record what actually ran. A model or level outside the accepted policy requires a
separately accepted revised board with prior history and consumed bounds preserved.

Legacy plans and Fast/Express tasks without routing sections retain their current configured
model, with identity/control/cost unknown where appropriate. Add a compact decision for new
authorized delegation; missing historical metadata creates no mandatory planning gate.
Express Lite keeps its existing no-spawn behavior.

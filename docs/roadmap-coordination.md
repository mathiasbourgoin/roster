# Coordinate a multi-intake roadmap

Use `/roster-roadmap` to prepare a coherent roadmap with the owner, assign an agent
topology suited to the environment, and execute toward a separately verified global
outcome. The skill uses local resources and native agent tools; it does not use CWR.

## Prepare the contract

Invoke `/roster-roadmap <intent or board path>`. The agent inspects the project before
asking questions, prefills evidence and recommendations, and distinguishes observed
facts, assumptions and owner decisions. It checks both dependency structure and the
semantic compatibility of the proposed intakes.

The board lives at `roadmaps/<slug>/` by default:

| Resource | Purpose |
|---|---|
| `goal.md` | Human-facing outcome and constraints; kept consistent with the JSON contract |
| `roadmap.json` | Executable contract: goals, task graph, checks, topology and recovery policies |
| `capabilities.json` | Observed runtime capabilities and separate authorization evidence |
| `state.json` | Authoritative execution state, assignment attempts and accepted receipts |
| `estimates.json` | Planner duration ranges and preserved forecast revisions; advisory |
| `requests.json` | Coordinator asks to the human operator (optional annex with its own revision); advisory, never read by claim/next |
| `progress/` | Attempt-bound worker reports; advisory and separate from accepted receipts |
| `receipts/` | Candidate receipt files prepared by workers for coordinator review |
| `notes/` | Detailed research, coherence assessment and decision rationale |

Accepting a roadmap binds its current contract digest. Changes require a new acceptance
before execution. Acceptance is a local decision record, not authentication. It does
not manufacture approval of child-intake specs/plans or replace their review/QA gates.
The owner may delegate defined decisions; record that source and its exact scope.

DoD describes when a task is finished; task success describes its observed effect.
Global success additionally checks the integrated outcome. For example, authoring,
review and integration tasks may all pass while a final end-to-end demonstration still
fails. The roadmap stays open until the global checks have separate fresh evidence.

## Choose agents and routes

Each task names its runtime, role, persona, model, preferred route and permitted
fallbacks. The runtime names `codex`, `claude`, `opencode` and `pi` identify mission
targets, not a claim that all four support the same tools. The existing initializer
projects skills for Codex, Claude and OpenCode. In Pi, load the same source skill and
rendered mission through the environment's supported instruction mechanism; this
feature does not add a Pi plugin installer.

| Route | Execution mechanism |
|---|---|
| Sequential | One agent coordinates and executes the current mission. |
| Subagent | The current environment's authorized native delegation tool. |
| Parallel | Independently assigned work with compatible reported write scopes. |
| Multisession | Existing or owner-approved sessions exchanging bounded mission resources and receipts. |
| Workflow | An accepted sequence followed by an agent, or an available tested executable mechanism. |

The toolkit reserves assignments and chooses admissible work; it does not spawn
agents, send messages, run check commands, or turn declared capabilities into tool
permissions. Observe and authorize capabilities independently. A required independent
review must not fall back to self-review. Use dependent review/integration tasks and
retain their evidence.

Deck MCP can supply some session facilities. Consult the actual tool contracts:
inbox metadata may be readable while message content still needs owner instruction;
session creation can be an owner-approved request rather than immediate creation.
Discovery, messaging and creation are different capabilities. Recording multisession
support in a board never removes those boundaries.

## Choose model tiers and control cost

Roadmap and `/roster-plan` share the [model-routing policy](model-routing.md), installed
as `.harness/roadmap/model-routing.md`. Select the least costly observed, permitted model
capable of meeting the unchanged checks. Economy, standard and strong are relative
planning tiers; they are not a universal vendor ranking or verified prices.

Record the selected model, evidence, rationale, costly exceptions and bounded escalation
in `notes/model-routing.md` and each child brief's compact routing section. Give workers
their decision rather than replaying the full policy. Report the model actually exposed
by the runtime, or unknown; requesting a model does not establish that it ran. Direct
deterministic checks and the current sequential agent can avoid unnecessary delegation.
Required independent verification and explicit owner model choices still apply.

Diagnose failed checks before attributing them to model capacity. Escalation must remain
within authorization and attempt budgets. A different model changes accepted
`topology.model`: reconcile the current assignment and use the existing revised-board
acceptance procedure, retaining history. The toolkit does not select or switch models.
Token use and monetary cost are different measures; this policy promises neither a
measured token reduction nor savings without comparable end-to-end evidence.

## Use the portable tools

In an installed project use `node .harness/bin/roster-roadmap.cjs`. In this repository
use `node scripts/roster-roadmap.cjs`, or the `roster-roadmap` package binary. The CLI
uses Node built-ins and works in CommonJS and ESM consumers without npm dependencies.
Keep `roster-roadmap.cjs`, `roster-artifacts.cjs`, `roster-recovery.cjs`,
`roster-roadmap-view.cjs`, `roster-roadmap-estimates.cjs`, `roster-roadmap-requests.cjs`,
`roster-roadmap-requests-view.cjs`, `roster-roadmap-validate.cjs`, `roster-roadmap-history.cjs`,
`roster-roadmap-missions.cjs`, `roster-roadmap-prompt.cjs` and `roster-roadmap-derived.cjs`
together in `.harness/bin/`
from the same approved revision. Init/sync install the complete runtime closure and the
matching policies, schemas and examples under `.harness/roadmap/`; copying a lone core
file is insufficient. Repair the complete trusted installation on mismatch.

```bash
node .harness/bin/roster-roadmap.cjs init roadmaps/release --id release
node .harness/bin/roster-roadmap.cjs lint roadmaps/release
node .harness/bin/roster-roadmap.cjs status roadmaps/release
node .harness/bin/roster-roadmap.cjs status roadmaps/release --format text
node .harness/bin/roster-roadmap.cjs view roadmaps/release --events 10
node .harness/bin/roster-roadmap.cjs next roadmaps/release
node .harness/bin/roster-roadmap.cjs prompt roadmaps/release
```

`init` deliberately creates an incomplete draft. Fill the goal, global checks, tasks
and actual capability observations before accepting it. See the [contract and CLI
reference](../schema/roadmap-schema.md) and [example contract](../examples/roadmap/).

`/roster-roadmap status [board]` selects an explicit or unambiguous existing board and
returns formatted human status. It does not initialize/claim/resume work, append a friction
entry or install hooks/reminders. Multiple possible boards require an explicit selection.
The report distinguishes goal, task states/assignees, accepted checks, unverified worker
reports, blockers and separate task/global ETA. Missing information stays unknown.

`view BOARD [--task ID] [--events N]` supplies versioned, bounded JSON for a monitoring UI.
Use its source revision and change token to detect resource changes; generated-at time and
time-relative forecasts are observations, not execution events. Treat all labels, command
strings and artifact paths as inert data, escape them when rendering, and never execute
them because they appear in a snapshot. See [the view contract](../schema/roadmap-view-schema.md).

An active worker can submit advisory progress:

```bash
node .harness/bin/roster-roadmap.cjs progress roadmaps/release --task implement --attempt ACTUAL_ID --assignee worker --sequence 0 --update /tmp/progress.json
```

The update includes a message, optional current step and declared check reports. Sequence
is the current progress sequence (zero before the first report), bound to the current
assignment. Unreported/stale/invalid progress is visibly distinct from accepted checks;
progress neither finishes a task nor changes execution revision or retry budget.

## Plan and refresh durations

The planner estimates each task in optimistic/likely/pessimistic minutes, with basis,
evidence and dispatch/dependency assumptions, and estimates integrated verification
separately. On roadmap revisit, refresh ranges where new evidence changes the forecast;
preserve prior revisions and mark missing timing unknown. Do not advance a deadline merely
because status was polled. [Duration estimates](roadmap-estimates.md) document the sidecar.

```bash
node .harness/bin/roster-roadmap.cjs estimate roadmaps/release --revision 0 --update /tmp/estimates.json
```

Here revision is the forecast revision, independent of execution state. The input binds
current accepted contract and execution revision, planner writer, rationale, evidence and
capture time. `estimates.json` changes neither the accepted contract nor task receipts.
For active work use its real claim timestamp or a remaining range captured for the current
attempt; legacy missing starts stay unknown. An overrun requests re-estimation rather than
silently resetting its countdown. Forecasts account for dependency order, maximum capacity,
parallel authorization and overlapping write scopes; queued dispatch and successful checks
remain conditional assumptions. Unresolved blockers or missing estimates prevent a fabricated
delivery date. Missing global-verification timing may still leave a useful tasks-only ETA.
Only the separate global receipt establishes completion, not an estimate or task count.

## Operator requests

When the coordinator needs the human operator, it records an advisory request in
`requests.json` instead of pausing silently: `request-open`, then `request-answer` (relaying
the operator's reply) or `request-withdraw`; `request-journal` stores an inert reference to
the project logbook. An open request bound to a mission is a signal (`now`, `later`,
`unscheduled`) shown in `view.operator_requests`, in a `Waiting on:` block of
`status --format text` and in `prompt`; it never blocks `claim`. An answered request stays
visible until its mission is done. There is no operator-side command or authentication, and
no secret may be stored: a leaked secret must be treated as compromised and rotated. See
[the requests schema](../schema/roadmap-requests-schema.md), installed as
`.harness/roadmap/requests-schema.md`.

Mutations use `--coordinator <id> --revision <current revision>` to detect conflicting
updates. `accept` additionally reads `--decision <file>` with the current contract
digest, decision-maker and basis. `claim` takes a task and assignee. `record` reads a
candidate receipt, and `complete` reads separate global evidence. `release` requires
an explicit reconciliation reason and responsible identity.

Workers return their task/attempt identity, evidence, reported changed files and
stable check IDs. The coordinator examines the actual evidence before recording a
receipt. Missing, failed, foreign or stale results cannot complete the task. Reported
scope checks detect declared conflicts; they are not a filesystem sandbox and cannot
prove that a worker omitted no changes.

## Continue and recover

At every mission boundary, call `next` and render a fresh `prompt`. Coordinator
contexts summarize goal, progress, active assignments and next action. Task contexts
include only the mission and its relevant contracts. Long histories stay in notes and
receipts. A context that cannot fit its mandatory material fails explicitly instead
of silently omitting an exit condition.

After a task completes, continue the next admissible branch. A blocked branch does
not end unrelated work. Preserve failure evidence and retry counts, obey stop
conditions and apply only accepted recovery policies. Once all tasks are done, run
the global checks against the integrated result and submit fresh global evidence.

After interruption, read `status` before doing work. An active assignment remains
owned until the coordinator confirms the previous worker has stopped and reconciles
its modifications. Do not reassign on a timeout alone. Occupied locks are not
automatically stolen; inspect the previous process and board before recovering them.

After three consecutive failures on the same mission, inspect the manual recovery status
and record a diagnosed reframe with changed strategy, evidence and discriminating check
before retrying. The [recovery guide](failure-recovery.md) describes exact source identities
and commands. This preserves original failures and attempt budgets; it neither grants a
retry nor replaces review's two-strike finding rule or review/QA five-round caps.

### Correct an implementation after a failed review

When a review fails because of an implementation it depends on, do not reopen the
implementation. The reviewer's blocked receipt names it in `blames` (a direct dependency).
Then run `derive BOARD --coordinator <id> --revision <n> --request <file>` with
`{parent, cause, objective, topology, max_attempts}`: choose the correction's runtime, model
and role from the escalation ladder, with a budget no larger than the parent's. The tool
assigns `<parent>-fix-<n>`, which inherits the parent's scope and checks and runs as its own
mission (its own claims, receipts and budget). It refuses a claim by the failed reviewer's
label. The review stays blocked and cannot be released while its corrections are pending;
when every correction of that receipt is done, the review is requeued automatically. If every
correction exhausts its budget, release the review under the usual rules or escalate.
`view` lists the correction after the contract tasks with its parent and cause and a timeline of
every attempt. The roadmap completes only when every contract task is done and no correction is
queued or active. Owner decision D1 chose this correction mission; D2 to D6 are deduced and to be
confirmed on the PR (see the schema). Labels are unauthenticated assertions: the reviewer ban
compares labels, it cannot prove two labels are different agents.

The prompt and resources support continuation while a runtime is executing and
resumption in a later invocation. They do not keep a killed process alive or promise
unattended restart. Use native continuation facilities only when available and
authorized. The final report must distinguish completed, paused and blocked work.

## Verify the installation and behavior

```bash
npm run test:roadmap
bash scripts/sync-harness.sh --check
```

The suite exercises real CLI lifecycles, invalid graphs, stale assignments, capability
and ownership checks, premature completion, compact contexts and installed ESM
consumers. These are local protocol tests; they do not certify live delegation or
session creation in every named runtime.

The design takes inspiration from GoalBuddy's [persistent local goal resources](https://github.com/tolimarchuk/goalbuddy)
and [task/receipt contract](https://github.com/tolimarchuk/goalbuddy/blob/main/docs/spec/receipt-v1.md).
There is no GoalBuddy runtime dependency.

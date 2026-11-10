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

## Use the portable tools

In an installed project use `node .harness/bin/roster-roadmap.cjs`. In this repository
use `node scripts/roster-roadmap.cjs`, or the `roster-roadmap` package binary. The CLI
is self-contained and works in CommonJS and ESM consumers without local dependencies.

```bash
node .harness/bin/roster-roadmap.cjs init roadmaps/release --id release
node .harness/bin/roster-roadmap.cjs lint roadmaps/release
node .harness/bin/roster-roadmap.cjs status roadmaps/release
node .harness/bin/roster-roadmap.cjs next roadmaps/release
node .harness/bin/roster-roadmap.cjs prompt roadmaps/release
```

`init` deliberately creates an incomplete draft. Fill the goal, global checks, tasks
and actual capability observations before accepting it. See the [contract and CLI
reference](../schema/roadmap-schema.md) and [example contract](../examples/roadmap/).

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

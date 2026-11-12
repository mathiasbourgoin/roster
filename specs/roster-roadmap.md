---
name: roster-spec
type: spec
status: validated
feature: roster-roadmap
version: 1.0.0
---

# Spec — portable roadmap coordination

**Status: VALIDATED for implementation under owner's delegated autonomy.**
Contract acceptance does not assert implementation verification. Local tooling is a coordination aid, not agent authentication, sandboxing or an unattended execution service.

## Clarifications

The owner requires no CWR, runtime-adaptive routes (including subagents and authorized multisession), useful workflow proposals, GoalBuddy-like persistent resources, compact context refresh, and continued progress toward a global outcome. Routine decisions are delegated. Native sessions/tools execute work; this toolkit never launches sessions, sends messages or runs verification commands implicitly.

## User Stories

### US-1: Prepare a coherent roadmap (P0)

As an owner I receive a prefilled evidence-backed roadmap with recommendations, so I decide only unresolved consequential choices.

- Given unknown goals/checks, when initialized, then the draft cannot execute until concretely specified and accepted.
- Given cyclic or dangling dependencies, when linted, then execution is refused with diagnostics.
- Given a changed accepted contract, when execution resumes, then stale acceptance and receipts cannot authorize the changed work.

### US-2: Choose a supported topology (P0)

As a coordinating agent I assign bounded missions using capabilities actually observed and authorized in Codex, Claude, OpenCode or Pi.

- Given no delegation capabilities, when selecting work, then sequential execution remains usable.
- Given an unavailable or unauthorized requested route, when selecting work, then an explicit permitted fallback is required or the task stays blocked.
- Given overlapping active write scopes, when claiming parallel work, then the conflicting claim is refused.

### US-3: Execute and resume honestly (P0)

As an agent I recover the current goal/state/next action without replaying all history, and continue until global acceptance is evidenced.

- Given a stale or mismatched receipt, when recorded, then it cannot complete a task.
- Given one blocked branch and another ready task, when selecting work, then the ready task is offered.
- Given all tasks done but missing global evidence, when checking completion, then the roadmap remains open.
- Given an active assignment after interruption, when resumed, then it remains owned until explicit reconciliation; silence does not authorize reassignment.

## Challenges

| Challenge | Resolution |
|---|---|
| Prompt instructions cannot keep a killed runtime alive | Persist resumable state; no durability promise beyond runtime facilities |
| Models can assert false verification | Require structured evidence and passing check coverage; label local assertions honestly |
| Tool presence mistaken for authorization | Separate supported/observed capabilities from explicit authorization |
| New roadmap approval could bypass child-intake gates | Keep child pipeline state authoritative; precise preauthorization must cover exact artifacts |
| Fixed snippets can flood context | Render only goal, bounded current mission/state, dependency summaries and artifact pointers; enforce output limit |
| Mutable contract/evidence makes old receipts stale | Bind acceptance and attempts to contract identity; reject stale/mismatched submissions |

## Functional Requirements

- **FR-001** [US-1]: The skill MUST assist specification by inspecting existing evidence, pre-filling proposed objectives/DoD/checks/dependencies and labelling observations, assumptions, recommendations and owner decisions separately.
- **FR-002** [US-1]: The toolkit MUST validate nonempty global success criteria, task objectives, DoD, success/check definitions, dependency references, unique IDs and an acyclic graph before acceptance/execution.
- **FR-003** [US-1]: Contracts MUST describe failure/retry/stop/recovery policies and workflow recommendations; missing decisions MUST remain visibly unresolved rather than silently approved.
- **FR-004** [US-2]: Topology MUST carry runtime, role/persona, model and capability requirements independently; unsupported or unauthorized delegation/parallel/session/workflow routes MUST fail closed or use an explicitly permitted fallback.
- **FR-005** [US-2]: Sequential coordination and execution MUST work in the same agent; subagent and multisession execution MUST use runtime-native authorized mechanisms and never fabricated tool names/CLI flags.
- **FR-006** [US-2]: State mutation MUST serialize competing updates and reject stale revisions, foreign owners, duplicate active claims and overlapping active write scopes. Abandoned work MUST require explicit reconciliation before reassignment.
- **FR-007** [US-3]: Accepted contracts and task assignments MUST be version-bound; changed contracts and stale attempt receipts MUST NOT complete work.
- **FR-008** [US-3]: Task completion MUST require assigned identity, all declared checks passing, evidence and in-scope reported writes; failed checks MUST remain structured and cannot be hidden behind a done status.
- **FR-009** [US-3]: Work selection MUST continue on other admissible branches and distinguish ready/active/blocked/retry-budget exhaustion/global-verification-needed/complete. A local completion MUST NOT terminate an open roadmap.
- **FR-010** [US-3]: Compact coordinator/mission prompts MUST remind goal, current state, relevant active work, mission exit criteria and next action, without replaying full notes or receipts. Oversized mandatory context MUST fail explicitly rather than silently truncate conditions.
- **FR-011** [US-3]: Global completion MUST require accepted contract, all required work complete and separate global success evidence; all-tasks-done alone MUST NOT mark complete.
- **FR-012** [US-3]: The runtime MUST preserve state atomically, refuse malformed inputs without mutation, avoid implicit shell/network/runtime launches, and state that receipts are local assertions rather than authentication or sandbox enforcement.
- **FR-013** [US-1]: Init/sync MUST distribute a self-contained toolkit with the installed skill, including ESM consumers; generated projections, catalogs and tests MUST remain synchronized.
- **FR-014** [US-2]: Deck multisession guidance MUST distinguish metadata inspection, owner-authorized message handling and owner-approved session action requests; tool availability MUST NOT bypass those approvals.

## Acceptance Criteria

- **AC-1**: A documented disposable board can be initialized, specified, accepted, claimed, completed and globally verified through real CLI commands.
- **AC-2**: Negative tests reject invalid graphs, stale contracts/receipts, ownership conflicts, unsupported routes, overlapping writes, failed/missing checks and premature global completion without corrupting state.
- **AC-3**: Compact contexts omit unrelated history and stay within their declared size or report explicit overflow.
- **AC-4**: A fresh consumer can invoke the installed CLI and discover the skill; the full existing suite and sync checks pass.

## Edge Cases

Malformed JSON, path traversal/symlinked board writes, unknown task IDs, empty claims, duplicate receipt IDs, active work after process interruption, invalid capability profiles, all tasks blocked, exhausted retries, runtime unavailable, required independent review unavailable, contract edited mid-run, and output-size overflow must be explicit.

## Runnable Checks

- **CHECK-1** [AC-1, AC-2, AC-3]: `node --test scripts/roster-roadmap.test.js` — real CLI lifecycle and negative controls.
- **CHECK-2** [AC-4]: `npm test` — full regression, install/projection and structure checks.
- **CHECK-3** [AC-4]: `bash scripts/sync-harness.sh --check` — generated projections match canonical sources.

## External Sources

- GoalBuddy README: https://github.com/tolimarchuk/goalbuddy — durable local charter/state/board and runtime handoff.
- GoalBuddy receipt v1: https://github.com/tolimarchuk/goalbuddy/blob/main/docs/spec/receipt-v1.md — bounded missions, structured passing/blocked receipts and final outcome audit. Inspiration only; no dependency or copied implementation.

## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"roster-roadmap","spec_lifecycle":"draft"}
{"record":"requirement","id":"FR-001","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-002","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-003","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-004","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-005","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-006","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-007","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-008","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-009","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-010","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-011","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-012","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-013","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-014","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-001","FR-002","FR-003","FR-007","FR-008","FR-011"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-002","FR-004","FR-006","FR-007","FR-008","FR-009","FR-011","FR-012"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-010"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-005","FR-013","FR-014"]}
{"record":"check","id":"CHECK-1","for":["AC-1","AC-2","AC-3"]}
{"record":"check","id":"CHECK-2","for":["AC-4"]}
{"record":"check","id":"CHECK-3","for":["AC-4"]}
```

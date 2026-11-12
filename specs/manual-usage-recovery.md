---
name: manual-usage-recovery
type: spec
status: live
feature: manual usage, three-failure recovery and roadmap observation
date: 2026-11-12
version: 1.0.0
---

# Manual reporting, recovery and roadmap observation

## Requirements

- **FR-001**: The usage tool MUST run only on explicit invocation, read only explicit project/input sources, perform no network/transcript discovery, hook installation, reminder, telemetry offer, external send or pricing estimate. Unsupported runtime data MUST remain unknown. Claude, Codex, OpenCode and Pi records MUST use the same portable contract.
- **FR-002**: Reports MUST preserve provenance, nullable bucket coverage and cumulative-snapshot deduplication. Overlapping approximate windows or conflicting scopes MUST NOT produce a falsely exact aggregate. Shareable output MUST exclude project/task/session/agent identities, paths, prompts, commands and raw findings.
- **FR-003**: Recovery MUST request diagnosis and an explicitly changed strategy after THREE consecutive terminal failures of the same mission. Reobserving an event/receipt MUST NOT count as a new attempt. A completed mission or explicit valid reframe separates streaks. Tighter existing budgets, immutable contracts, review strikes and QA caps MUST remain authoritative.
- **FR-004**: A recovery decision MUST bind current authoritative evidence and record actor/basis/diagnosis/strategy/discriminating check/evidence. Source history, consumed attempts and prior decisions MUST be preserved. Stale or rewritten evidence MUST NOT authorize a reset. No recovery command launches an agent or authenticates labels.
- **FR-005**: Roadmap observation MUST expose a versioned self-contained JSON view of goal, graph, task/assignment state, checks, failures, next actions and bounded recent events. Clients MUST distinguish task completion from separate global acceptance and worker-reported progress from accepted receipts. Missing historical timestamps/durations MUST remain unknown.
- **FR-006**: Explicit formatted status MUST be read-only and usable through `/roster-roadmap status`; existing JSONstatus semantics MUST remaincompatible. Viewing an unaccepted draft MUST NOT initialize/accept/dispatch work. Views MUST provide stable change identity for polling and treat all strings/commands as inert data.
- **FR-007**: Optional intermediate progress MUST be bound to the current task/attempt/assignee and optimistic sequence, written atomically under a lock and kept separate from authoritative execution state. Stale/foreign updates MUST refuse; progress MUST NOT complete a task, verify declared checks, change budgets or alter acceptance. Observers MUST flag malformed optional progress rather than claim it succeeded.
- **FR-008**: Source and installed-only ESM consumers MUST receive the complete local runtime/resource closure without dependencies or hooks. Existing managed-path containment and readonlysync checks MUST cover new companions. Meaningful positive, negative and stale-evidence scenarios MUST pass before delivery.

- **FR-009**: The planner MUST publish and revise optimistic/likely/pessimistic task durations and a separately identified global-verification duration, with basis and evidence, outside the immutable execution contract. Forecast history MUST remain preserved and updates MUST bind the current contract and state revision.
- **FR-010**: Views and formatted status MUST show a conditional ETA that respects dependencies, observed authorized routes, capacity and write-scope conflicts. Active duration MUST age from its actual claim or the same attempt’s explicit remaining estimate. Missing/blocked/stale evidence and overruns MUST yield explicit unknown/re-estimation needs. Tasks-only completion MUST remain distinct from global acceptance; estimates MUST never authorize execution.

## Acceptance evidence

AC1 usageCLItestscovermanual-onlyreadonlyoperation, fourruntimes, nullableprovenance/dedup/overlap andprivacy.
AC2 recoveryCLItestsprove2failuresallowordinaryboundedrecovery,3requireexplicitreframe, duplicates/staleanchorsdon'treset, sourcebudgetsunchanged.
AC3 roadmapview/progresstestsproveJSONcontract+stablefingerprints+formattedstatus+activeassignmentbinding+globalacceptance distinction.
AC5 forecast tests cover dependency/capacity/scope scheduling, anchored remaining time, revisions, stale evidence and unknown global completion.
AC4 installedconsumer/generation/preflighttests andfullqualitygatespass; independentreview/QAassessclaimsagainstactualexecutions.

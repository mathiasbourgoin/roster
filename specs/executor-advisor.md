# Executor and advisor skills

**Profile:** skill protocol
**Status:** approved for implementation under owner-delegated autonomy

## Outcome and authority

Reusable skills separate economical task execution from focused higher-capability advice.
Instructions apply across Codex, Claude, OpenCode and Pi through actual exposed capabilities;
they do not implement a provider adapter or guarantee that a runtime can delegate.
Existing intake/review/QA, permissions, accepted assignments and retry bounds remain authoritative.

## Requirements

- FR-001: Expose discoverable versioned executor/advisor skills and their common reference
  through fresh supported harness installation and generated runtime projections.
- FR-002: Keep current/requested/observed model identities and provenance separate; absent
  runtime evidence stays unknown. A prompt/model request is not actual execution proof.
- FR-003: Independently observe local model/depth/slot controls and session discovery,
  message/create/control/return capabilities and authorization before selection/dispatch.
- FR-004: Resolve explicit arguments and per-skill tunables under owner constraints and
  accepted assignments; report conflicts and unsupported exact-model requests without silent substitution.
- FR-005: Prefer a sufficiently capable economical executor according to available cost/time
  evidence, including subscription/local uncertainty and transfer overhead; choose a task-capable
  stronger advisor where available, without fixed provider rankings or guaranteed savings.
- FR-006: Carry goal, current state, mission/attempt identity, permitted writes, checks,
  relevant inputs and result destination in a compact handoff; preserve durable evidence.
- FR-007: Prevent recursive executor delegation and same-pool/depth deadlocks. A leaf requests
  parent-relayed advice; waits/calls are bounded by existing limits; live work is reconciled before replacement.
- FR-008: Keep advice distinct from independent review and completion. Conflicting evidence
  can be reconciled; advisory failure does not invent a result or erase required consultation.
- FR-009: Preserve Express Lite no-spawn, accepted roadmap model immutability, child gates,
  consumed retry bounds and coordinator-only shared memory writes.
- FR-010: Integrate the skills through short references loaded when needed. No automatic hooks,
  CWR invocation, product-specific session instructions, new daemon or analyzer/receipt fields.

## User stories and scenarios

### US-1 — Execute through available resources

- Given a powerful entry agent and a selectable economical local worker, when executor is
  invoked, then it supplies a bounded mission and validates returned evidence before completion.
- Given local delegation is unavailable but session messaging/creation is authorized, when
  an executable session route exists, then it uses the observed route and bounded return channel.
- Given no controllable model/route or conflicting exact-model constraints, when routing is
  requested, then it reports unknown/unavailable/conflict and uses only a permitted explicit fallback.

Challenge: “small model” is not necessarily cheapest. Resolution: use actual resource-routing
objective/evidence and retain unknown prices, capabilities and total-cost overhead.

### US-2 — Obtain advice without losing execution state

- Given an economical leaf needs design advice, when it reaches its native depth limit,
  then it returns a compact consultation request to the coordinator rather than spawning recursively.
- Given an advisor response conflicts with observed source/tests, when execution resumes,
  then the conflict is surfaced and reconciled rather than treated as authority or an independent GO.
- Given a consultation/session times out while an attempt remains live, when considering
  a replacement, then the coordinator preserves state and reconciles the worker before dispatch.

Challenge: a prompt instruction cannot enforce a runtime lock. Resolution: clearly describe
prose guidance and existing enforced gates; do not claim new mandatory state transitions.

## Verification and acceptance

- AC-1 / CHECK-1: Fresh installed consumer tests verify both skills in manifest and generated
  Codex/Claude/OpenCode files, complete companion contents and sync consistency.
- AC-2 / CHECK-2: Independent scenario exercise uses minimal role inputs to examine model
  unknowns, route permissions, recursion/slot limits, direct fallback and advice vs review.
- AC-3 / CHECK-3: A real native-tool rehearsal requests Luna execution and Astra advice,
  records actual tool-assigned identities and observed limitations separately from billing/quality claims.
- AC-4 / CHECK-4: Repository checks and full test suite pass; generated projections have no
  drift. The review reports source-grounded findings and exact unverified runtime scope.

CHECK-1 and CHECK-4 are automated consumer/regression checks; CHECK-2 and CHECK-3 are
agent/tool behavioral evidence, not deterministic proof of model compliance.

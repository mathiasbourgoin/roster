---
name: express-lite
type: spec
status: live
feature: express lite routing
brief: briefs/express-lite-intake.md
date: 2026-10-22
version: 1.0.0
---

# Spec — Express Lite routing

**Profile: minimal-freeze**

## Invariants

- Express Lite MUST be selected only for self-evidently non-behavioral documentation, formatting, or private local rename. Every changed hunk is assessed; it excludes executable configuration, all skill/agent/rule/hook paths, public APIs, security, trust boundaries, and ambiguity. A dependency version update remains Fast; a demonstrably non-behavioral dependency-surface edit may qualify.
  - CHECK-1 [AC-1] (authentic-success-path): `node scripts/check-express-lite.js --fixture scripts/__fixtures__/express-lite/eligible-doc.json` → exits 0 and emits `express-lite`.
- A task with a behavior, dependency version update, public API, security, trust-boundary, or ambiguity signal MUST NOT enter Express Lite; it MUST retain or escalate to Fast or Full under the existing routing policy.
  - CHECK-2 [AC-2] (fail-closed-path): `node scripts/check-express-lite.js --fixture scripts/__fixtures__/express-lite/behavior-change.json` → exits 1 and emits an escalation reason.
- An Express Lite completion MUST state that its review was local and did not provide an independent-context review.
  - CHECK-3 [AC-3]: `node scripts/check-express-lite.js --fixture scripts/__fixtures__/express-lite/eligible-doc.json --assert-local-review` → exits 0.
- Express Lite MUST execute only declared relevant checks; an absent or failed required check MUST prevent success and route to Fast rather than claim validation.
  - CHECK-4 [AC-4] (fail-closed-path): `node scripts/check-express-lite.js --fixture scripts/__fixtures__/express-lite/missing-check.json` → exits 1 and emits `fast`.

## Acceptance Criteria

- AC-1 [CHECK-1]: An eligible documentation-only task resolves to Express Lite without a delegated reviewer or preliminary question.
- AC-2 [CHECK-2]: A behavior-changing task does not resolve to Express Lite and retains a non-Express-Lite route.
- AC-3 [CHECK-3]: An Express Lite result identifies its review as local.
- AC-4 [CHECK-4]: A task whose relevant check is unavailable does not report Express Lite success.
- AC-5: A final diff that becomes Lite-ineligible stops with `express-lite-ineligible`; its ledger stays immutable and work restarts as a new Fast or Full task.

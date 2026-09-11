---
status: draft
---

# Delivery Integrity Audit

## Functional Requirements

- **FR-001**: The CLI MUST accept exactly one JSON input file and emit one canonical JSON report to stdout without network access.
- **FR-002**: The input MUST contain a schema version, branch protection state, direct-commit count, merged pull requests and required-check names; malformed or unknown shapes MUST fail with exit code 2.
- **FR-003**: For every merged pull request, the report MUST determine whether required checks are all successful, failed, or not-verifiable because check evidence is absent.
- **FR-004**: The report MUST emit branch-protection, direct-commit and review-evidence predicates as `pass`, `fail` or `not-verifiable`; absence of evidence MUST never be reported as `pass`.
- **FR-005**: Findings MUST contain a stable, unique id, status, severity, evidence paths and an actionable remediation string; finding order MUST be lexical by id.
- **FR-006**: The report MUST be byte-stable for semantically identical inputs whose object-key and array order differ.
- **FR-007**: `roster-audit` documentation MUST describe this as a delivery-integrity supplement and state that it evaluates controls, not people.

## Acceptance Criteria

- **AC-1** [FR-001]: Given a valid fixture, `node scripts/delivery-integrity-audit.js fixture.json` exits 0 and parses as JSON.
- **AC-2** [FR-002]: Given an unknown top-level key or invalid type, the CLI exits 2 and emits an error reason.
- **AC-3** [FR-003]: Given a merged PR with a required failed check, the report contains `PR_REQUIRED_CHECKS_GREEN:pr-<number>` with `fail` and a PR-number/check-name evidence path.
- **AC-4** [FR-003]: Given a merged PR whose checks are absent, the report contains `PR_REQUIRED_CHECKS_GREEN:pr-<number>` with `not-verifiable`.
- **AC-5** [FR-004]: Given protection disabled and direct commits greater than zero, the report contains distinct failing findings for both conditions.
- **AC-6** [FR-005]: Reordering input arrays and object keys does not change serialized output; findings are sorted by id.
- **AC-7** [FR-007]: The roster-audit skill links to the CLI and states the no-network/no-person-scoring boundary.

## Runnable Checks

- **CHECK-1** [AC-1..AC-6]: `node --test scripts/delivery-integrity-audit.test.js` exits 0.
- **CHECK-2** [AC-7]: `rg -q "delivery-integrity-audit" skills/pipeline/roster-audit.md` exits 0.
- **CHECK-3** [AC-1..AC-7]: `npm test` exits 0.

## Risks

- **RISK-1**: A forge adapter could imply more certainty than its captured data permits. Mitigation: the core accepts only explicit evidence and emits `not-verifiable` when it is incomplete.
- **RISK-2**: A governance report could become individual performance surveillance. Mitigation: the schema contains aggregate/control facts only; no author identity or score is accepted.

```claims
{"record":"claims-header","schema_version":1,"namespace":"delivery-integrity-audit","spec_lifecycle":"draft"}
{"record":"requirement","id":"FR-001","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-002","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-003","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-004","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-005","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-006","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-007","depends_on":[],"external_sources":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-001"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-002"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-003"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-003"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-004"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-005","FR-006"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-007"]}
{"record":"check","id":"CHECK-1","for":["AC-1","AC-2","AC-3","AC-4","AC-5","AC-6"]}
{"record":"check","id":"CHECK-2","for":["AC-7"]}
{"record":"check","id":"CHECK-3","for":["AC-1","AC-2","AC-3","AC-4","AC-5","AC-6","AC-7"]}
{"record":"risk","id":"RISK-1"}
{"record":"risk","id":"RISK-2"}
```

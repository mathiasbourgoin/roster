---
title: Optional Roster commit attribution
status: specified
version: 1.0.0
---

# Optional Roster commit attribution

Projects can credit Roster through the existing local Git runtime without collecting metrics.
This feature is a local convention, not a security, authorship or authenticated evidence gate.

## Requirements

- **FR-001:** Attribution is absent/off by default. Existing schema-version 1 telemetry
  configurations remain valid. Optional `attribution: {mode: append|require}` enables it.
  `configure --attribution off|append|require` manages the setting. Invalid modes/objects fail
  without silently resetting preferences or partially installing hooks.
- **FR-002:** The canonical credit is
  `Developed-with: Roster <https://github.com/mathiasbourgoin/roster>`.
  Append ensures one additional credit only when an exact credit is absent from the actual
  final trailer block. Existing exact credit and unrelated body/trailer text remain unchanged.
  Another Developed-with value is preserved and does not count as Roster attribution.
- **FR-003:** Require refuses a final message without the exact credit and names the expected
  line. Body examples, subject lines, comments, folded values, and discarded scissors suffixes
  do not count. Enforcement happens after editor completion, at commit-msg time.
- **FR-004:** Attribution works with telemetry disabled and without any report. Missing
  advisory metrics do not skip attribution. Strict telemetry still enforces its own contract.
  Generated attribution never becomes part of a Harness-only metrics receipt.
- **FR-005:** Native Git trailer/comment/cleanup behavior is respected. Supported custom
  separators and normal scissors with comment-only suffix work. An encoding unable to preserve
  and round-trip the canonical credit refuses explicit attribution with an actionable diagnostic;
  it never silently changes Git settings. Attribution is placed before scissors/comment suffixes.
- **FR-006:** Repeated commits/amends do not duplicate credit. Co-authors and Generated-with
  text are preserved; Roster neither adds nor refuses them as part of attribution.
- **FR-007:** Install/update/configure/status recognize attribution-only operation as needing
  hooks while reporting metrics collection separately. Fully disabled configuration remains
  inactive and is respected by init/update. Existing owned wrappers are upgradeable; custom
  hooks, path ownership, worktree isolation and consumer module scope remain protected.

## User stories and acceptance scenarios

### US-1: Add the Roster credit (P0)

A maintainer enables append and commits through the installed runtime.

1. Given no footer, when the maintainer commits, then the recorded commit contains the credit.
2. Given an existing footer/credit, when committing and amending, then existing text survives
   and the credit is not duplicated.
3. Given a body example, comments or another tool's credit, when append runs, then the actual
   final footer gains the Roster credit and unrelated text remains.

### US-2: Require a deliberate credit (P1)

A maintainer selects require to validate rather than generate the convention.

1. Given the exact final credit, when committing, then the commit succeeds.
2. Given only a body/comment/scissors/folded example, when committing, then commit-msg refuses
   with the canonical expected line.
3. Given an editable template without credit, when the editor supplies it, then require permits
   the final commit without blocking the initial editor opening.

### US-3: Manage attribution independently (P0)

A maintainer wants credit without metrics.

1. Given collection disabled, when enabling attribution, then installed hooks add/check credit
   with no report and no generated Harness metrics.
2. Given an older valid configuration, when updating, then attribution stays off and all existing
   collection preferences remain unchanged.
3. Given supported separators/scissors, when recording a commit, then the credit survives cleanup;
   unsupported round-trips refuse rather than silently losing credit.

## Acceptance checks

- **AC-1:** Real installed-hook tests exercise default-off, append, exact existing footer,
  no footer, body examples, unrelated/Generated-with text, amend and separators.
- **AC-2:** Real commit tests exercise require success/refusal, comment/body/folded/scissors
  negatives and an editor-provided valid credit.
- **AC-3:** Tests exercise disabled/advisory/strict collection, absent reports, enable/disable,
  install/update/status, old-wrapper upgrades and unsupported encoding refusal.
- **AC-4:** Existing telemetry unit, contract and lifecycle suites and the full repository suite
  pass; public docs and skill describe activation, limits and the independent collection setting.

## Design challenges resolved

- The optional setting must extend the strict configuration key allowlist, not replace old configs.
- Attribution is additive; telemetry's Harness-removing replacement helper cannot be reused blindly.
- Apply credit after telemetry validation including advisory fallback, outside metrics receipts.
- Treat exact native final-footer credit as presence, not an arbitrary matching line in raw text.
- Update all activation checks and missing-runtime wrappers, not only the message handler.

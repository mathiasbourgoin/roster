---
name: review-json-schema
type: schema-doc
---

# Schema — `briefs/<task>-review.json`

Canonical, machine-checkable-adjacent documentation of the full review-verdict shape written by
`skills/pipeline/roster-review.md` and read by `scripts/check-review-convergence.js`. This file
moved the full shape out of the skill (FR-111, `specs/review-skill-slimming.md`) — the skill now
only carries a minimal summary + a pointer here.

The finding object itself (used inside `findings[]` and `cross_runtime_findings[]`) is defined
once, machine-readably, in `schema/review-finding.schema.json` — this document does not repeat
that shape; it documents the round-tracking fields a finding gains **after** roster-review
ingests it, and the envelope around the findings arrays.

## Top-level shape

```json
{
  "task": "string — task slug",
  "date": "string — ISO-8601",
  "status": "GO | NO-GO",
  "auto_fixes_applied": [
    { "path": "string", "line": "int", "category": "string", "description": "string" }
  ],
  "findings": ["<finding + round-tracking fields, see below>"],
  "cross_runtime_findings": ["<finding, augment-only, never rewritten>"],
  "summary": { "critical": 0, "high": 0, "medium": 0, "low": 0, "auto_fixed": 0 },
  "no_go_reason": { "type": null, "cause": null, "failed_acs": [] },
  "no_go_round": 0,
  "round": 1,
  "rounds_audit": ["<see below>"],
  "cross_runtime": { "<runtime>": { "status": "healthy|degraded", "reason": null, "config_digest": "string", "round": 1 } },
  "streak_override": null,
  "mode": "express|fast|full",
  "escalation_needed": false,
  "escalation_reason": null,
  "normalized_by": "string — normalizer_version, when scripts/review-normalize.js ran (FR-108)"
}
```

### `no_go_reason.type`

`null | "spec-ac-failure" | "code-plan-failure" | "cross-runtime-finding" | "out-of-scope-change" | "design-not-converging"`

### `no_go_reason.cause` (only set when `type == "design-not-converging"`)

`null | "round-cap" | "unencodable-finding" | "novel-finding-streak"` — persisted `cause` is never
`"process-incomplete"` (that gate-internal cause is repaired pre-persist, §5.5 B-5).

### `escalation_reason`

`null | "new-public-api" | "implicit-design-decision" | "spec-update-needed" | "behaviour-change"`

### Legacy / omission rules

- `cross_runtime_findings`: omit the key entirely if no second runtime ran this cycle.
- `round` / `rounds_audit` / `cross_runtime`: absent entirely on a legacy task (predates
  `review-fanout-convergence`) — never write them mid-cycle if the prior `review.json` lacked
  `round`.
- `streak_override`: `null` unless the human exercised the B-6 streak override this round, then
  `{round, by: "human"}`.

## Finding round-tracking fields (added on top of `schema/review-finding.schema.json`)

Every entry in `findings[]` — old and new — carries these seven fields in addition to the base
finding shape:

| Field | Type | Meaning |
|---|---|---|
| `first_seen_round` | int | the round this finding first appeared |
| `resolved_round` | int \| null | the round it was marked RESOLVED, if any |
| `check` | string \| null | path to the linked ratchet check (invoked as `node <path>`) |
| `check_encodable` | bool | default `true`; `false` = implementer proposes no deterministic check is possible |
| `red_verified` | bool \| null | set by the gate's full-mode red/green run |
| `pre_fix_sha` | string \| null | HEAD at the round this finding was first recorded as a NO-GO driver |
| `check_blob` | string \| null | `git hash-object` of the check file at last verification |

`cross_runtime_findings[]` entries carry the base finding shape only (no round-tracking fields) —
they are mirrored into `findings` (gaining the seven fields) only when they drive a NO-GO
(FR-015).

## `rounds_audit[]` entry shape

```json
{
  "round": 2,
  "reviewed_sha": "<HEAD at the PREVIOUS round's verdict emission, or null>",
  "fix_sha": "<HEAD at THIS round's draft composition, or null if the tree is dirty>",
  "fix_sha_reason": "dirty-tree | null",
  "specialists_run": [
    { "name": "reviewer", "selection_reason": "owner reviewer always runs (FR-072)" }
  ],
  "strike": false
}
```

`strike` is populated **after** the convergence gate reports it — never computed by
roster-review itself.

## `cross_runtime` entry shape (keyed by runtime name)

```json
{ "status": "healthy|degraded", "reason": "string|null", "config_digest": "string", "round": 1 }
```

`config_digest` hashes the runtime name, `--version` output (10s timeout), and sandbox-mode
flags — never the review timeout or prompt/diff content (FR-093/FR-067).

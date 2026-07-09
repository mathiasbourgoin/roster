# Knowledge Base Schema

The knowledge base (`kb/`) stores project documentation, specifications, and audit reports. Managed by **kb-agent**, audited by configured auditor agents.

## File Format

All KB files are markdown with YAML frontmatter:

```yaml
---
title: <string>              # Document title
last-updated: <date>         # ISO 8601 date
status: <live-doctrine|superseded|historical|derived>  # Current state (see values below)
owner: <string>              # Agent or human responsible
schema-version: 2            # Optional. Omit = legacy (v1). Presence = current format.
superseded-by: <path|null>   # Optional. For spec files: path to replacing file, or null.
supersedes: <path|null>      # Optional. For decisions/*.md ADRs: path to superseded ADR, or null.
---
```

Body is standard markdown. Cross-references use relative markdown links (e.g., `[architecture](../architecture.md)`).

### Status Values

| Status | Meaning | Can be set by |
|--------|---------|---------------|
| `live-doctrine` | Current authoritative content — governs agents | Human or kb-agent |
| `superseded` | Replaced by another file (see `superseded-by`) | Human or kb-agent |
| `historical` | No longer current; kept for reference | Human or kb-agent |
| `derived` | Generated/mirror content; not authoritative | Any agent |

### Backward Compatibility

The following legacy status values remain valid and are accepted by all agents:

| Legacy value | Maps to | Migration action |
|---|---|---|
| `draft` | `live-doctrine` | `/kb-migrate` Phase D — **requires human review: verify document is complete before approving** |
| `reviewed` | `live-doctrine` | `/kb-migrate` Phase D |
| `stale` | `historical` | `/kb-migrate` Phase D |

Files without `schema-version` are treated as v1 (legacy). Run `/kb-migrate` to upgrade.

### Agent Governance of New Fields

`schema-version`, `superseded-by`, and `supersedes` may be updated by `kb-agent` without requiring a human gate (they are operational metadata, not spec content).

## Structure Tiers

### Minimal

For small projects or initial bootstrap.

```
kb/
├── index.md
├── spec.md
└── glossary.md
```

### Standard

For active development projects.

```
kb/
├── index.md
├── spec.md
├── architecture.md
├── glossary.md
├── properties.md
├── decisions/
│   ├── index.md
│   └── 001-<title>.md
└── reports/
    ├── index.md
    └── audit-<date>.md
```

### Large

For multi-module or monorepo projects.

```
kb/
├── index.md
├── spec.md
├── architecture.md
├── glossary.md
├── properties.md
├── decisions/
│   ├── index.md
│   └── 001-<title>.md
├── modules/
│   ├── index.md
│   └── <module-name>/
│       ├── index.md
│       ├── spec.md
│       └── architecture.md
├── reports/
│   ├── index.md
│   └── audit-<date>.md
└── runbooks/
    ├── index.md
    └── <runbook-name>.md
```

## Index Files

An `index.md` is required at every directory level. It lists the contents of that directory with one-line descriptions and relative links.

## Immutability Rules

**Spec files** are immutable except by explicit human intent:

- `spec.md` — Project specification
- `architecture.md` — System architecture
- `properties.md` — Invariants and correctness properties
- `glossary.md` — Term definitions
- `decisions/*.md` — Architecture Decision Records

Agents may propose changes to spec files but must not apply them without human approval. Proposals go through the governor agent's review process.

**Operational files** update freely:

- `reports/*.md` — Audit reports, status reports
- `index.md` — Auto-updated when files are added/removed
- TODOs and tracking documents

## Code-Intel Invariant Block (`properties.md`)

`kb/properties.md` MAY contain one optional fenced block tagged `code-intel`, holding machine-checkable invariant declarations as JSONL — one JSON object per line:

`````markdown
```code-intel
{"id": "INV-1", "type": "reachability", "description": "no HTTP handler reaches the raw storage layer", "check": {"from": "handlers/", "to": "storage/raw.ml"}}
```
`````

- Each line declares string fields `id`, `type`, `description`, and an object field `check`.
- **Core owns this envelope** (the fence tag and the JSONL line shape); the `check` object is opaque to core and interpreted by the installed code-intel gate pack (seam contract: `schema/skill-schema.md`; requirements: `specs/code-intel-packs.md` FR-025/FR-026).
- The block is **additive**: prose invariants elsewhere in the file keep their existing meaning and consumers. A `properties.md` without the block is fully valid.
- The block is machine-checked by roster-qa's code-intel gate (`scripts/code-intel-resolve.js gate`); prose-reading auditors skip its contents to avoid double-reporting.

## Auditor Report Format

Audit reports in `reports/` use this frontmatter:

```yaml
---
title: <string>              # e.g., "KB Audit — 2026-03-31"
auditor: <string>            # Agent name that produced the report
date: <date>                 # ISO 8601 audit date
status: <pass|warn|fail>     # Overall audit result
---
```

Body is organized by severity:

```markdown
## Critical

- [finding description + file reference]

## Warning

- [finding description + file reference]

## Info

- [finding description + file reference]
```

Empty severity sections may be omitted.

## Cross-Reference Conventions

- Always use relative paths from the current file.
- Link to specific sections with anchors: `[decisions](decisions/index.md#pending)`.
- When referencing code, use the pattern: `see [module](../src/module.ml) L42-58`.
- Broken links are flagged as warnings during KB audit.

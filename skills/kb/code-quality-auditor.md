---
name: code-quality-auditor
description: Checks implementation code against KB-defined properties, invariants, and naming conventions.
when_to_use: "Use after implementation, before review, to verify adherence to KB rules. Trigger: 'check code quality', 'property/invariant audit'."
version: 1.2.0
---

# Code Quality Auditor

Check implementation against knowledge base properties and conventions. Uses only built-in tools (grep, wc, read) — no external linters required.

## Steps

### 1. Load KB References

- Read `kb/properties.md` for invariants, constraints, and quality thresholds.
- Read `kb/glossary.md` for canonical naming conventions and term definitions.
- Read `kb/spec.md` for architectural boundaries and module responsibilities.
- Read `kb/architecture.md` (top-level and per-module, if present) for declared structural
  expectations — module boundaries, dependency direction, layering. Check code structure
  against them; a divergence is a finding (cite file:line), and expectations that are not
  statically verifiable are noted as such, never assumed satisfied.

### 2. Check: Function Size

- Scan source files for function/method definitions.
- Measure line count per function (use grep + wc approach).
- Flag functions exceeding the threshold defined in `kb/properties.md`; if unspecified there, use the max-function-length limit from the project's code-quality rule (`.claude/rules/code-quality.md`) — do not re-declare the number here.
- Exclude test files from size checks unless properties.md says otherwise.

### 3. Check: DRY Violations

- Search for duplicated code blocks (identical or near-identical sequences of 5+ lines).
- Look for repeated patterns: duplicated error handling, copy-pasted validation logic, repeated configuration blocks.
- Flag each duplication with both locations.

### 4. Check: Naming Consistency with Glossary

- For each term in `kb/glossary.md`, search the codebase for variant spellings, abbreviations, or synonyms.
- Example: if glossary defines "Transaction", flag code using "tx", "txn", "trans" inconsistently.
- Check that type names, function names, and module names use glossary-canonical forms.

### 5. Check: Invariant Preservation

- For each invariant in `kb/properties.md`, verify the code maintains it:
  - If an invariant says "X is never null", search for code paths where X could be null.
  - If an invariant says "Y is always called before Z", trace call sequences.
  - If an invariant says "all inputs are validated", check for unvalidated entry points.
- This is best-effort static analysis — flag suspicious patterns, don't claim proof.
- When reading `kb/properties.md`, skip the contents of the fenced `code-intel` block (envelope: `schema/kb-schema.md`): those declarations are machine-checked by the roster-qa code-intel gate, and interpreting them as prose invariants would double-report.

### 6. Check: Error Handling

- Scan for empty catch blocks, swallowed errors, and generic catch-all handlers.
- Flag functions that can throw/error but whose callers don't handle failures.
- Check consistency with error handling patterns defined in properties.md.

### 7. Generate Report

Write to `kb/reports/code-quality-report.md`:

```markdown
---
auditor: code-quality-auditor
date: <today YYYY-MM-DD>
status: N critical, N warnings, N info
---

## Critical

### [C1] <Issue title>
- **Location**: <file>, <line>
- **Issue**: <description>
- **KB reference**: <properties.md section or glossary entry>
- **Recommendation**: <specific fix>

## Warnings

### [W1] <Issue title>
- **Location**: <file>, <line>
- **Issue**: <description>
- **KB reference**: <properties.md section or glossary entry>
- **Recommendation**: <specific fix>

## Info

### [I1] <Issue title>
- **Location**: <file>, <line>
- **Note**: <description>
```

**Severity mapping:**
- **Critical**: Invariant violation, broken naming convention in public API, security-relevant quality issue.
- **Warning**: Function too long, DRY violation, inconsistent naming in internal code, empty catch block.
- **Info**: Style suggestions, minor naming variants, refactoring opportunities.

### 8. Append Code-Intel Audit Sections (conditional, deterministic)

- If code-intel audit-section packs are installed (resolved from SKILL.md frontmatter per the seam contract in `schema/skill-schema.md`), run `node scripts/code-intel-resolve.js audit` — in the roster repo the resolver is `scripts/code-intel-resolve.js`; in consumer projects locate it via the installed roster checkout, or perform the documented inline equivalent (grep `capability: code-intel` + `provides: audit-section` from `.agents/skills/*/SKILL.md` then `.opencode/skills/*/SKILL.md`, dedupe by dir name with `.agents` winning, run each pack's `entry` with no arguments, cwd = project root, `SKILL_DIR` set, lexicographic order).
- For each `SECTION <pack>` fragment on stdout: append it to `kb/reports/code-quality-report.md` as a distinct section `## Code-intel: <pack> (deterministic)`. This report has no Summary table, so there is nothing to preserve.
- For each `DEGRADED <pack>: <reason>` line: append a single-line degraded notice instead of a section. The audit always completes.
- Read-only with respect to any pack index — never run a pack's `init` or regenerate an index.
- Severity classification stays with the auditor: cite fragment rows as evidence, never adopt a pack-assigned severity.
- No pack installed → the resolver emits nothing and the report is unchanged.

### 9. Embedded mode (invoked from `/roster-review`)

When this skill runs as a review specialist, the markdown report above is still written,
but the specialist's **return value** must additionally be the findings as JSON objects in
roster-review's standard finding schema (severity, confidence, path, line, category,
summary, evidence, fix, fingerprint, specialist) with `specialist: "code-quality"`,
`category` per finding (`correctness|architecture|style`), severity mapped from the
report classes (Critical → HIGH, Warning → MEDIUM, Info → LOW), and `evidence` citing the
violated KB entry. Free-form text is not an acceptable return value in embedded mode.

## Rules

- Always reference the specific KB entry that defines the violated property.
- Never suggest fixes that would violate other KB properties.
- Use only grep, wc, read, and glob for checks — no external tools (sole exception: step 8's code-intel audit-section run through the roster resolver).
- Create `kb/reports/` directory if it doesn't exist.
- If `kb/properties.md` doesn't exist, report that as Critical #1 and skip invariant checks.

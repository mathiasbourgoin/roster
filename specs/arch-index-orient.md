---
name: roster-spec
type: spec
status: live
feature: arch-index-orient — research-orientation provider for the arch-index code-intel pack
brief: briefs/arch-index-orient-intake.md
date: 2026-07-22
version: 1.0.0
---

# Spec — arch-index-orient

> Implements follow-ups 1–3 of `briefs/graphify-research-backend-eval.md` §5. Human validation gate
> WAIVED (autonomous mode, user-authorized 2026-07-22). Reuses FR-030..033 / FR-040 / FR-050..061
> concepts from `briefs/graphify-research-backend-spec.md`, re-scoped to arch-index as the concrete
> `research-orientation` provider.

## Clarifications

| Q | A |
|---|---|
| How does roster-research reach the pack — direct exec or resolver? | Via the resolver. Add a `cmdOrient` subcommand to `scripts/code-intel-resolve.js` reusing `runEntry`/`isTrusted`/timeout. No new mechanism, no direct exec. |
| Output format of `orient.sh`? | JSON row-objects (matching `arch-index query --json`), preceded by the mandatory `<!-- index-freshness: … -->` first line. |
| Is `research-orientation` ever a QA gate? | Never. `provides` MUST NOT be `gate`; `cmdOrient` is advisory (exit 0), it can never route into roster-qa's NO-GO path. |
| What if `.arch-index/index.db` is absent / `sqlite3` & `arch-index` both absent / the two expected tables are missing? | Each is a graceful `exit 3` DEGRADED case with a distinct reason token; verdict-neutral; roster-research falls back to the blind grep/read flow. |
| Does editing `orient.sh` invalidate trust? | No — the ack hashes `SKILL.md` bytes only (existing model, same as gate/audit). Editing `SKILL.md` invalidates. This is the accepted, pre-existing trust property, not a new gap. |
| Cycle safety for `path A B`? | Recursive CTE with `UNION` (not `UNION ALL`) + an explicit depth-counter cap; handles no-path (empty result) and same-node (A==B → trivial zero-length path). |
| Absent/unacked pack effect on roster-research? | Byte-identical to today's blind flow; a one-line skip is recorded in the phase report. Blindness contract and file:line citation requirement are untouched. |

## User Stories

### US-1: Orientation query surface (Priority: P0)
As the blind roster-research phase, I want callers/callees/fan-in/definition queries over the
existing `.arch-index/index.db`, so that I can orient toward candidate symbols before reading files.
**Why this priority**: This is the core deliverable (follow-up 1); without it there is no
research-orientation provider.
**Scope**: This story does NOT cover import/dataflow edges (follow-up 4, out of scope) or docs
nodes (follow-up 5, out of scope).
**Independent Test**: Against a fixture DB, `orient.sh callers <sym>` / `callees <sym>` /
`fan-in` / `definition <sym>` each emit the freshness header then correct JSON rows.
**Acceptance Scenarios**:
1. **Given** a fixture `index.db` where `foo` calls `bar` and `baz`, **When**
   `orient.sh callees foo` runs, **Then** stdout is the freshness header followed by JSON rows for
   `bar` and `baz`, capped at `TOP_N`/`LIMIT`.
2. **Given** the same DB, **When** `orient.sh callers bar` runs, **Then** the JSON rows include
   `foo`.
3. **Given** the same DB, **When** `orient.sh fan-in` runs, **Then** rows are symbols ranked by
   incoming-caller count (`GROUP BY callee`), `LIMIT TOP_N`.
4. **Given** a symbol absent from `symbols`, **When** `orient.sh definition <absent>` runs,
   **Then** stdout is the freshness header followed by an empty JSON array `[]`, exit 0.

### US-2: Path query with recursive CTE (Priority: P0)
As the researcher mapping module relationships, I want `path <A> <B>` over the `calls` table, so
that I can see how one symbol reaches another — closing the `graphify path` packaging gap.
**Why this priority**: The one packaging gap the graphify eval explicitly identified.
**Scope**: This story does NOT add new edge types; it traverses existing `calls(caller,callee)` only.
**Independent Test**: On a fixture with a chain A→B→C and a cycle X→Y→X, `path A C` returns the
chain and `path X X` / a cyclic query terminates without infinite loop, within the depth cap.
**Acceptance Scenarios**:
1. **Given** `calls` rows A→B, B→C, **When** `orient.sh path A C` runs, **Then** it returns a
   depth-bounded path A→B→C as JSON, exit 0.
2. **Given** a cycle X→Y, Y→X, **When** `orient.sh path X Z` (Z unreachable) runs, **Then** the
   recursion terminates (via `UNION` dedupe + depth cap) and returns an empty path, exit 0.
3. **Given** `A == B`, **When** `orient.sh path A A` runs, **Then** it returns a trivial
   zero-length/same-node result, exit 0 — never an error.

### US-3: Graceful degradation (Priority: P0)
As any consumer, I want `orient.sh` to fail closed and verdict-neutral when its inputs are missing,
so that a missing index or an unexpected schema never breaks the pipeline.
**Why this priority**: A host repo may carry a newer/older/absent index; the pack must never block.
**Scope**: Covers db-absent, tool-absent, schema-mismatch. Does NOT cover partial/corrupt rows
(treated as empty results).
**Independent Test**: With no `index.db` → exit 3 `index-missing`; with neither `arch-index` nor
`sqlite3` on PATH → exit 3 `tool-missing`; with a DB lacking `calls`/`symbols` → exit 3
`schema-mismatch`.
**Acceptance Scenarios**:
1. **Given** `.arch-index/index.db` absent, **When** any mode runs, **Then** exit 3 with reason
   `index-missing` on stderr, no stdout rows.
2. **Given** neither `arch-index` nor `sqlite3` on PATH, **When** any mode runs, **Then** exit 3
   with reason `tool-missing: neither arch-index nor sqlite3 is on PATH`.
3. **Given** a DB present but missing the `calls` or `symbols` table, **When** any mode runs,
   **Then** exit 3 with reason `schema-mismatch: <table> not found`, verdict-neutral.

### US-4: Graph-first-then-verify research protocol (Priority: P0)
As the blind roster-research phase, I want to query an acknowledged research-orientation pack first
and then verify every graph-derived claim against the live file, so that speed never costs
correctness and blindness is preserved.
**Why this priority**: Follow-up 3; the reason the provider exists.
**Scope**: Does NOT change the blindness contract; does NOT add a mechanical citation verifier.
**Independent Test**: With the pack acked, research.md graph-derived findings each carry a file:line
confirmed by opening the file; absent/unacked pack → byte-identical blind flow.
**Acceptance Scenarios**:
1. **Given** an acked research-orientation pack and a codebase question, **When** the researcher
   orients, **Then** it queries the graph first (via the resolver) to locate candidates before
   grep/read.
2. **Given** a graph hit `foo.ts:42 calls bar`, **When** the researcher records it, **Then** it
   opens `foo.ts:42`, confirms from live source, and only then writes the
   `**References:** foo.ts:42 — <desc>` line.
3. **Given** a graph hit the live file contradicts (stale/deleted file), **When** the researcher
   verifies, **Then** the claim is dropped or corrected to match the file — the file wins.

### US-5: Staleness advisory + absence/unack degradation (Priority: P1)
As a researcher, I want a warning when the index is older than HEAD and unchanged behavior when the
pack is missing/unacked, so that I never trust a stale index and this is never a hard dependency.
**Why this priority**: Advisory safety; hard-dependency avoidance.
**Scope**: Advisory only, never a gate.
**Independent Test**: Index mtime < HEAD commit time → advisory warning surfaced, flow unchanged;
no pack / unacked / crash / timeout → today's blind flow + recorded skip.
**Acceptance Scenarios**:
1. **Given** `index.db` mtime older than HEAD, **When** research touches the pack, **Then** an
   advisory staleness note is surfaced ("index stale — verify against live files"); research is not
   blocked.
2. **Given** no acked pack (absent or sha256 mismatch), **When** roster-research runs, **Then**
   behavior is byte-identical to the pre-integration blind flow and a one-line skip is recorded.
3. **Given** an `orient` call that crashes or times out, **When** research runs, **Then** it
   degrades to grep/read and records the degradation — no verdict impact.

### US-6: Single-seam wiring (Priority: P0)
As a roster maintainer, I want the provider delivered through the existing code-intel seam, so that
no parallel mechanism is introduced.
**Why this priority**: The binding operator rule.
**Scope**: Does NOT add a registry file, detection path, or trust model.
**Independent Test**: `research-orientation` is accepted by `PROVIDES_VALUES`; the arch-index
registry entry lists it and passes the checker; `cmdOrient` trust-gates via the existing
`pack.trusted`.
**Acceptance Scenarios**:
1. **Given** the new SKILL.md with the seam quadruple, **When** `code-intel-resolve.js list` runs,
   **Then** the pack is recognized with `provides: research-orientation` and no validity violation.
2. **Given** the edited registry entry, **When** `node scripts/check-code-intel-registry.js` runs,
   **Then** exit 0 with `research-orientation` present in the arch-index `provides` array.
3. **Given** the pack unacked, **When** `cmdOrient` resolves it, **Then** it reports
   `DEGRADED <pack>: unacknowledged — not executed` and returns exit 0 (never blocking).

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-6 | Adding `research-orientation` to `PROVIDES_VALUES` could accidentally widen the gate path. | `cmdGate` filters `provides === "gate"` only; `research-orientation` is filtered exclusively by the new `cmdOrient` (advisory, exit 0). Mechanical separation — a negative-grep CHECK asserts `orient.sh` frontmatter is not `gate`. |
| C-2 | US-2 | `UNION ALL` recursive CTE loops forever on cyclic `calls`. | Use `UNION` (dedupes visited rows before requeue) + explicit depth-counter column with `WHERE level < N` cap (SQLite docs, research Q8). |
| C-3 | US-3 | Upstream may ship a newer/older schema; hard-coding columns beyond the two observable tables would break. | Query ONLY `calls(caller,callee)` + `symbols(name,visibility,comment_quality_score)`; probe table presence and exit 3 `schema-mismatch` if absent. |
| C-4 | US-1 | `arch-index query --json` may be absent (binary not installed) but `sqlite3` present. | Dual path exactly like `audit.sh:38-47`: prefer `arch-index query --json`, else `sqlite3` emitting the same JSON shape; both absent → exit 3 `tool-missing`. |
| C-5 | US-4 | No mechanical citation verifier exists (research Q3) — is verify-before-land enforceable? | Prose obligation on the researcher, consistent with the existing "no floating claims" rule (`roster-research.md:244`). A CI verifier is explicitly out of scope (matches graphify C-3). |
| C-6 | US-4 | Prior art: LSP call-hierarchy exposes on-demand one-hop expansion with no stored path query (research Q7); this task ships a stored-graph `path`. | Justified: arch-index is a stored-edge SQLite index (the stored-graph camp per Q7), where path/transitive queries legitimately exist; LSP's model does not apply. |

## Functional Requirements

#### Orientation provider (US-1)
- **FR-001** [US-1]: `orient.sh` MUST support modes `callers <sym>`, `callees <sym>`, `fan-in`,
  `definition <sym>`, and `path <A> <B>`, dispatched by `$1`.
- **FR-002** [US-1]: `orient.sh` MUST emit the mandatory index-freshness header
  `<!-- index-freshness: <index.db mtime ISO-8601 UTC> vs HEAD <short> -->` as its first content
  line for every successful (exit-0) invocation, reusing the `audit.sh:66-68` idiom.
- **FR-003** [US-1]: Query output MUST be JSON row-objects (the `arch-index query --json` shape);
  every result set MUST be capped by a `TOP_N`/`LIMIT` (default 10, matching `audit.sh`).
- **FR-004** [US-1]: `orient.sh` MUST rely ONLY on `calls(caller,callee)` and
  `symbols(name,visibility,comment_quality_score)`; it MUST NOT reference any other table or column.

#### Path query (US-2)
- **FR-010** [US-2]: `path <A> <B>` MUST traverse `calls` with a recursive CTE using `UNION`
  (not `UNION ALL`) for cycle safety and an explicit depth-counter cap.
- **FR-011** [US-2]: `path` MUST return an empty result (exit 0) when no path exists, and a trivial
  same-node result (exit 0) when `A == B` — never an error or infinite loop.

#### Degradation (US-3)
- **FR-020** [US-3]: When `.arch-index/index.db` is absent, `orient.sh` MUST exit 3 with reason
  token `index-missing` on stderr and emit no rows.
- **FR-021** [US-3]: When neither `arch-index` nor `sqlite3` is on PATH, `orient.sh` MUST exit 3
  with reason `tool-missing: neither arch-index nor sqlite3 is on PATH`.
- **FR-022** [US-3]: When the DB lacks `calls` or `symbols`, `orient.sh` MUST exit 3 with reason
  `schema-mismatch: <table> not found` — verdict-neutral, never a hard failure.

#### Graph-first research (US-4)
- **FR-030** [US-4]: When an acknowledged `provides: research-orientation` pack is available,
  roster-research MUST query it first (via the resolver `orient` subcommand) to orient before
  falling back to grep/read.
- **FR-031** [US-4]: roster-research MUST open the cited file:line and confirm every graph-derived
  claim against live source before writing it to `research.md` — the live read is authoritative.
- **FR-032** [US-4]: When a graph hit conflicts with the live file (stale/deleted), roster-research
  MUST drop or correct the claim to match the file, never the graph.
- **FR-033** [US-4]: The provider MUST NOT weaken the blindness contract (read only the questions
  file) or the file:line citation requirement; the added section MUST be additive.

#### Staleness & absence (US-5)
- **FR-040** [US-5]: When `index.db` is older than HEAD, the consumer MUST surface an advisory
  staleness note and MUST NOT convert it into a gate or verdict change.
- **FR-050** [US-5]: When no acknowledged research-orientation pack exists, roster-research MUST
  behave byte-identically to the pre-integration blind flow and record the skip in the phase report.
- **FR-051** [US-5]: An unacknowledged, crashing, or timing-out provider MUST degrade advisorily
  (recorded) and MUST NOT block any verdict.

#### Single seam & trust (US-6)
- **FR-060** [US-6]: `scripts/code-intel-resolve.js` `PROVIDES_VALUES` MUST include
  `research-orientation`, and a `cmdOrient` subcommand MUST filter `provides === "research-orientation"`,
  execute trusted entries via the existing `runEntry` (args forwarded), and return exit 0 (advisory).
- **FR-061** [US-6]: The system MUST NOT invoke the research-orientation pack as a QA gate;
  `roster-qa` MUST NEVER be able to produce a NO-GO from it (`provides` is not `gate`).
- **FR-062** [US-6]: The arch-index entry in `registry/code-intel.jsonl` MUST add
  `research-orientation` to its existing `provides` array (no new registry file) and MUST pass
  `scripts/check-code-intel-registry.js`.
- **FR-063** [US-6]: The pack `entry` MUST execute only after the existing sha256 execution-ack
  (extension install-record match OR explicit `code-intel-resolve.js ack`); no new trust machinery.

## Acceptance Criteria

- AC-1 [US-1 happy path]: `orient.sh callees|callers|fan-in|definition` against the fixture DB emit
  freshness header + correct capped JSON.
- AC-2 [US-2 happy path]: `path A C` returns the depth-bounded chain; cyclic input terminates.
- AC-3 [US-2, C-2]: `path A A` → trivial same-node result; unreachable → empty; both exit 0.
- AC-4 [US-3, C-3]: db-absent → exit 3 `index-missing`; tools-absent → exit 3 `tool-missing`;
  schema-missing → exit 3 `schema-mismatch`.
- AC-5 [US-4]: A graph-derived finding in research.md carries a file:line verified against the live
  file; a contradicting hit is dropped/corrected.
- AC-6 [US-5]: Stale index → advisory note, research not blocked; no/unacked pack → byte-identical
  blind flow + recorded skip.
- AC-7 [US-6, C-1]: `list` recognizes the pack as `research-orientation`; registry checker passes
  with `research-orientation` present; the pack is NOT invoked as a gate.
- AC-8 [US-6, FR-063]: Editing the pack SKILL.md reverts it to unacknowledged; `cmdOrient` reports
  DEGRADED and does not execute.

## Edge Cases

- EC-1 [US-2]: `calls` path deeper than the depth cap → truncated at the cap, exit 0 (not an error).
- EC-2 [US-3]: DB present but empty (valid schema, zero rows) → freshness header + empty `[]`, exit 0
  (distinct from schema-mismatch).
- EC-3 [US-4]: Graph references a file deleted since indexing → treat as stale hit, drop the claim.
- EC-4 [US-5]: `index.db` missing entirely while pack acked → degrade to grep/read + record (same as
  absence), no staleness warning (nothing to compare) — matches graphify EC-4.
- EC-5 [US-6]: A future maintainer sets `provides: gate` on the orient pack → `cmdGate` would then
  pick it up; the negative-grep CHECK-3 + this spec forbid it; the intended value is
  `research-orientation`.

## Runnable Checks

- CHECK-1 [AC-1/AC-2/AC-3]: `node --test scripts/arch-index-orient.test.js` (or the extended
  `scripts/arch-index-pack.test.js`) → exit 0 — fixture-DB test exercises every mode incl. path
  cycle-safety and same-node.
- CHECK-2 [AC-4]: shell test in the same file: run `orient.sh` with no DB / stubbed empty PATH /
  schema-less DB → asserts exit 3 and the exact reason token for each.
- CHECK-3 [AC-7/EC-5]: `grep -Eq '^provides:[[:space:]]*gate' extensions/arch-index/skills/arch-index-orient/SKILL.md`
  → expected exit 1 (MUST NOT be a gate); and
  `grep -q 'research-orientation' extensions/arch-index/skills/arch-index-orient/SKILL.md` → exit 0.
- CHECK-4 [AC-7]: `node scripts/check-code-intel-registry.js` → exit 0 with `research-orientation`
  in the arch-index `provides`.
- CHECK-5 [AC-8]: manual — edit the pack SKILL.md, run `node scripts/code-intel-resolve.js orient …`,
  confirm the pack reports unacknowledged / not executed.
- CHECK-6 [gates]: `npm run build:ts && npm test && bash scripts/sync-harness.sh --check` → all
  exit 0.

## Entities

- `arch-index-orient`: a code-intel skill (`provides: research-orientation`) wrapping `orient.sh`,
  read-only against `.arch-index/index.db`.
- `orient.sh`: the sibling executable exposing callers/callees/fan-in/definition/path query modes as
  JSON.
- `research-orientation`: the new `provides` seam value — an advisory orientation provider, never a
  QA gate.
- `cmdOrient`: the resolver subcommand that trust-gates and executes research-orientation providers,
  advisory (exit 0).

## Completion marker

**User stories:** 6
**Clarifications:** 7
**Challenges resolved:** 6/6
**Functional requirements:** 18
**ACs:** 8
**Runnable checks:** 6 (2 mechanical test, 1 negative-grep + positive-grep, 1 registry, 1 manual, 1 gate aggregate)

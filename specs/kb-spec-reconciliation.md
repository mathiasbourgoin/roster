---
name: kb-spec-reconciliation
type: spec
status: live
feature: deterministic KB/spec reconciliation
brief: briefs/kb-spec-reconciliation-intake.md
date: 2026-09-04
version: 1.0.0
---

# Spec — Deterministic KB/spec reconciliation

## Clarifications

| Q | A |
|---|---|
| Does the initial audit modify existing specs? | No. It emits deterministic metrics and candidate metadata only. |
| Where does normative text live? | In existing Markdown FR, AC, CHECK, decision, term, risk, and invariant lines. JSONL records carry metadata only. |
| How are repeated local IDs distinguished? | A permanent namespace in the `claims` header qualifies every local ID. |
| What replaces projected `S<N>` IDs? | Generated KB uses qualified claim IDs; legacy KB can retain an explicitly labeled `S<N>` fallback. |
| Are dependency cycles supported? | No in V1. Self edges and cycles fail validation explicitly. |
| What makes a projection fresh? | A digest over the canonical model, authority file, root lock, renderer version, and selection-policy version. |
| What happens without embeddings? | Optional suggestions disappear; mandatory dependency closure and every gate remain unchanged. |
| Is `active` evidence of implementation? | No. Lifecycle applicability and evidence verification are independent axes. |

## User Stories

### US-1: Audit and migrate existing specifications (Priority: P0)

As a Roster maintainer, I want to inspect existing Markdown contracts and generate deterministic migration candidates so that I can introduce stable metadata without silently rewriting or reinterpreting historical requirements.

**Why this priority:** Every later feature depends on trustworthy identity and a non-destructive migration boundary.
**Scope:** This story does not approve candidate namespaces, rewrite specs, or infer identity from similar text.
**Independent Test:** Run the audit twice over fixtures and the current corpus, compare bytes and Git state, then mutation-test recognition boundaries.

**Acceptance Scenarios:**
1. **Given** a spec with canonical FR, AC, and CHECK lines and no claims block, **When** audit runs, **Then** it emits a candidate namespace, metadata records, and fixed-denominator metrics without changing the spec.
2. **Given** the same corpus and tool/policy versions, **When** audit runs twice, **Then** the reports are byte-identical and the worktree is unchanged.
3. **Given** identifiers inside fences, examples, generated projections, or non-canonical headings, **When** audit runs, **Then** those identifiers are excluded from extraction and denominators.
4. **Given** an approved permanent namespace, **When** a file is renamed, **Then** subsequent audits retain the qualified IDs.

### US-2: Validate, close, project, and check claims (Priority: P0)

As a pipeline operator, I want deterministic validation, dependency closure, projection, and freshness checks so that every consumer uses the same applicable contract or stops with a precise error.

**Why this priority:** A generated KB is useful only when its source, authority, dependencies, and renderer can be reproduced.
**Scope:** This story does not establish semantic truth, approve authority, or use search similarity as evidence.
**Independent Test:** Exercise valid fixtures plus one mutation for every closed-schema, graph, lock, authority, canonicalization, and freshness rule.

**Acceptance Scenarios:**
1. **Given** paired Markdown and metadata, a valid authority map, and a complete root lock, **When** validation and projection run, **Then** the closure is complete and every generated KB file carries the same reproducible freshness digest.
2. **Given** unknown fields, unknown versions, duplicate qualified IDs, missing pairs, cycles, missing locks, or exceeded closure budget, **When** validation runs, **Then** it fails closed with a distinct reason and emits no partial projection.
3. **Given** inputs differing only in declared canonical equivalences, **When** digests are computed, **Then** they match; changing model, authority, lock, renderer, or policy changes the freshness digest.
4. **Given** a stale or absent projection, **When** a dependent phase starts, **Then** it stops before consuming the KB.
5. **Given** a `pending-confirmation` migrated claim, **When** closure is computed, **Then** the claim remains mandatory and is exposed as a residual rather than as verified.

### US-3: Preserve Roster workflow compatibility (Priority: P0)

As an engineer using Roster, I want the pipeline skills and existing QA gates to consume qualified, fresh contracts without losing blind research or offline operation so that adoption does not regress current workflows.

**Why this priority:** The substrate cannot be adopted if it breaks `roster-qa`, installed runtime projections, or research isolation.
**Scope:** This story does not provide semantic search offline; disabling embeddings is an acceptable mode because search enrichment is optional.
**Independent Test:** Synchronize all harness projections, compare old/new code-intel fixtures and verdicts, inspect neutral manifests, and run the full repository suite without network access to an embedding provider.

**Acceptance Scenarios:**
1. **Given** a projected `kb/properties.md`, **When** `roster-qa` extracts and invokes code-intel, **Then** the provider receives identical JSONL and returns the same exit code and verdict as before migration.
2. **Given** a neutral research manifest, **When** it is validated, **Then** technical IDs and domain terms are accepted while normative statements, lifecycle, authority, and task intent are rejected.
3. **Given** embeddings disabled, **When** a context manifest is built, **Then** optional semantic candidates are absent but mandatory closure and digest are unchanged.
4. **Given** new projected KB findings, **When** compliance audit reports them, **Then** it cites qualified stable IDs; any positional fallback is explicitly labeled legacy.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | US-1 | Assigning a permanent namespace conflicts with a read-only audit. | Audit emits candidates only; permanence begins with an authority-approved patch. |
| C-2 | US-1 | Markdown examples and generated views resemble normative lines. | Only exact list grammar under canonical headings is recognized; fences and projections are excluded. |
| C-3 | US-1 | Similar text could cause unstable identity across moves or splits. | Identity is never text-derived; rename retains ID and split/merge requires explicit supersession. |
| C-4 | US-1 | Migration metrics lack stable denominators. | The denominator is the exact set of recognized normative source lines; auto-sources do not count as independent evidence. |
| C-5 | US-2 | A one-to-one rule could reject localized or repeated views. | Pairing applies only to normative source lines; all other renderings are marked projections. |
| C-6 | US-2 | Lifecycle could be mistaken for verification. | They are stored and evaluated as independent axes, following SysML/OSLC separation. |
| C-7 | US-2 | Schema extension behavior is ambiguous. | V1 is closed and versioned; unknown versions, records, and fields fail closed. |
| C-8 | US-2 | Dependency closure may be cyclic, unavailable, or truncated. | V1 admits required edges only; self/cyclic/missing/unlocked/over-budget graphs fail explicitly. |
| C-9 | US-2 | Per-import revisions can produce inconsistent external snapshots. | A single root `specs/claims.lock` pins external registries; imports name registry and claim only. |
| C-10 | US-2 | Digest equality does not prove authorized approval. | Authority is a separate map and gate; freshness covers its digest but does not replace its decision. |
| C-11 | US-2 | Canonical bytes and projection freshness are underspecified. | Canonicalization and freshness inputs are closed and versioned in FR-028 through FR-030. |
| C-12 | US-3 | Qualified IDs can reveal domain through a neutral manifest. | Domain disclosure is accepted; normative text, lifecycle, authority, and task intent remain forbidden. |
| C-13 | US-3 | Disabling embeddings may remove discovery and change verdicts. | Semantic results are optional hints only; deterministic mandatory closure is independent of them. |
| C-14 | US-3 | Existing consumers use `S<N>` and code-intel's exact JSONL seam. | Historical sources stay untouched; new output uses qualified IDs and code-intel must pass byte/verdict parity fixtures. |

## Functional Requirements

#### Audit and migration

- **FR-001** [US-1]: The audit command MUST complete without modifying any file in the inspected repository.
- **FR-002** [US-1]: Audit MUST emit candidate namespaces without granting them permanent status.
- **FR-003** [US-1]: A candidate namespace MUST become eligible for permanent use only when its spec is `active`, the external authority map is valid, and repository review policy separately authenticates the approver.
- **FR-004** [US-1]: The extractor MUST recognize only exact bare or bold `FR-NNN`, `AC-N`, `CHECK-N`, `D-N` or `DEC-N`, `TERM-N`, `RISK-N`, and `INV-N` list-item grammar under their canonical headings.
- **FR-005** [US-1]: The extractor MUST NOT recognize identifiers inside fenced blocks or generated projections as normative sources.
- **FR-006** [US-1]: Migration metric denominators MUST equal the total number of FR, AC, CHECK, decision, term, risk, and invariant source lines recognized by FR-004 and FR-005, and zero-recognition source specs MUST be named in the audit report.
- **FR-007** [US-1]: Each metadata record MUST match exactly one recognized normative line and each paired line MUST match exactly one record.
- **FR-008** [US-1]: The system MUST NOT infer claim identity from claim text.
- **FR-009** [US-1]: A retained claim marked `superseded` MUST declare its replacement; detecting a deleted claim, split, or merge without a previous approved model remains a review responsibility in V1.
- **FR-010** [US-1]: Migration MUST NOT rewrite historical unqualified identifiers in source artifacts.
- **FR-011** [US-1]: New migration and audit output MUST emit qualified identifiers.
- **FR-012** [US-1]: A consumer using an unqualified historical identifier MUST label it as a legacy fallback.
- **FR-013** [US-1]: Audits over identical bytes and policy versions MUST produce byte-identical results.

#### Validation and projection

- **FR-014** [US-2]: The claims schema MUST be closed and explicitly versioned.
- **FR-015** [US-2]: Validation MUST fail on an unknown schema version.
- **FR-016** [US-2]: Validation MUST fail on an unknown record type.
- **FR-017** [US-2]: Validation MUST fail on a field not declared by the active schema version.
- **FR-018** [US-2]: Claim lifecycle and evidence verification state MUST be represented independently; V1 MUST initialize verification to `absent` until a separately validated evidence artifact is supplied.
- **FR-019** [US-2]: Authority MUST resolve exclusively from a separate authority file and gate.
- **FR-020** [US-2]: A claims block MUST NOT declare or modify its own authority.
- **FR-021** [US-2]: A V1 dependency MUST be required and reference either a local claim or a qualified external claim.
- **FR-022** [US-2]: Resolution MUST return the complete mandatory closure or fail, and MUST NOT return a truncated closure.
- **FR-023** [US-2]: Resolution MUST fail explicitly on a self dependency or dependency cycle.
- **FR-024** [US-2]: Resolution MUST fail explicitly on a missing dependency or exceeded closure budget.
- **FR-025** [US-2]: Resolution MUST fail explicitly when a required external lock or locked source is unavailable.
- **FR-026** [US-2]: A root repository MUST use one `specs/claims.lock` to pin immutable external registry revisions.
- **FR-027** [US-2]: Validation MUST fail when a qualified ID occurs more than once, including duplicates reached through distinct imports.
- **FR-028** [US-2]: Canonicalization MUST sort records, object keys, and set-like arrays after parsing JSON, normalize strings to NFC, and normalize line endings to LF.
- **FR-029** [US-2]: The canonical model digest MUST exclude timestamps and include the model version.
- **FR-030** [US-2]: A projection freshness digest MUST cover the canonical model, including source `code-intel` fences, authority map, root lock, renderer version, and selection-policy version.
- **FR-031** [US-2]: Every view generated by V1 MUST be marked as a projection and MUST NOT become a normative source; localized views are not generated by V1.
- **FR-032** [US-2]: Freshness checking MUST reject an absent projection or a digest that differs from current inputs.
- **FR-033** [US-2]: Disabling embeddings MUST remove only optional candidate enrichment.
- **FR-034** [US-2]: Mandatory closure and its digest MUST remain identical with embeddings enabled or disabled.
- **FR-035** [US-2]: A semantic-search result MUST be labeled as a hint and MUST NOT be accepted as evidence.

#### Workflow compatibility

- **FR-036** [US-3]: A neutral research manifest MUST contain only questions, technical identifiers, and digests.
- **FR-037** [US-3]: A neutral research manifest schema MUST NOT expose fields for normative text, lifecycle, authority, or task intent; question wording remains subject to the agentic generator and human review gate.
- **FR-038** [US-3]: Domain terms in questions or technical IDs MUST NOT alone invalidate a neutral manifest.
- **FR-039** [US-3]: Compatibility fixtures MUST deliver byte-identical extracted JSONL from a source spec to the code-intel provider before and after projection.
- **FR-040** [US-3]: Compatibility fixtures MUST preserve the code-intel provider exit status and corresponding QA verdict.
- **FR-041** [US-3]: A pipeline phase dependent on a projection MUST stop when that projection is absent or stale.
- **FR-042** [US-3]: New workflow reports and projections MUST use qualified IDs while preserving historical unqualified IDs in their source artifacts.
- **FR-043** [US-3]: A workflow using positional `S<N>` fallback MUST label the reference as legacy.

## Acceptance Criteria

- **AC-1** [US-1]: Two audits of the same corpus produce byte-identical output and leave Git state unchanged.
- **AC-2** [US-1, C-2]: Bare and bold FR, AC, CHECK, decision, term, risk, and invariant IDs under canonical headings are extracted; IDs outside those headings, inside fences, or in projections are neither extracted nor counted, and zero-recognition specs are reported.
- **AC-3** [US-1, C-1]: Audit labels a non-active namespace as a candidate; active lifecycle plus a valid external authority map makes it stable across file rename, while reviewer identity remains a repository-policy gate.
- **AC-4** [US-1, C-5]: Missing, duplicate, or unmatched line/record pairs fail validation.
- **AC-5** [US-1, C-3]: Text changes preserve identity and a retained `superseded` record without `superseded_by` is rejected; deletion-only split/merge detection is explicitly outside V1 without prior-model input.
- **AC-6** [US-2, C-7]: Unknown version, record, and field mutations all fail validation.
- **AC-7** [US-2, C-10]: Authority in a claims block is rejected and a missing/failed authority map blocks the dependent decision.
- **AC-8** [US-2, C-8]: Valid local/external closure is complete; self-edge, cycle, missing dependency, exceeded budget, and unavailable lock each return a distinct failure.
- **AC-9** [US-2, C-9]: Duplicate qualified IDs fail even when reached through different imports.
- **AC-10** [US-2, C-11]: Declared canonical equivalents share a digest; changing any versioned freshness input, including source `code-intel`, changes the projection digest.
- **AC-11** [US-2]: Changing model, authority, lock, renderer, or selection policy makes projections stale and blocks dependent phases.
- **AC-12** [US-2, C-13]: With embeddings disabled, optional hints disappear while mandatory closure and digest remain identical.
- **AC-13** [US-3, C-12]: Neutral manifests accept domain-bearing technical IDs but reject statement, lifecycle, authority, and intent fields; their question digest is verified and human review remains responsible for semantic leakage in question wording.
- **AC-14** [US-3, C-14]: Compatibility fixtures preserve source code-intel JSONL, provider exit codes, and QA verdicts across projection; generated-code-intel tampering is stale and source-less legacy fences are rejected; new reports qualify IDs and label positional fallbacks legacy.

## Edge Cases

- **EC-1** [US-1]: Empty corpus or no recognized requirement lines produces a valid zero-count audit.
- **EC-2** [US-1]: Identical text in active, superseded, example, and generated documents does not merge identities.
- **EC-3** [US-1]: Case-only and Unicode-normalization namespace collisions fail validation.
- **EC-4** [US-1]: File rename retains an installed namespace; claim moves require explicit history.
- **EC-5** [US-2]: `active` lifecycle with absent or failed verification remains representable.
- **EC-6** [US-2]: Passing verification with draft, pending, superseded, or retired lifecycle remains representable.
- **EC-7** [US-2]: Self-dependency, graph cycle, missing node, mutable lock revision, and unavailable locked object fail distinctly.
- **EC-8** [US-2]: Byte-identical content with changed authority or renderer is stale.
- **EC-9** [US-2]: A root lock is excluded from self-hashing but its normalized content is included in the projection freshness digest.
- **EC-10** [US-3]: Missing, corrupt, stale, or differently locked optional search index never changes mandatory closure.
- **EC-11** [US-3]: Historical unqualified IDs remain ambiguous but are not silently rebound.
- **EC-12** [US-3]: Concurrent branches assigning the same qualified ID both pass locally but fail after merge through duplicate detection.

## Runnable Checks

- **CHECK-1** [AC-1]: `node scripts/claims-reconcile-check.js audit-determinism` → expected: 0 on byte-identical reports and unchanged fixtures.
- **CHECK-2** [AC-2]: `node scripts/claims-reconcile-check.js recognition-boundary` → expected: 0 when only canonical source lines are counted.
- **CHECK-3** [AC-3]: `node scripts/claims-reconcile-check.js namespace-stability` → expected: 0 when candidate/install/rename behavior matches the contract.
- **CHECK-4** [AC-4]: `node scripts/claims-reconcile-check.js pairing-mutations` → expected: 0 when every missing/duplicate pair mutation is rejected.
- **CHECK-5** [AC-5]: `node scripts/claims-reconcile-check.js identity-history` → expected: 0 when text changes retain IDs, retained superseded claims name replacements, and the documented deletion-only V1 limitation remains explicit.
- **CHECK-6** [AC-6]: `node scripts/claims-reconcile-check.js closed-schema` → expected: 0 when unknown version/type/field mutations fail.
- **CHECK-7** [AC-7]: `node scripts/claims-reconcile-check.js authority-boundary` → expected: 0 when block authority and missing authority maps fail.
- **CHECK-8** [AC-8]: `node scripts/claims-reconcile-check.js dependency-closure` → expected: 0 for complete closure and all distinct failure fixtures.
- **CHECK-9** [AC-9]: `node scripts/claims-reconcile-check.js duplicate-imports` → expected: 0 when duplicate qualified IDs fail.
- **CHECK-10** [AC-10]: `node scripts/claims-reconcile-check.js canonical-digest` → expected: 0 for equivalence and invalidation fixtures.
- **CHECK-11** [AC-11]: `node scripts/claims-reconcile-check.js projection-freshness` → expected: 0 when each freshness input invalidates the projection.
- **CHECK-12** [AC-12]: `node scripts/claims-reconcile-check.js offline-context` → expected: 0 when disabled embeddings preserve mandatory closure/digest.
- **CHECK-13** [AC-13]: `node scripts/claims-reconcile-check.js neutral-manifest` → expected: 0 for accepted and rejected manifest fixtures.
- **CHECK-14** [AC-14]: `node scripts/claims-reconcile-check.js workflow-compatibility` → expected: 0 for code-intel byte/verdict parity and qualified reporting.

## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"kb-spec-reconciliation","spec_lifecycle":"pending-confirmation"}
{"record":"requirement","id":"FR-001","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-002","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-003","depends_on":["FR-002"],"external_sources":[]}
{"record":"requirement","id":"FR-004","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-005","depends_on":["FR-004"],"external_sources":[]}
{"record":"requirement","id":"FR-006","depends_on":["FR-004","FR-005"],"external_sources":[]}
{"record":"requirement","id":"FR-007","depends_on":["FR-004"],"external_sources":[]}
{"record":"requirement","id":"FR-008","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-009","depends_on":["FR-008"],"external_sources":[]}
{"record":"requirement","id":"FR-010","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-011","depends_on":["FR-010"],"external_sources":[]}
{"record":"requirement","id":"FR-012","depends_on":["FR-010"],"external_sources":[]}
{"record":"requirement","id":"FR-013","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-014","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-015","depends_on":["FR-014"],"external_sources":[]}
{"record":"requirement","id":"FR-016","depends_on":["FR-014"],"external_sources":[]}
{"record":"requirement","id":"FR-017","depends_on":["FR-014"],"external_sources":[]}
{"record":"requirement","id":"FR-018","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-019","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-020","depends_on":["FR-019"],"external_sources":[]}
{"record":"requirement","id":"FR-021","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-022","depends_on":["FR-021"],"external_sources":[]}
{"record":"requirement","id":"FR-023","depends_on":["FR-021"],"external_sources":[]}
{"record":"requirement","id":"FR-024","depends_on":["FR-021"],"external_sources":[]}
{"record":"requirement","id":"FR-025","depends_on":["FR-021"],"external_sources":[]}
{"record":"requirement","id":"FR-026","depends_on":["FR-025"],"external_sources":[]}
{"record":"requirement","id":"FR-027","depends_on":["FR-021"],"external_sources":[]}
{"record":"requirement","id":"FR-028","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-029","depends_on":["FR-028"],"external_sources":[]}
{"record":"requirement","id":"FR-030","depends_on":["FR-029"],"external_sources":[]}
{"record":"requirement","id":"FR-031","depends_on":["FR-030"],"external_sources":[]}
{"record":"requirement","id":"FR-032","depends_on":["FR-030"],"external_sources":[]}
{"record":"requirement","id":"FR-033","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-034","depends_on":["FR-033"],"external_sources":[]}
{"record":"requirement","id":"FR-035","depends_on":["FR-033"],"external_sources":[]}
{"record":"requirement","id":"FR-036","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-037","depends_on":["FR-036"],"external_sources":[]}
{"record":"requirement","id":"FR-038","depends_on":["FR-036"],"external_sources":[]}
{"record":"requirement","id":"FR-039","depends_on":[],"external_sources":[]}
{"record":"requirement","id":"FR-040","depends_on":["FR-039"],"external_sources":[]}
{"record":"requirement","id":"FR-041","depends_on":["FR-032"],"external_sources":[]}
{"record":"requirement","id":"FR-042","depends_on":["FR-011"],"external_sources":[]}
{"record":"requirement","id":"FR-043","depends_on":["FR-012"],"external_sources":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-001","FR-013"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-004","FR-005","FR-006"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-002","FR-003","FR-010","FR-011"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-007"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-008","FR-009"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-014","FR-015","FR-016","FR-017"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-019","FR-020"]}
{"record":"acceptance-criterion","id":"AC-8","for":["FR-021","FR-022","FR-023","FR-024","FR-025","FR-026"]}
{"record":"acceptance-criterion","id":"AC-9","for":["FR-027"]}
{"record":"acceptance-criterion","id":"AC-10","for":["FR-028","FR-029","FR-030"]}
{"record":"acceptance-criterion","id":"AC-11","for":["FR-030","FR-031","FR-032","FR-041"]}
{"record":"acceptance-criterion","id":"AC-12","for":["FR-033","FR-034","FR-035"]}
{"record":"acceptance-criterion","id":"AC-13","for":["FR-036","FR-037","FR-038"]}
{"record":"acceptance-criterion","id":"AC-14","for":["FR-039","FR-040","FR-042","FR-043"]}
{"record":"check","id":"CHECK-1","for":["AC-1"]}
{"record":"check","id":"CHECK-2","for":["AC-2"]}
{"record":"check","id":"CHECK-3","for":["AC-3"]}
{"record":"check","id":"CHECK-4","for":["AC-4"]}
{"record":"check","id":"CHECK-5","for":["AC-5"]}
{"record":"check","id":"CHECK-6","for":["AC-6"]}
{"record":"check","id":"CHECK-7","for":["AC-7"]}
{"record":"check","id":"CHECK-8","for":["AC-8"]}
{"record":"check","id":"CHECK-9","for":["AC-9"]}
{"record":"check","id":"CHECK-10","for":["AC-10"]}
{"record":"check","id":"CHECK-11","for":["AC-11"]}
{"record":"check","id":"CHECK-12","for":["AC-12"]}
{"record":"check","id":"CHECK-13","for":["AC-13"]}
{"record":"check","id":"CHECK-14","for":["AC-14"]}
```

## Entities

- **Claims block:** A fenced JSONL metadata envelope paired with normative Markdown lines in one source spec.
- **Qualified claim ID:** A permanent namespace plus a supported local FR, AC, CHECK, decision, term, risk, or invariant identifier.
- **Canonical model:** The deterministically normalized union of validated source lines, metadata, and resolved imports.
- **Authority map:** The sole versioned mapping from namespace and record type to approving authority.
- **Claims lock:** The single root file pinning immutable revisions for external claim registries.
- **Neutral manifest:** Research input containing questions, technical IDs, and digests but no normative intent-bearing fields.
- **Context manifest:** Post-research input containing applicable claims, closure, sources, candidates, and digests.
- **Projection freshness digest:** Digest covering canonical model plus authority, lock, renderer, and selection-policy versions.

---
name: review-skill-slimming
type: spec
status: live
feature: Review-skill slimming (cross-runtime helper, H-05 normalizer, size ratchet)
brief: briefs/review-skill-slimming-intake.md
date: 2026-07-13
version: 1.1.0
---

# Spec — Review Skill Slimming

> **Provenance:** intake human-validated at the gate (Type: feature; Trust boundary heuristic
> overruled to `no` by the human — recorded false positive). Subsequent phases run under the
> standing full-autonomy delegation. FR numbering continues the convergence family at FR-086.
> Evidence base: downstream health-report follow-up ("instruction dilution", roster-review at
> 5,445 words, +62%).

## Clarifications (challenge-resolution highlights; 23 challenges + 12 edge cases resolved)

| Q | A |
|---|---|
| Wrapper stdout conflict (C-2) + roster-qa co-consumption (C-8) | `xruntime-exec.sh` is NOT modified — byte-identical (FR-086). The helper invokes it as a subprocess and captures; helper stdout carries only helper JSON. |
| Journal write vs read-only / tree snapshots (C-1) | Journal appended AFTER the wrapper returns (wrapper snapshots untracked files mid-run); `briefs/` is gitignored so the scope gate never sees it. Append failure → exit 2, never silent healthy. |
| Judgment laundering in the degraded taxonomy (C-5, EC-5) | Classification is fully mechanical: exit 3/124 first; then fence-aware JSON extraction + schema validation; valid → healthy (any runtime exit code); zero-byte → `empty-output`; anything else → single class `non-conforming-output` (subsumes banner/refusal/truncated) with excerpt. |
| Journal records vs enforces probe-once (C-6) | Enforces: helper reads its own journal + review.json state and REFUSES a degraded runtime with unchanged digest (`skipped-degraded`) unless `--human-retry`. R-4 actually closes. |
| Timeout in the digest (C-3) | Excluded — a timeout tune must not re-arm the breaker. Digest = runtime + `--version` (10s) + sandbox flags. |
| Version-probe hang circularity (C-4) | Placeholder digest `<runtime>:version-unavailable`; FR-069 presence satisfied. |
| fingerprint_v2 inputs don't exist (C-10, C-14) | Scope trim: v1 stays primary/unchanged; v2 computed only when boundary/invariant/failure_mode fields are already present. Intake open question answered: conditional coexistence. |
| Normalizer vs FR-015 mirroring timing (C-13) | Normalizer does NOT mirror — mirroring stays at verdict composition (depends on the NO-GO determination the normalizer precedes). FR-015 semantics unchanged. |
| Carried-forward ledger vs validation (C-11) | Prior-round entries pass through byte-identical, never re-validated (FR-010 verbatim rule). Validation applies to new-round findings only. |
| Merge-rule gaps in §4 prose (C-12, EC-6, EC-7) | Codified: highest severity > longer evidence > first-in-input; `convergence` field (mechanical form of existing prose note); line-null → 0; probable-duplicate = same path+category, line delta ≤ 3, never auto-merged. |
| Machine-readable schema (C-7, C-19) | New `schema/review-finding.schema.json` (real JSON Schema, single source, `require()`d by both tools, contract-tested). `schema/review-json-schema.md` documents the full verdict shape prose-side. Drift triple avoided. |
| What forces tool invocation (C-15, EC-12) | "Tool-absorbed" = tool exists + skill instructs invocation + invocation leaves a persistent trace (journal line, `normalized_by` stamp, `--skip` entry — human skips are journaled too, closing the skip-vs-forgot gap). Enforcement beyond traces = recorded deferred residual R-5. |
| Ghost grep tokens (C-16, EC-9) | All eight tokens must survive in operative instruction sentences, not fences/pointers (FR-114); reviewer verifies context. |
| New artifacts not distributed (C-17) | Check 6 parity for both scripts + the .schema.json; invocation lines carry existence checks (B-4 stale-install pattern). Distribution gap remains the standing follow-up. |
| <4,000 arithmetic risk (C-18) | Fallback: land at actual, set ratchet to actual, follow-up to 4,000. Judgment prose is never cut for the number (FR-116). |
| Friction log eats the budget (C-20, C-21, EC-11) | Pinned counter: CRLF→LF, strip frontmatter, strip fences, strip `## Friction Log`, split /\s+/. Budget calibrated with the check's own ruler. |
| Budget key mismatch / rename fail-open (C-22) | Repo-relative key `skills/pipeline/roster-review.md`; zero-match entry → check FAILS. |
| Ratchet scope + inflation surface (C-23, EC-10) | Upstream-regrowth guard only (stated); budget raise requires commit-message justification (soft, stated in the failure message); sanctioned growth path = raise constant in the same PR, deliberately. |
| Journal lifecycle (EC-1..4) | Slug validated `[a-z0-9-]+`; sequential probes; append-forever per task (history across cycles); review.json authoritative for the current cycle, journal is evidence. |

Accepted residuals: **R-5** — invocation traces are auditable but not yet gate-enforced (graduation candidate once journal/stamp data accumulates); **R-6** — installed-project skill drift unguarded (ratchet is upstream-only); distribution gap unchanged.

## User Stories

### US-1: Cross-runtime helper (Priority: P0)
As the review pipeline, I want probe execution, health-state transitions, output validation, and an invocation journal owned by one deterministic script, so breaker compliance stops depending on prose discipline.
**Independent Test**: run the helper against a fake runtime emitting a banner → `non-conforming-output`, journal line appended, helper JSON on stdout only.
**Acceptance Scenarios**:
1. **Given** a healthy runtime, **When** the helper runs, **Then** stdout carries only `{status: "healthy", ...}` and one journal line is appended after the wrapper returns.
2. **Given** the runtime already degraded with unchanged digest, **When** invoked without `--human-retry`, **Then** `skipped-degraded`, journaled, wrapper never invoked.
3. **Given** wrapper exit 124 (or 3), **Then** degraded `timeout` (or `tree-mutation`) without output inspection.
4. **Given** schema-valid findings with a nonzero runtime exit, **Then** healthy; exit code recorded in the journal.

### US-2: H-05 review-result normalizer (Priority: P0)
As a reviewer, I want finding validation, fingerprinting, exact-dedup, and probable-duplicate surfacing done mechanically before merge, so manual ledger repair stops.
**Independent Test**: two specialists reporting the same v1 fingerprint at different severities → one merged finding, highest severity, `convergence` populated.
**Acceptance Scenarios**:
1. **Given** two finding files + prior ledger, **When** normalized, **Then** stdout = `{findings, cross_runtime_findings, probable_duplicates, rejected, stats}` + `normalizer_version`; repo untouched.
2. **Given** a schema-invalid new finding, **Then** it lands in `rejected` with a reason — never silently dropped.
3. **Given** a carried-forward entry that would fail current validation, **Then** it passes through byte-identical.
4. **Given** same path+category at lines 10/13, **Then** probable-duplicate (unmerged); at 10/14, not listed.

### US-3: Skill slimming + canonical schema (Priority: P0)
As a model executing roster-review, I want the skill reduced to orchestration and judgment with deterministic mechanics in tools/specs/schema docs, so long sessions stop missing state transitions.
**Independent Test**: word count under the pinned counter < 4,000 (or documented fallback); every removed paragraph maps to a tool trace or spec section.
**Acceptance Scenarios**:
1. **Given** the slimmed skill (v2.0.0), **Then** it contains the helper + normalizer invocation lines (with existence checks), B-2 judgment, human-retry/skip rules, gate choreography, minimal verdict summary + pointer to `schema/review-json-schema.md`.
2. **Given** the eight grep tokens, **Then** each appears in an operative sentence; both literal gate-script paths retained; all CHECK-N greps from both convergence specs still pass.
3. **Given** `check-pipeline-install`, **Then** Check 6 covers both new scripts + the .schema.json.
4. **Given** the removed-paragraph inventory, **Then** each entry is tool-absorbed (trace-leaving) or spec-normative — none orphaned.

### US-4: Size ratchet (Priority: P1)
As the repo, I want a mechanical word budget on roster-review.md, so instruction regrowth is deliberate instead of accretive.
**Independent Test**: fixture with CRLF + frontmatter + fences + Friction Log → counter excludes all four.
**Acceptance Scenarios**:
1. **Given** the landed skill, **When** `npm test` runs, **Then** the existing check-skill-structure invocation enforces the budget (no new chain entry).
2. **Given** the budgeted file renamed, **Then** the check fails (zero-match fail-closed).
3. **Given** a file over budget, **Then** the failure message states a budget raise requires commit-message justification.
4. **Given** `check-skill-contract.js`, **Then** it contains no ratchet logic (portable validator stays generic).

## Functional Requirements

(Contiguous with the convergence family: FR-001..042 in `specs/pipeline-loop-convergence.md`,
FR-050..085 in `specs/review-fanout-convergence.md`.)

#### Cross-Runtime Helper [US-1]

- **FR-086** [US-1]: `scripts/xruntime-review.js` MUST invoke `scripts/xruntime-exec.sh` as a subprocess, capturing its stdout and exit code, and MUST NOT modify `scripts/xruntime-exec.sh` in any way (byte-identical, preserving roster-qa co-consumption).
- **FR-087** [US-1]: The helper's stdout MUST carry only its JSON result `{status, reason, config_digest, findings[], journal_line}` — never wrapper output or diagnostics.
- **FR-088** [US-1]: Wrapper exit 3 MUST classify as degraded `tree-mutation` and exit 124 as degraded `timeout`, taking precedence over output inspection.
- **FR-089** [US-1]: Otherwise the helper MUST perform fence-aware JSON extraction and validate against `schema/review-finding.schema.json`; a schema-valid findings array (empty included) MUST classify healthy regardless of runtime exit code, with the exit code recorded in the journal.
- **FR-090** [US-1]: Zero-byte or whitespace-only output MUST classify as degraded `empty-output`.
- **FR-091** [US-1]: Non-empty output failing extraction/validation MUST classify as degraded `non-conforming-output` (single mechanical class subsuming banner/refusal/truncated) with an excerpt captured for human inspection.
- **FR-092** [US-1]: Classification MUST be fully mechanical (exit codes, byte inspection, schema validation) — no model judgment.
- **FR-093** [US-1]: `config_digest` MUST hash the runtime name, `--version` output (10s timeout), and sandbox-mode flags, and MUST NOT include the review timeout value.
- **FR-094** [US-1]: A `--version` probe hang MUST classify as degraded `version-probe-timeout` with placeholder digest `<runtime>:version-unavailable`.
- **FR-095** [US-1]: After — never during — the wrapper subprocess, the helper MUST append exactly one JSON line per invocation to `briefs/<task>-xruntime.jsonl` (`ts, task, cycle-round, runtime, digest, outcome, reason, duration_s, runtime_exit`); the journal is append-only across cycles; runtimes are probed sequentially; review.json `cross_runtime` remains authoritative for the current cycle.
- **FR-096** [US-1]: On journal-append failure or a task slug not matching `[a-z0-9-]+`, the helper MUST exit 2 and MUST NOT report healthy.
- **FR-097** [US-1]: Before invoking, the helper MUST read its journal + review.json state; a runtime degraded for this task with unchanged digest and no `--human-retry` MUST be refused with status `skipped-degraded`, journaled.
- **FR-098** [US-1]: `--skip "<reason>"` MUST journal an explicit human-skip entry (distinguishing skip-by-decision from never-attempted).

#### H-05 Normalizer [US-2]

- **FR-099** [US-2]: `scripts/review-normalize.js` MUST accept specialist finding arrays (files or stdin) plus an optional prior cumulative ledger, and MUST be read-only w.r.t. the repository (stdout only).
- **FR-100** [US-2]: New-round findings MUST be validated against `schema/review-finding.schema.json`; schema-invalid findings MUST land in `rejected` with per-finding reasons — never silently dropped.
- **FR-101** [US-2]: Carried-forward prior-round entries MUST NOT be re-validated or altered (FR-010 verbatim rule).
- **FR-102** [US-2]: Fingerprint v1 (`path:line:category`, null line → 0) MUST remain the primary, unchanged identity.
- **FR-103** [US-2]: `fingerprint_v2` MUST be computed only for findings already carrying `boundary`/`invariant`/`failure_mode` fields; those fields MUST NOT be required of any input.
- **FR-104** [US-2]: Exact duplicates (identical v1 fingerprint, or byte-equal summary for two line-0 findings on same path+category) MUST merge mechanically: highest severity; equal severity → longer evidence; tie → first in input order; the survivor MUST gain `convergence: [<specialists>]`.
- **FR-105** [US-2]: Non-exact findings sharing path+category with |line delta| ≤ 3 MUST be listed in `probable_duplicates[]` for owner adjudication and MUST NOT be auto-merged.
- **FR-106** [US-2]: The normalizer MUST NOT auto-downgrade severity, MUST NOT auto-resolve disagreement, and MUST NOT mirror cross-runtime findings (FR-015 mirroring stays at verdict composition).
- **FR-107** [US-2]: Output MUST be `{findings, cross_runtime_findings, probable_duplicates, rejected, stats}` on stdout; empty input → same shape, empty arrays, exit 0.
- **FR-108** [US-2]: Output MUST include `normalizer_version`; roster-review MUST stamp `normalized_by` into the verdict (persistent trace).

#### Skill Slimming + Canonical Schema [US-3]

- **FR-109** [US-3]: `schema/review-finding.schema.json` MUST exist as a real JSON Schema — the single machine-readable finding-shape source — and both new tools MUST load it via `require()`, never embed a copy.
- **FR-110** [US-3]: A contract test MUST verify the schema compiles, canonical valid fixtures pass, and canonical invalid fixtures fail.
- **FR-111** [US-3]: `schema/review-json-schema.md` MUST canonically document `briefs/<task>-review.json` (full shape moved from the skill), referencing the .schema.json for the finding object.
- **FR-112** [US-3]: `skills/pipeline/roster-review.md` MUST bump 1.9.0 → 2.0.0, reduced to orchestration/judgment/escalation/human-gate: §5.5 → gate choreography + spec references; cross-runtime → helper invocation + B-2 judgment + retry/skip rules; §4 → normalizer invocation; verdict → minimal summary + pointer.
- **FR-113** [US-3]: Every removed paragraph MUST be tool-absorbed (tool exists + invocation instructed + persistent trace) or spec-normative; enforcement beyond traces MUST be recorded as deferred residual R-5.
- **FR-114** [US-3]: The eight grep tokens MUST survive in living instruction text (operative sentences, not fences/pointers); the literal paths `scripts/check-scope-diff.sh` and `scripts/check-review-convergence.js` MUST be retained.
- **FR-115** [US-3]: `check-pipeline-install` Check 6 MUST gain both new scripts + the .schema.json; invocation lines MUST include existence checks surfacing a stale install (B-4 pattern).
- **FR-116** [US-3]: The slimmed skill MUST measure < 4,000 words under the US-4 counter; if honest compression cannot reach it, land at actual, set the ratchet to actual, record a follow-up — judgment prose MUST NOT be cut solely for the number.

#### Size Ratchet [US-4]

- **FR-117** [US-4]: The counter MUST: normalize CRLF→LF; strip frontmatter; strip fenced code blocks; strip the `## Friction Log` section; split on `/\s+/` filtering empties.
- **FR-118** [US-4]: `check-skill-structure.ts` MUST hold a budget map keyed by repo-relative path with `skills/pipeline/roster-review.md` at 4000 (or actual-at-landing per FR-116).
- **FR-119** [US-4]: A budget-map entry matching zero files MUST fail the check (fail-closed against renames).
- **FR-120** [US-4]: Exceeding a budget MUST fail with a message stating a budget raise requires commit-message justification.
- **FR-121** [US-4]: The ratchet MUST NOT be added to portable `check-skill-contract.js`; scope = upstream regrowth only.
- **FR-122** [US-4]: The ratchet MUST run via the existing check-skill-structure invocation in `npm test` — no new chain entry.

## Acceptance Criteria

AC-01..AC-26 as formalized (helper happy path; wrapper byte-identical; tree-mutation; timeout;
valid-findings-nonzero-exit → healthy; empty-output; non-conforming; digest excludes timeout;
version-hang placeholder; skipped-degraded ±`--human-retry`; `--skip` journaling; journal-fail/bad-slug
exit 2; normalizer happy path; carried-forward untouched; exact-merge rules + convergence; probable
window 3-in/4-out; no mirroring/downgrade/auto-resolve; empty input; schema contract test; slimmed-skill
content; living grep tokens; Check 6 parity; word budget; counter pinning fixture; zero-match key fails;
budget-exceeded message + contract.js clean). Full text in the formalizer record; each cites its FRs.

## Edge Cases

- EC-1 [US-1]: slug with `/` or spaces → exit 2 (FR-096).
- EC-2 [US-1]: two runtimes same round → sequential probes; single-line O_APPEND writes.
- EC-3 [US-1]: journal append fails after healthy pass → exit 2, no healthy report (FR-096).
- EC-4 [US-1]: second cycle after GO → journal accumulates (history); review.json authoritative.
- EC-5 [US-1]: banner + fenced valid JSON → extraction succeeds → healthy (banner tolerated).
- EC-6 [US-2]: line-null findings → v1 uses 0; exact only on byte-equal summary; else probable.
- EC-7 [US-2]: same defect at lines 41/42 → probable-duplicate (window ≤ 3), adjudicated, never auto-merged.
- EC-8 [US-2]: empty input → full shape, empty arrays, exit 0 (FR-107).
- EC-9 [US-3]: grep token only inside a fence → violates FR-114 (reviewer checks context).
- EC-10 [US-4]: legitimate future growth → raise the constant in the same PR with justification (deliberate, auditable).
- EC-11 [US-4]: CRLF/BOM after projection round-trip → normalized before counting (FR-117).
- EC-12 [US-1]: human skips the pass → `--skip` journals it; skip-vs-forgot distinguishable (FR-098).

## Runnable Checks

- CHECK-1: `node --test scripts/xruntime-review.test.js scripts/review-normalize.test.js` → exit 0.
- CHECK-2: `node -e "require('./schema/review-finding.schema.json')" && node --test scripts/review-finding-schema.test.js` → exit 0 (contract test).
- CHECK-3: `grep -q 'xruntime-review.js' skills/pipeline/roster-review.md && grep -q 'review-normalize.js' skills/pipeline/roster-review.md` → exit 0.
- CHECK-4: all CHECK-N greps from `specs/pipeline-loop-convergence.md` and `specs/review-fanout-convergence.md` → still green (token survival).
- CHECK-5: `node dist/scripts/check-skill-structure.js` → exit 0 with the budget enforced (and fails on a >budget fixture in its test).
- CHECK-6: `node scripts/check-pipeline-install.js` → exit 0 with Check 6 covering both scripts + schema.
- CHECK-7: `git diff <base>..HEAD -- scripts/xruntime-exec.sh skills/pipeline/roster-run.md` → empty (wrapper + roster-run untouched).
- CHECK-8: `bash scripts/sync-harness.sh --check` → exit 0.
- CHECK-9: `npm test` → exit 0.

## Amendments (v1.1.0 — plan-phase dual-voice review, 2026-07-13)

Nine objections (three blocking) + Voice-1 ground-truth corrections. Amendments override base FRs.

- **D-1 (O-1, re-report vs carry-forward — blocking):** new normalizer output array `reobservations[]`.
  When a new-round finding's v1 fingerprint matches a carried-forward ledger entry, it is a
  **re-observation**: never merged into the carried entry (verbatim rule holds), never emitted as
  a new finding (no fresh `first_seen_round` → no false strike), never dropped — reported as
  `{fingerprint, specialist, round}` for roster-review to note "still observed". FR-100/101/104
  amended; output shape gains the array.
- **D-2 (O-2, permanent breaker ban — blocking):** FR-097 refusal applies only when the persisted
  review.json has `status: NO-GO` (mid-cycle). Persisted GO or absent file = fresh cycle → the
  degraded state is stale, the helper proceeds with a fresh probe and journals the new cycle.
  B-3's post-QA re-probe preserved.
- **D-3 (O-3, ambiguous wrapper exit codes — blocking):** FR-086/088 amended: the helper captures
  wrapper stdout AND stderr separately. Exit 3 classifies `tree-mutation` only when stderr carries
  the wrapper's deterministic `TREE-MUTATED` marker; exit 124 classifies `timeout` only when
  `duration_s >= configured timeout`. Uncorroborated exit codes fall through to output inspection
  (FR-089..091). Fully mechanical; wrapper stays byte-identical.
- **D-4 (O-4, no JSON-Schema validator — repo is zero-dep):** no ajv. `scripts/lib/finding-schema.js`
  is a hand-rolled interpreter of the supported subset (`required`/`type`/`enum`/nullable), driven
  by the `require()`d schema file (single source). It MUST fail closed on unsupported schema
  keywords (throw), so schema-vs-validator drift is impossible to introduce silently. FR-110's
  "compiles" = parses + drives the shared validator + valid/invalid fixtures round-trip.
- **D-5 (O-5, unwired tests + untestable checker):** new FR: the three new test files (helper,
  normalizer, schema contract) and the structure-check fixture test MUST be added to the
  package.json test chain. FR-122's "no new chain entry" applies only to the ratchet's
  *enforcement* (inside the existing check-skill-structure invocation). check-skill-structure.ts
  refactor is explicitly in scope: export the counter + budgets, guard `main()` with
  `require.main`, allow SKILLS_DIR injection for fixtures.
- **D-6 (O-6/V1, miscalibrated baseline):** pinned-counter baseline at HEAD = **4,846 words**
  (not 5,445 — that was `wc -w`). Target < 4,000 stands (≈850-word honest cut); every budget
  number is measured with the pinned counter only.
- **D-7 (O-7, frontmatter tokens):** FR-114 amended: `max_no_go_rounds`, `novel_finding_strikes`,
  `cross_runtime_probe_timeout` are satisfied by their frontmatter tunable entries (operative
  config, blessed by shipped CHECKs); the operative-sentence rule applies to the five body tokens.
  §5.5's B-3/B-4/B-5 choreography is orchestration and stays; the cut concentrates in the
  cross-runtime section, §6 unfenced prose, and duplicated delta-selection mechanics.
- **D-8 (O-8, journal in consumer repos):** the helper MUST warn (stderr) when `git check-ignore
  briefs/` fails — in a consumer repo without the ignore, the append-forever journal would be a
  standing untracked file visible to the scope gate. Consumer-side `.gitignore` provisioning
  joins the standing distribution follow-up (roster-init out of scope here). Residual documented.
- **D-9 (O-9, duplicate round derivation):** the helper never derives the round. `--round <n>` is
  passed by roster-review (which owns the single B-3 derivation); absent → journal `round: null`.
- **V-1 (Voice-1 confirmations):** eight-token list confirmed as derived (D-7 set); removed-paragraph
  inventory lives in the PR body (briefs/ is gitignored); new `node --test` chain entries allowed
  (D-5); helper reads only the persisted review.json, never `.draft`; fence-stripping in the
  counter MUST fail loudly on unbalanced fences (undercount = fail-open otherwise); steps
  Check-6/slimming/ratchet land atomically (one commit) per the `&&`-chain coupling; stray
  untracked dir `specs/review-skill-slimming.md--dry-run/` cleaned before work.

## Errata (specs/review-v2-corrections.md v1.1.0, 2026-07-13)

- **D-1 shape supersession:** the `reobservations[]` shape here (`{fingerprint, specialist, round}`)
  is superseded — review-v2-corrections.md E-3/E-4 add `fid` to that shape and introduce two
  additional dispositions (`dispositions.reopened[]`, `dispositions.pending_check[]`) for a ledger
  match that is RESOLVED but not check-confirmed-green (INV-2). D-1's "never merged / never a fresh
  finding / never dropped" invariant is unchanged; only the classification granularity grew.
- **FR-097 journal input:** FR-097 already required reading "journal + review.json state", but the
  shipped helper only read review.json — review-v2-corrections.md INV-4/E-5 close that gap
  (`readLatestJournalEntry`); this is an implementation catch-up to the existing FR text, not a
  spec change.
- **CHECK-7 range scoping:** this check's `<base>..HEAD` is scoped to THIS spec's own
  implementation window (a scope guard against this task touching the wrapper/router) — it is not
  a standing "these files never change again" contract. review-v2-corrections.md's E-1 deliberately
  adds one routing row to `skills/pipeline/roster-run.md` in a later window; that is in scope for
  that spec, not a violation of this one.

## Entities

- `XruntimeHelper`: `scripts/xruntime-review.js` — subprocess wrapper owning probe/state/validation/journal; the breaker's mechanical arm.
- `InvocationJournal`: `briefs/<task>-xruntime.jsonl` — append-forever per-task history of every cross-runtime attempt, refusal, and human skip.
- `Normalizer`: `scripts/review-normalize.js` — read-only pre-merge validation/fingerprint/dedup tool (H-05).
- `FindingSchema`: `schema/review-finding.schema.json` — single machine-readable finding shape; `schema/review-json-schema.md` is its prose companion for the full verdict.
- `SizeRatchet`: word-budget check in `check-skill-structure.ts` with the pinned counter.

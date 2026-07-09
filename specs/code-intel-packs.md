---
name: roster-spec
type: spec
status: live
feature: Tiered code-intel tool packs — registry, consumer seam, discovery, arch-index reference pack
brief: briefs/code-intel-packs-intake.md
date: 2026-07-09
version: 1.0.0
---

# Spec — Tiered code-intel tool packs

## Clarifications

| Q | A |
|---|---|
| Capability token: `code_intel` (brief working name) or `code-intel`? | `code-intel` — matches the hyphenation of every existing `capability:` value; the `search_index` collision is avoided either way. The brief's `code_intel` note is superseded (FR-072). |
| Is capability-enum enforcement in `check-schema-enums` in scope? | Yes — `capability` joins `SCHEMA_FIELDS`, and the scan widens to `extensions/*/skills/*/SKILL.md` (FR-018). A frontmatter typo otherwise breaks the whole seam silently. |
| What do consumers grep — `skills/pipeline/*.md` like formal-verify? | No. Installed packs project to `.agents/skills/` and `.opencode/skills/`; `capability` is not in harness.json. Consumers grep the projected runtime dirs (FR-021). |
| Gate wiring: injected into intake Quality Gates, or a conditional roster-qa step? | Conditional step (tmux/cross-runtime precedent, `roster-qa.md:104-145`) — keeps the core pack-agnostic; intake briefs need no pack awareness. |
| Extension `type`: new value or reuse `skill-pack`? | Reuse `skill-pack` — install behavior is component-driven; a new value changes `manifest.ts`'s closed union and breaks older installers. |
| Tier structure and ownership? | **User decision:** 2 tiers, hand-curated — `verified` (roster-maintained, CI-covered) and `community` (schema-valid via PR, not verified). Assignment only via maintainer-merged PR. |
| Where does the arch-index pack live? | **User decision:** in this repo, `extensions/arch-index/` — roster CI covers it; registry `repo` is a repo-relative path. |
| Installed pack with no public registry entry (private packs)? | Silently tolerated everywhere: checker never reads installations (FR-015), consumers never read the registry (FR-023), doctor never flags unlisted packs (FR-042), discovery is registry-driven (FR-061). |
| What install action does a suggestion give (no remote fetch exists)? | Present the entry's `install` text verbatim — clone + `roster-extension install <local-path>` commands. Never executed (FR-056). |
| Gate timeout: fixed or tunable? | **User decision:** roster-qa tunable `code_intel_gate_timeout`, default 120s (FR-030). |
| Suggest community-tier packs in v1? | **User decision:** yes, both tiers, community labeled (FR-053/055). Follow-up noted (out of scope): when a detected specialized tool has no registry match, discovery could propose *creating* a pack for it — record as a candidate future task, not part of this spec. |

## User Stories

### US-1: Tier-list registry + deterministic checker (Priority: P0)
As a roster maintainer, I want a schema-constrained registry of code-intel packs with a CI checker, so that every public entry is valid, unique, and resolvable.
**Why this priority**: foundation — discovery and the tier product-opinion depend on it.
**Scope**: does NOT cover pack install mechanics or discovery UX.
**Independent Test**: run the checker against the shipped registry and against fixture violations; assert exit codes.
**Acceptance Scenarios**:
1. **Given** `registry/code-intel.jsonl` with the arch-index entry, **When** `node scripts/check-code-intel-registry.js` runs, **Then** it exits 0.
2. **Given** a fixture line with `tier: "gold"`, **When** the checker runs on it, **Then** it exits non-zero naming the line and the enum violation.
3. **Given** two entries sharing `tool: "arch-index"`, **When** the checker runs, **Then** it exits non-zero reporting the duplicate.
4. **Given** CI (`npm test`) with no network access, **When** the checker runs, **Then** it completes with no network call (remote resolution only under `--online`).

### US-2: roster-qa code-intel gate + invariant contract (Priority: P1)
As a pipeline user with a gate-providing pack installed, I want roster-qa to evaluate declared invariants as a conditional deterministic step, so that invariant violations block QA with NO-GO.
**Why this priority**: the gate is the pack model's core value; depends on US-6 for a live provider.
**Scope**: does NOT cover pack-internal gate logic; core owns the declaration envelope, the pack owns `check` semantics.
**Independent Test**: stub pack + fixture `kb/properties.md`; drive exit codes 0/1/2/3 and assert verdict + report lines.
**Acceptance Scenarios**:
1. **Given** an installed gate pack and a valid `code-intel` block in `kb/properties.md` whose invariants hold, **When** roster-qa runs, **Then** the gate step records pass and QA proceeds.
2. **Given** the same setup with one violated invariant (gate exits 1), **When** roster-qa runs, **Then** the verdict is NO-GO, gates stop, and the report contains the full raw gate log.
3. **Given** an installed gate pack but a prose-only `kb/properties.md`, **When** roster-qa runs, **Then** the step is skipped, the skip is recorded in `briefs/<task>-qa.md`, and the verdict is unaffected.
4. **Given** the gate binary crashes or times out (exit 3), **When** roster-qa runs, **Then** the gate is recorded DEGRADED with reason and the verdict is unaffected.

### US-3: roster-doctor detection (Priority: P1)
As a user running roster-doctor, I want installed code-intel packs detected and their tools checked, so that a broken pack surfaces early — without blocking work.
**Why this priority**: cheap insurance; the seam's health checks make the other consumers debuggable.
**Scope**: does NOT cover installing or fixing tools.
**Independent Test**: fixture project with a tagged pack and a missing binary; assert doctor output lines.
**Acceptance Scenarios**:
1. **Given** an installed pack whose `requires_tools` binary is absent, **When** doctor preflight runs, **Then** output contains `pack degraded: tool-missing:arch-index` and the verdict is still `READY` (given gates otherwise runnable).
2. **Given** a skill with `capability: code-intel` but no `entry:`, **When** doctor runs, **Then** a contract-violation warning names the skill.
3. **Given** a private local pack installed with no registry entry, **When** doctor runs, **Then** no missing-registry-entry warning appears.

### US-4: Deterministic audit section provider (Priority: P2)
As a user running roster-audit or code-quality-auditor, I want an installed pack to contribute a machine-generated audit section, so audits gain tool-backed deterministic rows.
**Why this priority**: valuable but additive; audits function without it.
**Scope**: does NOT cover model-judged severity (stays with the auditor).
**Independent Test**: stub audit-section provider emitting a fixture fragment; assert it lands as a distinct section and degrades to a one-line notice on failure.
**Acceptance Scenarios**:
1. **Given** an installed audit-section pack, **When** roster-audit runs, **Then** `briefs/audit-<date>.md` contains the pack's fragment as a distinct deterministic section starting with the index-freshness header.
2. **Given** the provider exits non-zero, **When** the audit runs, **Then** the section is replaced by a one-line degraded notice and the audit completes.
3. **Given** no pack installed, **When** the audit runs, **Then** output is byte-identical in structure to today's format.

### US-5: Discovery in roster-init + recruit (Priority: P1)
As a user onboarding a project, I want matching packs suggested from the registry via ranked AskUserQuestion, so I learn about useful tools without anything auto-installing.
**Why this priority**: the tier list only matters if users encounter it.
**Scope**: does NOT cover executing installs; never surfaces private packs.
**Independent Test**: fixture registry + fixture project languages; assert suggestion content, ranking, default, and that declining is a no-op.
**Acceptance Scenarios**:
1. **Given** a Rust project and a registry with a matching verified entry, **When** recruit's analysis completes, **Then** a suggestion presents the pack (verified first), a "none" default, and — on approval — the entry's install text verbatim.
2. **Given** the user declines, **When** the flow continues, **Then** no file changes and no install occurs.
3. **Given** no registry reachable (offline, no local checkout), **When** discovery runs, **Then** the suggestion step is skipped silently.
4. **Given** 5 matching entries, **When** the suggestion is built, **Then** at most 3 pack options show (verified first, alphabetical within tier) and the question text notes 2 more matches.

### US-6: arch-index reference pack in-repo (Priority: P0)
As a roster maintainer, I want a complete arch-index pack at `extensions/arch-index/`, registered as the sole verified entry, so the pack model is proven end-to-end.
**Why this priority**: the reference implementation validates every contract above; without it the seam is untested prose.
**Scope**: does NOT cover changes to the upstream arch-index tool.
**Independent Test**: CI installs the pack into a temp project and drives the gate contract with a stub binary.
**Acceptance Scenarios**:
1. **Given** the pack source at `extensions/arch-index/`, **When** `roster-extension install extensions/arch-index --target <tmp>` runs against a minimal-harness temp project, **Then** the three skills project with sibling executables and `.harness/extensions.json` records them.
2. **Given** a stub `arch-index` binary producing fixture outputs, **When** the gate contract test runs, **Then** exit codes 0/1/2/3 each map to the specified consumer behavior.
3. **Given** the pack is removed via the extension CLI, **When** roster-qa/doctor/audit run, **Then** all revert to skip behavior (uninstall round-trip).
4. **Given** an OCaml target with no `.cmt` files built, **When** the gate runs, **Then** it exits 3 (degraded), not 1.

## Challenges

| ID | Story | Challenge | Resolution |
|---|---|---|---|
| C-1 | all | Brief says `code_intel`, decision says `code-intel` — which is authoritative? | Spec is authoritative: `code-intel`; brief note superseded (FR-072). |
| C-2 | US-2/3/4 | Two runtime dirs may disagree (drift/partial install). | Grep `.agents` then `.opencode`, dedupe by dir name, `.agents` wins; drift → doctor warning (FR-021/022, FR-041). |
| C-3 | US-2/4/6 | SKILL.md is prose — no deterministic command-extraction contract. | New frontmatter: `provides:` + `entry:` + `requires_tools:`; consumers run `entry` from the skill dir (FR-020). |
| C-4 | US-1 | "Entries resolve" implies network in `npm test`. | Offline checker: schema + uniqueness + in-repo path existence; remote resolution only under `--online`, never CI (FR-011–013). |
| C-5 | US-1 | Registry format undecided (JSON vs JSONL). | JSONL + JSON Schema + contract test, per repo data-artifact convention (FR-001/002). |
| C-6 | US-1 | Field semantics undefined (repo shape, languages vocab, install, notes). | `repo` oneOf URL/relative-path; `languages` closed enum shared with discovery; `install` non-empty text; `notes` required for verified (FR-003–008). |
| C-7 | US-1 | "Checker ignores installed packs" is vacuous. | Reworded: checker never reads `.harness/extensions.json` (FR-015); tolerance lives in consumers (FR-023/042). |
| C-8 | US-1 | `check-schema-enums` never scans pack skill dirs. | Scan scope widened to `extensions/*/skills/*/SKILL.md`; `capability` added to `SCHEMA_FIELDS` (FR-018). |
| C-9 | US-1 | JSON Schema validated how — new dependency? | Hand-rolled checker implementing the schema (repo precedent); schema file is the documented source of truth; tests assert per-violation rejection (CHECK-2). |
| C-10 | US-1 | Tier semantics beyond the enum. | Documented: verified = CI-covered install+contract; community = schema-valid via PR only; label carries no other mechanics (FR-016/017). |
| C-11 | US-2 | Gate placement in the fail-fast sequence. | New conditional step after Gate 4, before tmux (FR-035); exit 1/2 stop like core gates. |
| C-12 | US-2 | Exit non-zero conflates violation/crash/stale. | Exit-code contract: 0 pass, 1 violation→NO-GO, 2 malformed→NO-GO loud, 3 degraded→warn, verdict unaffected (FR-031–034). |
| C-13 | US-2 | "properties.md present" is the wrong trigger. | Trigger = pack match AND valid `code-intel` fenced block; prose-only → recorded skip (FR-027/028). |
| C-14 | US-2 | Invariant syntax undesigned. | Core owns envelope: fenced block tagged `code-intel`, JSONL lines `{id,type,description,check}`; `check` opaque to core, pack-owned (FR-025/026). |
| C-15 | US-2 | "Silently skipped" vs report auditability. | Silence = no verdict impact; the report always records the skip (FR-028). |
| C-16 | US-2 | Multi-match semantics. | `provides:` discriminator; all gate providers run, lexicographic order, any 1/2 → NO-GO, per-pack attribution (FR-036). |
| C-17 | US-2 | Cross-runtime re-run includes the gate? | Yes — `entry` is runtime-agnostic shell (FR-037). |
| C-18 | US-3 | Which doctor section hosts what. | Section 1: pack list + contract/drift warnings; Section 2 + preflight: `requires_tools` binary checks (FR-039–043). |
| C-19 | US-3 | Doctor can't know which binary a pack needs. | `requires_tools:` frontmatter (FR-020/043). |
| C-20 | US-3 | tool-missing → NOT-READY would let an optional pack block all routing. | Advisory only: warning, never NOT-READY (FR-044). |
| C-21 | US-3 | Capability audit scans wrong dirs; keyword list unbounded. | Code-intel checks are contract-shaped (tag without provides/entry), scanned over projected dirs — no keyword list (FR-040). |
| C-22 | US-3 | Doctor behavior on unlisted (private) packs. | Factual listing, never a missing-registry-entry flag (FR-042). |
| C-23 | US-4 | Two audit hosts, two formats. | Fragment appended as a distinct section in each host's report; fixed Summary columns unchanged (FR-046/047). |
| C-24 | US-4 | Deterministic-but-stale index. | Mandatory index-freshness header line in the fragment; audits never regenerate (read-only) (FR-045/049). |
| C-25 | US-4 | Provider failure mid-audit. | One-line degraded notice replaces the section; audit continues; severity stays model-judged (FR-048/050). |
| C-26 | US-5 | Language vocabulary mismatch. | Closed enum in the schema, shared as discovery's matching vocabulary; match = any overlap (FR-005/052). |
| C-27 | US-5 | Where discovery finds the registry. | Local roster checkout → raw URL fetch → skip silently (FR-051). |
| C-28 | US-5 | Ranking and option cap. | Verified first, alphabetical within tier, max 3 + "none" default, overflow count in text (FR-053/054). |
| C-29 | US-5 | Presented install command not executable as written. | Registry `install` field carries the complete verbatim command block per entry; discovery presents it untouched (FR-007/056). |
| C-30 | US-5 | Insertion vs interview contracts; decline memory. | init: tools step after interview, outside Q budget; recruit: beside pipeline-skills offer, outside gap-question budget; declines not persisted (FR-058–060). |
| C-31 | US-5 | Community packs suggested without trust disclosure. | Tier disclosed in option label (FR-055); default is always "none". |
| C-32 | US-6 | `skill-pack` projects skills only — where does gate logic live? | Sibling resource files in skill dirs (installer already preserves them, `docs/extensions.md:48`) (FR-065). |
| C-33 | US-6 | CI can't have the real arch-index binary. | Stub-binary contract tests in CI (exit 0/1/2/3); real binary = manual check; "verified" defined accordingly (FR-068, FR-016). |
| C-34 | US-6 | Temp-project install vs harness gating. | Minimal harness fixture, existing extension-test pattern (FR-067). |
| C-35 | US-6 | All three skills tagged → every consumer matches three. | `provides:` disambiguates; all three carry the capability legitimately (FR-063/064). |
| C-36 | US-6 | Pack-specific leak validator mandated by two-gate contract? | Generic check-leak in CI yes; target-specific validator explicitly out of scope — pack emits no shareable artifacts (FR-069). |
| C-37 | US-6 | Does "verified" imply all language paths CI-tested? | No — verified covers install+contract in CI; language-path correctness is upstream tool domain (FR-016/068). |

## Functional Requirements

#### Registry & Checker
- **FR-001** [US-1]: The roster repo MUST provide a code-intel pack registry at `registry/code-intel.jsonl` containing one JSON entry per line.
- **FR-002** [US-1]: The roster repo MUST provide a JSON Schema at `registry/code-intel.schema.json` that constrains every registry entry.
- **FR-003** [US-1]: Each registry entry MUST declare the fields `name`, `tool`, `repo`, `languages`, `provides`, `install`, and `tier`.
- **FR-004** [US-1]: The schema MUST constrain `repo` to exactly one of: a URL, or a repo-relative path (oneOf).
- **FR-005** [US-1]: The schema MUST constrain `languages` to a closed enum of `go`, `rust`, `typescript`, `javascript`, `python`, `ocaml`, extensible only by editing the schema.
- **FR-006** [US-1]: The schema MUST constrain `tier` to `verified` or `community`.
- **FR-007** [US-1]: The schema MUST require `install` to be a non-empty free-text command block.
- **FR-008** [US-1]: The schema MUST require a non-empty `notes` field for every `verified`-tier entry.
- **FR-009** [US-1]: The registry checker (`scripts/check-code-intel-registry.js`) MUST validate every registry line against the schema and report failures with a non-zero exit.
- **FR-010** [US-1]: The checker MUST reject duplicate `name` values and duplicate `tool` values across the registry.
- **FR-011** [US-1]: For entries whose `repo` is a repo-relative path, the checker MUST verify the path exists in the roster repo.
- **FR-012** [US-1]: When run under `npm test`, the checker MUST NOT perform any network call.
- **FR-013** [US-1]: The checker MUST support an optional `--online` flag that performs remote repo resolution; this mode MUST NOT run in CI.
- **FR-014** [US-1]: The checker MUST be wired into `npm test` so registry validation runs on every test invocation.
- **FR-015** [US-1]: The checker MUST NOT read `.harness/extensions.json`; installed packs are out of its scope.
- **FR-016** [US-1]: Registry documentation MUST define tier semantics: `verified` = roster-maintained with CI-covered install and contract; `community` = schema-valid via PR, not verified by roster.
- **FR-017** [US-1]: Tier assignment MUST be changeable only via a maintainer-merged PR; no automated process may promote or demote a tier.
- **FR-018** [US-1]: `check-schema-enums` MUST include `capability` in `SCHEMA_FIELDS` and MUST scan `extensions/*/skills/*/SKILL.md` in addition to its existing scan targets.
- **FR-019** [US-1]: The public registry and all public artifacts MUST NOT name private packs.

#### Consumer Seam Contract
- **FR-020** [US-2]: A code-intel pack skill MUST declare in its SKILL.md frontmatter: `capability: code-intel`, `provides` (one of `gate`, `audit-section`, `init`), `entry` (a shell command relative to the skill directory), and `requires_tools` (list of binaries).
- **FR-021** [US-2]: Consumers (roster-qa, roster-doctor, roster-audit, code-quality-auditor) MUST resolve installed code-intel packs by scanning projected runtime skill directories: `.agents/skills/*/SKILL.md` first, then `.opencode/skills/*/SKILL.md`, deduplicated by directory name. *(Errata 2026-07-09, plan decision: consumers additionally scan any `runtime_roots` recorded in `.harness/extensions.json` when present — covers custom runtime entrypoints written by the extension installer (scripts/extension/cli.ts:189); absent/malformed file is silently tolerated, FR-024 unaffected.)*
- **FR-022** [US-2]: When the two runtime projections of the same skill directory differ, consumers MUST use the `.agents` copy, and the drift MUST surface as a roster-doctor warning.
- **FR-023** [US-2]: Consumers MUST NOT consult the registry or `harness.json` for pack resolution.
- **FR-024** [US-2]: A user-authored skill carrying the seam contract frontmatter MUST be treated as a first-class code-intel pack; an `extensions.json` record MUST NOT be required for consumer recognition. *(Errata 2026-07-09, human decision: user-authored packs remain first-class for RESOLUTION (list/doctor/report), but EXECUTION of their `entry` requires a one-time acknowledgment — an `extensions.json` install-record hash match or an explicit `node scripts/code-intel-resolve.js ack <skill>` recorded in `.harness/code-intel-ack.json`; see the execution trust model in `schema/skill-schema.md`.)*

#### QA Gate
- **FR-025** [US-2]: roster-qa MUST accept invariant declarations in `kb/properties.md` as a fenced block tagged `code-intel` containing JSONL lines with fields `id`, `type`, `description`, and an opaque pack-specific `check` object.
- **FR-026** [US-2]: The envelope syntax of the code-intel block MUST be owned by core and documented in `schema/kb-schema.md`; `check` semantics MUST be owned by the pack.
- **FR-027** [US-2]: roster-qa MUST run the code-intel gate only when both an installed pack matches `capability: code-intel` + `provides: gate` AND `kb/properties.md` contains a `code-intel` fenced block. *(Errata 2026-07-09, plan decision: "valid" means the block is present; a present-but-malformed block reaches the gate and fails loud per FR-033/EC-4 — skip applies only when the block is absent.)*
- **FR-028** [US-2]: When `kb/properties.md` is absent or contains only prose (no code-intel block), roster-qa MUST skip the gate step and MUST record the skip in the `briefs/<task>-qa.md` report; the skip MUST NOT affect the verdict.
- **FR-029** [US-2]: roster-qa MUST execute the gate by invoking the pack's `entry` command with the code-intel block path as its argument.
- **FR-030** [US-2]: roster-qa MUST enforce a timeout on the gate command, exposed as a roster-qa tunable `code_intel_gate_timeout` (default 120s); a timeout MUST be treated as exit code 3.
- **FR-031** [US-2]: On gate exit code 0, roster-qa MUST record the gate as passed.
- **FR-032** [US-2]: On gate exit code 1 (invariant violated), roster-qa MUST return NO-GO, stop, and include the full raw gate log in the report.
- **FR-033** [US-2]: On gate exit code 2 (malformed declaration), roster-qa MUST return NO-GO with an explicit malformed-declaration message.
- **FR-034** [US-2]: On gate exit code 3 (missing index, binary crash, or timeout), roster-qa MUST record the gate as DEGRADED with the reason, and the QA verdict MUST NOT be affected. *(Errata 2026-07-09: an unacknowledged pack — execution trust model, `schema/skill-schema.md` — also counts as degraded: its entry is not executed, the resolver reports `GATE <pack>: unacknowledged — not executed (...)`, and the verdict is unaffected.)*
- **FR-035** [US-2]: The gate MUST be placed as a new conditional step after the existing Gate 4 and before the tmux step in roster-qa.
- **FR-036** [US-2]: When multiple gate-providing packs are installed, roster-qa MUST run all of them in lexicographic skill-name order; any exit 1 or 2 MUST produce NO-GO; the report MUST attribute results per pack.
- **FR-037** [US-2]: roster-qa's cross-runtime re-verification MUST include the code-intel gate, running the same `entry` command.
- **FR-038** [US-2]: A valid code-intel block containing zero invariant lines MUST still run the gate; the gate MUST exit 0 and the report MUST state "0 invariants".

#### Doctor
- **FR-039** [US-3]: roster-doctor MUST list installed code-intel packs by grepping `capability: code-intel` over the projected runtime skill directories.
- **FR-040** [US-3]: roster-doctor MUST warn on contract violations, specifically a skill declaring `capability: code-intel` without `provides` or `entry`.
- **FR-041** [US-3]: roster-doctor MUST warn when the `.agents` and `.opencode` projections of a code-intel skill have drifted.
- **FR-042** [US-3]: roster-doctor MUST NOT flag installed packs that are absent from the public registry; private packs MUST be silently tolerated.
- **FR-043** [US-3]: roster-doctor (Section 2 and preflight) MUST check each entry of each installed pack's `requires_tools` via `command -v`.
- **FR-044** [US-3]: A missing required tool MUST produce an advisory warning of the form `pack degraded: tool-missing:<tool>` and MUST NOT contribute to a NOT-READY verdict.

#### Audit Section Provider
- **FR-045** [US-4]: An audit-section pack's `entry` command MUST emit a markdown fragment on stdout whose first content line is a mandatory index-freshness header line.
- **FR-046** [US-4]: roster-audit MUST append each audit-section pack's fragment as a distinct deterministic section in `briefs/audit-<date>.md`.
- **FR-047** [US-4]: code-quality-auditor MUST append each audit-section pack's fragment to `kb/reports/code-quality-report.md` as a distinct section. *(Errata 2026-07-09: the fixed-Summary-table-columns clause applies to roster-audit's report only — code-quality-auditor's report has no Summary table; see FR-046.)*
- **FR-048** [US-4]: On a non-zero exit from an audit-section `entry` command, the consumer MUST replace that pack's section with a one-line degraded notice and MUST continue the audit.
- **FR-049** [US-4]: Audit consumers MUST be read-only with respect to the code-intel index; they MUST NOT regenerate it.
- **FR-050** [US-4]: Severity classification of pack-emitted rows MUST remain model-judged; the auditor MAY cite section rows as evidence but MUST NOT delegate severity to the pack.

#### Discovery
- **FR-051** [US-5]: Discovery (roster-init and recruit) MUST read the registry from a local roster checkout when present; otherwise it MUST fetch the registry from the roster repo raw URL; if both fail (offline), it MUST skip suggestions silently.
- **FR-052** [US-5]: Discovery MUST suggest an entry when any detected project language overlaps the entry's `languages` list.
- **FR-053** [US-5]: Discovery MUST rank suggestions verified-tier before community-tier, alphabetically within each tier.
- **FR-054** [US-5]: Discovery MUST present at most 3 pack options plus a mandatory "none" default, and MUST note the count of overflow matches in the question text when more than 3 match.
- **FR-055** [US-5]: Community-tier options MUST disclose their tier in the option label (e.g. "community — not verified by roster").
- **FR-056** [US-5]: On user approval, discovery MUST present the entry's `install` text verbatim and MUST NOT execute any install command.
- **FR-057** [US-5]: Discovery MUST exclude already-installed packs from suggestions.
- **FR-058** [US-5]: In roster-init, the code-intel suggestion MUST run as a tools step after the interview and before the install step, and MUST NOT consume the interview question budget.
- **FR-059** [US-5]: In recruit, the code-intel suggestion MUST be presented alongside the existing pipeline-skills offer and MUST NOT consume the 3–5 gap-question budget.
- **FR-060** [US-5]: Discovery MUST NOT persist declines; a re-run MAY re-ask.
- **FR-061** [US-5]: Discovery MUST NOT suggest private packs (suggestions are registry-driven only).

#### Arch-Index Reference Pack
- **FR-062** [US-6]: The roster repo MUST contain a reference pack at `extensions/arch-index/` with a `roster-extension.json` of type `skill-pack`.
- **FR-063** [US-6]: The pack MUST provide exactly three skills: `arch-index-init` (`provides: init`), `arch-index-gate` (`provides: gate`), and `arch-index-audit` (`provides: audit-section`).
- **FR-064** [US-6]: Each pack skill MUST declare `capability: code-intel`, an `entry` command, and `requires_tools: [arch-index]`.
- **FR-065** [US-6]: Each skill's executable(s) MUST live as sibling resource files (e.g. `gate.sh`) inside the skill directory.
- **FR-066** [US-6]: The registry MUST contain an arch-index entry as its sole verified-tier entry, with `repo` set to its repo-relative path.
- **FR-067** [US-6]: CI MUST run an install round-trip test of the pack into a temporary project with a minimal harness fixture, following the existing extension-test pattern.
- **FR-068** [US-6]: CI MUST run a gate contract test using a stub `arch-index` binary with deterministic fixture outputs covering exit codes 0, 1, 2, and 3; real-binary end-to-end verification MUST remain a manual check, not a CI job.
- **FR-069** [US-6]: Pack files MUST pass the generic `scripts/check-leak.js` in CI; a target-specific leak validator MUST NOT be built for this pack (it emits no shareable artifacts).
- **FR-070** [US-6]: CI MUST include an uninstall round-trip test verifying that after extension removal, all consumers revert to their skip behavior.
- **FR-071** [US-6]: The pack MUST report pack-internal degradations — OCaml sources without `.cmt` files and per-language LSP absence — as exit code 3, not as failures.

#### Cross-Cutting
- **FR-072** [US-1]: All artifacts MUST use the canonical capability token `code-intel` (hyphenated); the intake brief's `code_intel` spelling is superseded.
- **FR-073** [US-2]: This feature MUST NOT edit roster-run; discovery integration lives exclusively in roster-init and recruit, and any skill edits made by this feature MUST preserve the roster-run insertion anchors from critical-route-port FR-016 and the LEDGER_SCHEMA byte-identity guarantees.

## Acceptance Criteria

- AC-1 [US-1, C-4]: `npm test` validates the shipped registry offline → exit 0, no network.
- AC-2 [US-1, C-6]: Checker rejects, individually: bad tier, unknown language, missing install, duplicate name, duplicate tool, relative repo path that doesn't exist, verified entry without notes.
- AC-3 [US-2, C-12]: Gate exit 1 → QA NO-GO with full raw log; exit 3 → DEGRADED recorded, verdict unchanged.
- AC-4 [US-2, C-13]: Prose-only `kb/properties.md` → gate skipped, skip line present in qa report.
- AC-5 [US-2, C-14]: `schema/kb-schema.md` documents the `code-intel` fenced-block envelope (JSONL: id, type, description, check).
- AC-6 [US-3, C-20]: Missing pack binary → advisory warning only; preflight verdict unaffected by pack state.
- AC-7 [US-4, C-25]: Provider failure → one-line degraded notice, audit completes.
- AC-8 [US-5, C-28/C-31]: Suggestion shows ≤3 options + "none" default, verified first, community labeled, install text verbatim, nothing executed.
- AC-9 [US-6, C-32]: Installed pack skills carry sibling executables; gate runs via `entry` command from the skill dir.
- AC-10 [US-6, C-33]: Stub-binary contract tests cover exits 0/1/2/3 in CI; real-binary check documented as manual.
- AC-11 [US-6, EC-19]: Uninstall reverts all consumers to skip behavior.
- AC-12 [US-1, C-1]: Zero occurrences of `code_intel` in shipped artifacts (`git grep -l code_intel` empty outside briefs/roster history).

## Edge Cases

- EC-1 [US-1]: Community entry's remote repo deleted after merge → CI unaffected (offline checker); `--online` run reports it; demotion is a maintainer PR.
- EC-2 [US-1]: Duplicate `tool` across entries → checker rejects (FR-010).
- EC-3 [US-1]: Checker in sandboxed CI → passes with no network (FR-012).
- EC-4 [US-2]: Invariant block with syntax error → gate exit 2 → NO-GO, explicit message (FR-033).
- EC-5 [US-2]: Valid block, zero invariants → gate runs, exit 0, "0 invariants" reported (FR-038).
- EC-6 [US-2]: Gate hangs → consumer timeout (120s default) → exit 3 semantics (FR-030).
- EC-7 [US-2]: Two gate packs, one fails → NO-GO; per-pack attribution in report (FR-036).
- EC-8 [US-2/3]: `.agents` matches, `.opencode` missing/drifted → `.agents` wins; doctor warns (FR-022).
- EC-9 [US-3]: Capability tag hand-removed post-install → consumers no longer match (contract is the tag); doctor's extensions.json listing may still show the pack files — factual, no error.
- EC-10 [US-3]: Pack needing per-language servers → only `requires_tools` binaries checked by doctor; language-server absence is pack-internal exit-3 territory (FR-071).
- EC-11 [US-3]: Private pack, no registry entry → doctor lists factually, no warning (FR-042).
- EC-12 [US-4]: Index absent (init never run) → provider exits 3 → degraded notice (FR-048).
- EC-13 [US-4]: Stale index → fragment's mandatory freshness header discloses it; consumer never regenerates (FR-045/049).
- EC-14 [US-5]: Zero matching packs → suggestion step skipped entirely (no question with only "none").
- EC-15 [US-5]: Pack already installed → excluded from suggestions (FR-057).
- EC-16 [US-5]: Re-run after decline → may re-ask (no persistence, FR-060).
- EC-17 [US-5]: More matches than option slots → cap 3 + overflow note (FR-054).
- EC-18 [US-6]: Install into temp project without harness → planner rejects (existing behavior); test fixture provides minimal harness (FR-067).
- EC-19 [US-6]: `roster-extension remove arch-index` → consumers revert to skip (FR-070).
- EC-20 [US-6]: OCaml project, no `.cmt` built → gate exit 3, degraded (FR-071).
- EC-21 [all]: User-authored skill with the contract frontmatter, no extensions.json record → first-class pack (FR-024).

## Runnable Checks

- CHECK-1 [AC-1]: `node scripts/check-code-intel-registry.js` → exit 0 on the shipped registry.
- CHECK-2 [AC-2]: `node --test scripts/check-code-intel-registry.test.js` → per-violation rejection fixtures pass. *(Errata: buildless plain-JS test in `scripts/`, per the check-skill-contract precedent.)*
- CHECK-3 [AC-3, AC-9, AC-10]: `node --test scripts/arch-index-pack.test.js` → stub-binary gate contract (exits 0/1/2/3) + install/uninstall round-trip pass. *(Errata: same path convention.)*
- CHECK-4 [AC-12]: `git grep -lE 'code_intel(_gate_timeout)?' -- ':!briefs' ':!roster' ':!specs' | xargs -r grep -lE 'code_intel([^_g]|_[^g]|_g[^a]|$)'` — simplified acceptance: `git grep -nE '\bcode_intel\b' -- ':!briefs' ':!roster' ':!specs'` restricted to matches that are not `code_intel_gate_timeout` → empty. *(Errata: the tunable name `code_intel_gate_timeout` (FR-030) legitimately contains the substring; `:!specs` excluded because this spec documents the superseded token.)*
- CHECK-5 [AC-5]: `grep -q 'code-intel' schema/kb-schema.md` → exit 0.
- CHECK-6 [AC-6]: manual — run `/roster-doctor preflight` in a fixture project with the pack installed and the binary absent; verify `READY` verdict + `pack degraded: tool-missing:arch-index` warning.
- CHECK-7 [AC-8]: manual — run `/recruit` on a Rust fixture project; verify suggestion shape (ranking, none-default, verbatim install text, no execution).
- CHECK-8 [AC-4]: manual — roster-qa run against a fixture with prose-only `kb/properties.md`; verify skip line in `briefs/<task>-qa.md`.

## Entities

- `CodeIntelRegistry`: the JSONL tier-list file `registry/code-intel.jsonl`, schema-constrained, hand-curated.
- `RegistryEntry`: one registry line — name, tool, repo, languages, provides, install, tier, notes.
- `PackSeamContract`: the frontmatter quadruple (`capability: code-intel`, `provides`, `entry`, `requires_tools`) that makes a skill an addressable pack component.
- `CodeIntelBlock`: the fenced, `code-intel`-tagged JSONL block in `kb/properties.md` declaring invariants (`id`, `type`, `description`, opaque `check`).
- `GateExitContract`: the 0/1/2/3 exit-code semantics binding pack gates to consumer behavior.
- `CodeIntelPack`: an installed extension (or user-authored skill set) whose skills carry the PackSeamContract.
- `ArchIndexPack`: the in-repo reference CodeIntelPack at `extensions/arch-index/`.
- `AuditSectionFragment`: the markdown-on-stdout output of an audit-section provider, freshness header first.

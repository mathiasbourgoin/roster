---
name: roster-spec
type: spec
status: draft
feature: commit-telemetry
brief: briefs/commit-telemetry-intake.md
version: 1.0.1
---

# Spec — commit telemetry boundary freeze

**Profile: minimal-freeze**
**Status: VALIDATED for implementation — owner selected A; remaining mechanical boundaries approved under delegated nonblocking authority. Not ship approval.**

The owner explicitly selected the advisory fallback / strict refusal / unchanged Git settings policy.
No claim is made that the earlier research was blind or that a retrospective scope freeze existed.
Claims metadata stays draft until implementation evidence is available; contract approval does not
promote implementation claims to verified facts.

Escalation entry: review round 3, cycle 1, `design-not-converging / novel-finding-streak`.
Baseline commit sha1: `5e1c13323c5616e72c9d38adc0a2b6529a0f182e`. The original contractual brief
`briefs/commit-telemetry-spec.md` remains applicable and is not replaced or silently weakened.
The identifiers below extend its requirement range. Review history and strike budget remain intact.

Evidence: `roster/commit-telemetry/refreeze-research.md` and `refreeze-evidence/`;
primary Git-only control matrix `refreeze-evidence/git-message-probe.json`.
The fresh documentarian used neutral questions, not previous findings. Its subprocess/activation
limitations are recorded: inspected tests are not test passes. The primary Git-only matrix has
no telemetry installed and distinguishes Git's own cleanup from telemetry-induced changes.

Scope: UTF-8 commit messages, supported local Node/Git installations, ordinary and linked
worktrees, and telemetry runtime/hook/configuration/local-evidence writes, including the init/sync
copy chain and shared ancestor directories through which they pass. Existing general skill/rule
projection semantics or separately opted-in global skill destinations are not being redesigned.
This is not authentication,
a complete security audit of all historical projection engines, or protection against a malicious
local owner concurrently swapping filesystem paths. Unsupported Git encodings must be explicit,
not silently made compatible by changing user configuration.

## Functional Requirements

### Invariants

The eight invariants below are the complete minimal-freeze extension; the heading also makes
these normative lines discoverable by the installed claims reconciler.

- **FR-010**: Write containment — Before any telemetry-owned installation, update, repair or
  distribution write, the operation MUST reject existing or dangling symlinks at its managed
  destination or managed ancestors, including runtime, wrappers, telemetry configuration and
  local-state destinations. It MUST NOT truncate/chmod an unrelated inode through a hard-link
  alias: either reject multiply-linked destinations or replace only the managed directory entry
  safely. On refusal, linked targets, their permissions and the link itself MUST remain unchanged.
  This applies to the copy performed by sync/init, not just the later activation preflight.
  The selected project root may itself have been deliberately resolved from an input alias.
  Git administrative writes are limited to resolved worktree/common storage needed for the
  exclusion/worktree configuration contract and ordinary Git index/tree plumbing for staged-tree
  binding; a linked destination of a direct telemetry filesystem write
  MUST NOT become an implicit permission to modify an unrelated file. [CHECK-1, AC-1]

- **FR-011**: Read-only check — `sync-harness.sh --check` MUST NOT change the real project's
  telemetry artifacts, Git configuration or any target reachable through copied managed links.
  Redirecting HOME or copying the project into a sandbox is not proof of containment. An unsafe
  copied absolute/relative file or directory link MUST be rejected or made inert before a write
  can reach its referent. A refused check MUST return nonzero and leave sentinels unchanged.
  This invariant is about telemetry-introduced writes and writes through copied telemetry-managed
  paths, not just the final tracked-tree diff. It does not reopen all pre-existing non-telemetry
  projection engines for a security audit. [CHECK-2, AC-2]

- **FR-012**: Namespace and ownership — Within the Git-recognized trailer block, ownership of
  the enumerated `Harness-*` telemetry keys MUST be case-insensitive. Replacement MUST remove
  stale aliases and duplicates, produce at most one canonical spelling/value per enabled key,
  reject folded values for owned single-line fields, and omit disabled generated fields.
  Ownership MUST NOT extend to arbitrary subject/body examples or unrelated trailers. Text
  supplied by the user below scissors is not collected telemetry merely because it contains
  the same words. It MUST NOT be advertised as erased from raw commit bytes when Git retains it.
  If Git cleanup turns such text into a conflicting actual trailer, the final consistency rule
  below applies rather than silently accepting a false field. Alias-removal/omission assertions apply
  to actual owned footers in supported layouts and to generated telemetry, not to raw user strings in
  an advisory no-generation fallback or explicitly disabled hook. [CHECK-3, AC-3]

- **FR-013**: Git lifecycle fidelity — For supported message configurations, the resulting
  subject, non-owned body content and unrelated trailers MUST match a no-telemetry Git control,
  except for the necessary insertion/removal of the owned footer and its separators. Telemetry
  MUST NOT itself trim verbatim body content, normalize its CRLF, create a metadata-only subject,
  or mistake an empty interactive template for a subject. Success/refusal classification is fixed
  by the matrix below; an expected conflict is not a successful metadata emission. The matrix covers cleanup
  `whitespace`, `verbatim`, `strip`, and edited `scissors`; default `#`, explicit `;`, and `auto`;
  empty and editor-written messages, comment-prefixed `-m` subjects, body examples, trailing
  spaces/CRLF and supplied text after scissors. Effective Git behavior, not the configuration
  value `auto` treated as a literal marker, determines compatibility. [CHECK-4, AC-4]

- **FR-014**: Explicit encoding conflicts — When the effective Git configuration cannot
  represent/parse the canonical owned footer (for example `core.commentChar=H`, or a comment
  string that prefixes `Harness-`), telemetry MUST report an actionable encoding conflict.
  Strict mode MUST refuse publication rather than claim valid metadata; advisory mode MUST
  allow the ordinary Git commit without generated telemetry and warn that telemetry is unavailable.
  Neither path may rewrite the user's comment, cleanup, trailer or global settings. Physical hook
  activation MUST NOT be described as successful metadata encoding. This is a declared unsupported
  combination, not a promise that every valid Git customization is telemetry-compatible.
  A per-command Git override may be suggested, never applied without the caller selecting it.
  A recognized scissors marker followed by non-comment user text is also a declared ambiguous
  encoding layout: per-invocation cleanup overrides are not portably visible to hooks. Before
  preparing metadata, strict MUST refuse this layout explicitly; advisory MUST warn and commit
  without generated telemetry, preserving the user's text according to Git's selected cleanup.
  Interactive buffers containing no non-comment subject are similarly not evidence of a publishable
  subject: no metadata may turn them into one. Strict may refuse that ambiguous buffer; advisory
  leaves acceptance/rejection to Git without generating telemetry. Explicit comment-prefixed `-m`
  subjects remain supported when Git retains them, and MUST NOT be converted into metadata-only
  commits when Git would remove the supplied subject.
  This deliberately conservative boundary applies even when one configured cleanup would work.
  [CHECK-5, AC-5]

- **FR-015**: Receipt lifecycle — Receipts MUST constrain only the commit operation that
  prepared them. Abandoned, malformed or stale receipts MUST NOT block unrelated reset/update-ref,
  worktree creation or a later independent command. Disabled hooks MUST ignore receipts and reports
  without modifying either. Actual amendments with prepared telemetry MUST preserve a prior task
  identity; normal `-C`/`-c` reuse MUST NOT be classified as amendment solely by message source.
  Parent-process bookkeeping is local consistency evidence, not authenticated identity.
  [CHECK-6, AC-6]

- **FR-016**: Truthful policy outcomes — Missing/invalid advisory measurements MUST remain
  nonblocking, with unavailable values omitted rather than fabricated zeros or estimates. Strict
  mode MUST enforce only enabled required measurements. A report accepted for preparation MUST
  bind the staged tree/current harness, and known contradictions in the final commit's actual
  owned metadata MUST be refused in both policies before its ref is published. Same-task totals
  MUST remain cumulative without automatic addition. A field toggle is an output-control promise,
  not a general-purpose redactor of text independently authored by the user. [CHECK-7, AC-7]

- **FR-017**: Original integration preserved — Default init/full doctor MUST still install or
  repair local owned hooks when compatible, preserve explicit disable/custom active hooks and
  preferences, and surface conflicts without claiming activation. Locally available versioned
  runtime/skill/status/update and field controls MUST remain available in installed-only ESM
  projects without changing neighboring module semantics or downloading executable code. Agent
  names/mode/formal context remain actual agent assertions; mode accepts express-lite, express,
  fast, full or null, matching the ledger without mapping Express Lite to Express. Never claim planned participation or inferred
  verification. No external telemetry transmission or global Git writes may be introduced.
  [CHECK-8, AC-8]

### Frozen outcome matrix (FR-012 through FR-016)

All successful cells use valid reports and an underlying Git control that itself accepts the
message. Missing/invalid reports follow FR-016 instead. These outcomes are normative, not
implementation-selected exceptions:

| Cell | Message/configuration | Strict | Advisory |
|---|---|---|---|
| M1 | Substantive subject, no scissors ambiguity; `#`, explicit `;`, or `auto`; whitespace/verbatim/strip, or edited scissors | Commit with one canonical owned footer | Commit with one canonical owned footer |
| M2 | Scissors suffix contains only comment/blank lines under the effective marker | Same as M1, with Git's cleanup preserved | Same as M1 |
| M3 | A recognized scissors marker is followed by non-comment supplied text, regardless of configured cleanup | Clear encoding-conflict refusal before preparation | Warn; ordinary Git commit without generated telemetry; do not redact supplied text |
| M4 | Comment/trailer configuration cannot round-trip the canonical footer, including `H` prefix collision | Clear encoding-conflict refusal | Warn; ordinary Git commit without generated telemetry; configuration unchanged |
| M5 | Empty message or comment-only interactive buffer, with no reliably publishable subject | Refuse without inventing a metadata-only subject (ordinary Git empty rejection or explicit ambiguity diagnostic) | No generated telemetry; Git's ordinary acceptance/rejection and supplied bytes |
| M6 | Explicitly disabled policy | Ordinary Git behavior; no telemetry mutation/validation | Same |
| M7 | Encoder/editor introduces a detectable M3/M4 condition before final preparation is accepted | Clear conflict refusal | Remove only telemetry's prepared/generated footer and take no-generation fallback; preserve supplied text |
| M8 | An accepted preparation still yields missing/displaced/changed actual owned fields after final cleanup | Refuse ref publication; actionable contradiction | Same; do not silently publish false prepared metadata |

Raw supplied `Harness-*` strings can remain in M3/M4/M6/M7. That is not collection or proof of
participation, and disabling collection is not a promise to scrub arbitrary authored text.

## Runnable Checks

These are implementation obligations, not ship approval. The new self-contained checker
`scripts/roster-telemetry-contract-check.js` was authored and run red before corrective product
edits; its declared outcomes below were not weakened to match the implementation. Each case
uses disposable real repositories and explicit assertions:
0 = invariant holds, 1 = an assertion fired, >=2 = setup/load/tool error. A test runner's undifferentiated
exit 1 is not sufficient evidence. Record raw commands, Git version, fixtures and environment failures.
Existing full `npm test`, telemetry tests, projection freshness, claims and review gates remain required.

- **CHECK-1** [AC-1]: (fail-closed-path) `node scripts/roster-telemetry-contract-check.js filesystem`
  — exercise standalone install/update and actual default init/sync with existing/dangling runtime,
  wrapper and ancestor links, outside sentinels and hard-link aliases. Assert unchanged bytes, modes,
  links and forbidden Git configuration on refusal; run a safe control to prove the entrypoint ran.
- **CHECK-2** [AC-2]: (fail-closed-path) `node scripts/roster-telemetry-contract-check.js readonly`
  — run actual `--check` with copied absolute/relative managed file/directory links, snapshot real
  artifacts, Git config and external sentinels before/after, and assert no writes escaped the sandbox.
- **CHECK-3** [AC-3]: (authentic-success-path) (fail-closed-path)
  `node scripts/roster-telemetry-contract-check.js trailers` — commit using real hooks with lowercase,
  mixed-case and duplicate owned keys, disabled fields, unrelated trailers and folded continuations;
  compare raw bytes separately from native Git parsed trailers, not just the runtime's own parser.
  Apply absence/alias assertions to supported generated footers, not arbitrary M3/M4/M6/M7 raw text.
- **CHECK-4** [AC-4]: (authentic-success-path)
  `node scripts/roster-telemetry-contract-check.js messages` — execute the FR-013 matrix with and without
  telemetry, including an editor that replaces the entire template under `auto`, and compare subjects,
  body/unrelated bytes after accounting for only the owned footer and Git's cleanup. Require success
  for M1/M2, no-generation/subject-safety behavior for M5, retained explicit comment-prefixed `-m`
  subjects, and the exact conflict/fallback outcomes for M3/M4/M7/M8;
  never turn an unexpected failure into an unsupported cell after observing it.
- **CHECK-5** [AC-5]: (fail-closed-path)
  `node scripts/roster-telemetry-contract-check.js encoding` — a valid report plus incompatible `H`
  comment configuration or ambiguous post-scissors tail produces a clear strict conflict and a
  successful advisory commit without generated telemetry,
  and byte-identical configuration. Compare the underlying Git-only control. Probe multi-character
  comment strings only where the installed Git actually supports them; record unsupported tools.
- **CHECK-6** [AC-6]: (authentic-success-path) (fail-closed-path)
  `node scripts/roster-telemetry-contract-check.js receipts` — actual successful commits/amendments,
  all message-source variants, canceled editors, malformed/stale receipts, reset/update-ref, worktree
  creation and disabled policy; assert both legitimate acceptance and unrelated-operation isolation.
- **CHECK-7** [AC-7]: (authentic-success-path) (fail-closed-path)
  `node scripts/roster-telemetry-contract-check.js reports` — null vs genuine zero, stale tree,
  cumulative totals, enabled/disabled strict requirements and final cleanup/editor contradictions.
  Assert no false trailers are published, without treating local assertions as authenticated usage.
- **CHECK-8** [AC-8]: (authentic-success-path)
  `node scripts/roster-telemetry-contract-check.js distribution` — actual installed-only ESM consumer,
  repair/disable/update, native and inherited unrelated hooks, field controls, version/status and
  linked-worktree isolation. Assert no network invocation/global config change or neighboring module
  reinterpretation; invoke installed hooks rather than only source helper functions.

## Acceptance Criteria

- **AC-1**: CHECK-1 — every telemetry write entrypoint contains its writes; unsafe managed aliases
  cannot modify external bytes/modes or activate hooks, and a safe ordinary install succeeds.
- **AC-2**: CHECK-2 — read-only checks leave real artifacts, Git config and referents untouched,
  including when copied links point outside the regeneration sandbox.
- **AC-3**: CHECK-3 — disabled/stale aliases do not survive in supported generated footers;
  canonical fields are unique and single-line, while supplied non-owned text/unrelated trailers survive.
- **AC-4**: CHECK-4 — M1/M2 preserve baseline subjects/non-owned content and succeed, M5 never
  invents a metadata-only subject, and the remaining cells follow their fixed conflict/fallback
  outcomes. An ordinary supported template MUST NOT fail solely because it used `auto`.
- **AC-5**: CHECK-5 — an unrepresentable or declared ambiguous footer is explicit: strict refuses, advisory commits without
  generated metadata; neither silently changes the user's Git configuration.
- **AC-6**: CHECK-6 — only the matching real commit is constrained; disabled/abandoned state cannot
  obstruct unrelated Git commands, and amendment identity is not confused with normal reuse.
- **AC-7**: CHECK-7 — advisory absence remains usable, strict requirements follow field settings,
  and no prepared final contradiction or double-counted cumulative value is published.
- **AC-8**: CHECK-8 — genuine installed consumers retain the original versioned local feature,
  safe defaults, preference/custom-hook preservation and worktree isolation with no hidden downloads.

## Claims Metadata

```claims
{"record":"claims-header","schema_version":1,"namespace":"commit-telemetry","spec_lifecycle":"draft"}
{"record":"requirement","id":"FR-010","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-011","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-012","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-013","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-014","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-015","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-016","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"requirement","id":"FR-017","lifecycle":"draft","external_sources":[],"depends_on":[]}
{"record":"acceptance-criterion","id":"AC-1","for":["FR-010"]}
{"record":"acceptance-criterion","id":"AC-2","for":["FR-011"]}
{"record":"acceptance-criterion","id":"AC-3","for":["FR-012"]}
{"record":"acceptance-criterion","id":"AC-4","for":["FR-013"]}
{"record":"acceptance-criterion","id":"AC-5","for":["FR-014"]}
{"record":"acceptance-criterion","id":"AC-6","for":["FR-015"]}
{"record":"acceptance-criterion","id":"AC-7","for":["FR-016"]}
{"record":"acceptance-criterion","id":"AC-8","for":["FR-017"]}
{"record":"check","id":"CHECK-1","for":["AC-1"]}
{"record":"check","id":"CHECK-2","for":["AC-2"]}
{"record":"check","id":"CHECK-3","for":["AC-3"]}
{"record":"check","id":"CHECK-4","for":["AC-4"]}
{"record":"check","id":"CHECK-5","for":["AC-5"]}
{"record":"check","id":"CHECK-6","for":["AC-6"]}
{"record":"check","id":"CHECK-7","for":["AC-7"]}
{"record":"check","id":"CHECK-8","for":["AC-8"]}
```
